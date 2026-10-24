import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { AuditLog } from '../../shared/audit/audit-log';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { PatientDirectory } from '../patients';
import { ClinicalAccess } from './clinical-access';
import { cleanSurfaces, currentChart, priceFor, type NoteField } from './clinical-rules';
import type { AmendmentInput, ChartEntriesInput, NewPrescriptionInput, NewProcedureInput, OpenVisitInput, VisitNotesInput } from './clinical.schemas';
import { VisitsRepository } from './visits.repository';

const visitNotFound = () => Err.notFound('visit_not_found', 'Visit not found');
const NOTE_COLUMN: Record<keyof VisitNotesInput, NoteField> = {
  chiefComplaint: 'chief_complaint', diagnosis: 'diagnosis', clinicalNotes: 'clinical_notes', nextVisitNote: 'next_visit_note',
};

/**
 * The doctor's visit (SRS VISIT-001…004, CHART-001, PATIENT-005 alerts). One use case per method, one transaction
 * each. The database holds the rules that must never break (a final note is not overwritten, a visit matches its
 * appointment, a procedure is priced within its service's range, an issued prescription is not edited); this
 * service adds who may act and turns the request into rows. Opening a visit and a prescription is audited here; every
 * write is audited by the database triggers (without the clinical text, AUDIT-002).
 */
@Injectable()
export class VisitsService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: VisitsRepository,
    private readonly access: ClinicalAccess,
    private readonly patients: PatientDirectory,
    private readonly audit: AuditLog,
  ) {}

  /** Open (or re-open) the visit of an appointment, or start a walk-in visit. Returns the visit id. */
  open(input: OpenVisitInput): Promise<{ id: string; created: boolean }> {
    return this.db.run(async (tx, tenantId) => {
      const a = await this.access.actor(tx);
      if (!a.can('clinical:write')) throw Err.forbidden('missing_permission', 'Missing permission: clinical:write');
      if ('appointmentId' in input) {
        const appt = await this.repo.appointmentForVisit(tx, input.appointmentId);
        if (!appt) throw Err.notFound('appointment_not_found', 'Appointment not found');
        if (!a.isOwner && a.doctorId !== appt.doctor_id) throw Err.forbidden('not_your_appointment', 'This is another doctor\'s appointment');
        const existing = await this.repo.byAppointment(tx, appt.id);
        if (existing) return { id: existing.id, created: false };
        if (!['checked_in', 'in_progress'].includes(appt.status) || !appt.patient_id) {
          throw Err.conflict('appointment_not_in_progress', 'Check the patient in before opening the visit', { status: appt.status });
        }
        const id = await this.repo.create(tx, tenantId, { appointmentId: appt.id, patientId: appt.patient_id, doctorId: appt.doctor_id, branchId: appt.branch_id, createdBy: a.memberId });
        return { id, created: true };
      }
      const doctorId = input.doctorId ?? a.doctorId;
      if (!doctorId) throw Err.badRequest('doctor_required', 'Choose the doctor of this visit');
      if (!a.isOwner && doctorId !== a.doctorId) throw Err.forbidden('not_your_appointment', 'A walk-in visit is started by its doctor');
      if (!(await this.patients.exists(tx, tenantId, input.patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      if (!(await this.repo.doctorWorksAt(tx, doctorId, input.branchId))) throw Err.badRequest('doctor_not_at_branch', 'The doctor does not work at this branch');
      const id = await this.repo.create(tx, tenantId, { appointmentId: null, patientId: input.patientId, doctorId, branchId: input.branchId, createdBy: a.memberId });
      return { id, created: true };
    });
  }

  /** The whole visit screen: notes, amendments, procedures, prescriptions, chart entries and the patient's alerts. */
  get(id: string) {
    this.access.assertRead();
    return this.db.run(async (tx, tenantId) => {
      const v = await this.repo.get(tx, id);
      if (!v) throw visitNotFound();
      const a = await this.access.actor(tx);
      await this.audit.recordView(tx, tenantId, 'visit', id);
      const [patient, amendments, procedures, prescriptions, chart] = await Promise.all([
        this.patients.clinicalSummary(tx, tenantId, v.patient_id),
        this.repo.amendments(tx, id), this.repo.procedures(tx, id), this.repo.prescriptions(tx, { visitId: id }), this.repo.chart(tx, v.patient_id, id),
      ]);
      return {
        ...v, patient, amendments, procedures, prescriptions, chart,
        // what this member may do here; the server checks again on every write
        can: {
          writeNotes: v.status === 'draft' && ClinicalAccess.writesVisit(a, v.doctor_id),
          amend: v.status === 'final' && ClinicalAccess.writesVisit(a, v.doctor_id),
          procedures: ClinicalAccess.writesTreatment(a, v.doctor_id),
          prescribe: ClinicalAccess.writesVisit(a, v.doctor_id),
          chart: a.can('clinical:write'),
        },
      };
    });
  }

  saveNotes(id: string, input: VisitNotesInput) {
    return this.db.run(async (tx) => {
      const v = await this.writable(tx, id);
      if (v.status === 'final') throw Err.conflict('visit_finalized', 'The visit is final; add an amendment instead');
      const notes: Partial<Record<NoteField, string | null>> = {};
      for (const [k, col] of Object.entries(NOTE_COLUMN)) if (k in input) notes[col] = input[k as keyof VisitNotesInput] ?? null;
      await this.repo.saveNotes(tx, id, notes);
    }).then(() => this.get(id));
  }

  /** CLR-06: the doctor finalizes (the appointment's completion does it too, in the database). */
  finalize(id: string) {
    return this.db.run(async (tx) => {
      const v = await this.writable(tx, id);
      if (v.status === 'final') throw Err.conflict('visit_finalized', 'The visit is already final');
      await this.repo.finalize(tx, id, (await this.access.actor(tx)).memberId);
    }).then(() => this.get(id));
  }

  /** CLR-06: the author (the visit's doctor) or the owner amends a final note, with a reason; the original stays. */
  amend(id: string, input: AmendmentInput) {
    return this.db.run(async (tx, tenantId) => {
      const v = await this.writable(tx, id);
      if (v.status !== 'final') throw Err.conflict('visit_not_final', 'The visit is still a draft; edit the notes directly');
      await this.repo.addAmendment(tx, tenantId, { visitId: id, field: input.field, text: input.text, reason: input.reason, authorId: (await this.access.actor(tx)).memberId });
    }).then(() => this.get(id));
  }

  /** VISIT-003: what was done. From a plan item, the service, tooth and estimated price come from the item. */
  addProcedure(id: string, input: NewProcedureInput) {
    return this.db.run(async (tx, tenantId) => {
      const v = await this.repo.lock(tx, id);
      if (!v) throw visitNotFound();
      const a = await this.access.actor(tx);
      ClinicalAccess.assertTreatmentWriter(a, v.doctor_id);
      const item = input.planItemId ? await this.repo.planItem(tx, input.planItemId) : undefined;
      if (input.planItemId) {
        if (!item || item.patient_id !== v.patient_id) throw Err.badRequest('plan_item_mismatch', 'This plan item belongs to another patient');
        if (!['accepted', 'in_progress', 'completed'].includes(item.plan_status)) throw Err.conflict('plan_not_accepted', 'Record the patient\'s acceptance of the plan first');
        if (item.status === 'done' || item.status === 'cancelled') throw Err.conflict('plan_item_closed', `This plan item is ${item.status}`);
        if (input.serviceId && input.serviceId !== item.service_id) throw Err.badRequest('plan_item_mismatch', 'The service differs from the plan item');
      }
      const serviceId = input.serviceId ?? item!.service_id;
      const service = await this.repo.service(tx, serviceId);
      // a deleted service is gone from the price list, but an item the patient already accepted in a plan can still be done
      if (!service || (service.deleted && !item)) throw Err.badRequest('service_not_found', 'Service not found');
      const priceMinor = priceFor(service, input.priceMinor ?? item?.price_minor);
      await this.repo.addProcedure(tx, tenantId, {
        visitId: id, serviceId, doctorId: v.doctor_id, planItemId: item?.id ?? null,
        toothCode: input.toothCode !== undefined ? input.toothCode : item?.tooth_code ?? null,
        surfaces: cleanSurfaces(input.surfaces ?? item?.surfaces), priceMinor,
        // the doctor's commission rate is frozen on the procedure (payouts themselves are a later feature)
        commissionBp: await this.repo.doctorCommission(tx, v.doctor_id), notes: input.notes ?? null, createdBy: a.memberId,
      });
    }).then(() => this.get(id));
  }

  /** Only while the visit is a draft and the procedure is not billed (the database refuses otherwise). */
  removeProcedure(id: string, procedureId: string) {
    return this.db.run(async (tx) => {
      const v = await this.repo.lock(tx, id);
      if (!v) throw visitNotFound();
      ClinicalAccess.assertTreatmentWriter(await this.access.actor(tx), v.doctor_id);
      if (v.status === 'final') throw Err.conflict('visit_finalized', 'The visit is final; its procedures stay as recorded');
      if (!(await this.repo.removeProcedure(tx, id, procedureId))) throw Err.notFound('procedure_not_found', 'Procedure not found');
    }).then(() => this.get(id));
  }

  /** VISIT-004: issued at once and never edited; a correction is a new prescription that replaces the old one. */
  prescribe(id: string, input: NewPrescriptionInput) {
    return this.db.run(async (tx, tenantId) => {
      const v = await this.writable(tx, id);
      if (input.replacesId) {
        const old = await this.repo.prescriptionPatient(tx, input.replacesId);
        if (!old || old.patient_id !== v.patient_id) throw Err.badRequest('prescription_not_found', 'The prescription to correct was not found for this patient');
      }
      return this.repo.addPrescription(tx, tenantId, {
        visitId: id, patientId: v.patient_id, doctorId: v.doctor_id, notes: input.notes ?? null, replacesId: input.replacesId ?? null,
        issuedBy: (await this.access.actor(tx)).memberId, items: input.items,
      });
    }).then((rxId) => this.prescription(rxId));
  }

  /** One prescription with what its printout needs (clinic name/logo and branch details come from the profile). */
  prescription(id: string) {
    this.access.assertRead();
    return this.db.run(async (tx, tenantId) => {
      const [rx] = await this.repo.prescriptions(tx, { id });
      if (!rx) throw Err.notFound('prescription_not_found', 'Prescription not found');
      const v = (await this.repo.get(tx, rx.visit_id))!;
      await this.audit.recordView(tx, tenantId, 'prescription', id);
      const p = await this.patients.clinicalSummary(tx, tenantId, rx.patient_id);
      return {
        ...rx, branch_id: v.branch_id, doctor: v.doctor,
        patient: p && { id: p.id, full_name: p.full_name, file_no: p.file_no, date_of_birth: p.date_of_birth, gender: p.gender },
      };
    });
  }

  /** The clinical timeline of a patient (newest first). */
  forPatient(patientId: string) {
    this.access.assertRead();
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      return this.repo.forPatient(tx, patientId, 100);
    });
  }

  // ---------- chart (CHART-001) ----------
  chart(patientId: string) {
    this.access.assertRead();
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      await this.audit.recordView(tx, tenantId, 'patient_chart', patientId);
      const entries = await this.repo.chart(tx, patientId);
      return { current: currentChart(entries), entries };
    });
  }

  /** Append entries (a correction is a new entry, never an edit). With a visit, the entries belong to it. */
  addChartEntries(patientId: string, input: ChartEntriesInput) {
    return this.db.run(async (tx, tenantId) => {
      const a = await this.access.actor(tx);
      if (!a.can('clinical:write')) throw Err.forbidden('missing_permission', 'Missing permission: clinical:write');
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      if (input.visitId) {
        const v = await this.repo.lock(tx, input.visitId);
        if (!v || v.patient_id !== patientId) throw Err.badRequest('visit_mismatch', 'The visit belongs to another patient');
      }
      await this.repo.addChartEntries(tx, tenantId, patientId, input.visitId ?? null, a.memberId,
        input.entries.map((e) => ({ ...e, surfaces: cleanSurfaces(e.surfaces) })));
    }).then(() => this.chart(patientId));
  }

  /** The visit, locked, with the actor allowed to write its notes. */
  private async writable(tx: Tx, id: string) {
    const v = await this.repo.lock(tx, id);
    if (!v) throw visitNotFound();
    ClinicalAccess.assertVisitWriter(await this.access.actor(tx), v.doctor_id);
    return v;
  }
}
