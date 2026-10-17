import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Tx } from '@dental/db';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { dateInZone, safeTimeZone } from '../../shared/time/clinic-time';
import { PatientDirectory } from '../patients';
import { appendCallNote } from './clinical-rules';
import type { NewRecallInput } from './clinical.schemas';
import { RecallsRepository } from './recalls.repository';

const notFound = () => Err.notFound('recall_not_found', 'Follow-up not found');
const OPEN = ['pending', 'contacted'];

/**
 * The manual follow-up list (SRS VISIT-005): doctors or reception add a follow-up; reception works the due list —
 * records a call, books (links the appointment) or dismisses. No message is ever sent automatically (Part D).
 */
@Injectable()
export class RecallsService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: RecallsRepository,
    private readonly patients: PatientDirectory,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  list(view: 'due' | 'upcoming' | 'closed', limit: number) {
    return this.db.run(async (tx, tenantId) => {
      const today = dateInZone(Date.now(), safeTimeZone(await this.repo.timezone(tx, tenantId)));
      return { today, items: await this.repo.list(tx, view, today, limit) };
    });
  }

  forPatient(patientId: string) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      return this.repo.forPatient(tx, patientId);
    });
  }

  create(patientId: string, input: NewRecallInput) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      let doctorId = input.doctorId ?? null;
      if (input.sourceVisitId) {
        const v = await this.repo.visitPatient(tx, input.sourceVisitId);
        if (!v || v.patient_id !== patientId) throw Err.badRequest('visit_mismatch', 'The visit belongs to another patient');
        doctorId ??= v.doctor_id;
      }
      const id = await this.repo.create(tx, tenantId, {
        patientId, reason: input.reason, dueDate: input.dueDate, notes: input.notes ?? null, doctorId, sourceVisitId: input.sourceVisitId ?? null,
        createdBy: this.member(),
      });
      return (await this.repo.get(tx, id))!;
    });
  }

  /** A call made (answered or not): one more attempt, and a line in the call log. */
  contact(id: string, note: string) {
    return this.db.run(async (tx, tenantId) => {
      const r = await this.open(tx, id);
      const at = dateInZone(Date.now(), safeTimeZone(await this.repo.timezone(tx, tenantId)));
      await this.repo.update(tx, id, {
        status: 'contacted', contact_attempts: r.contact_attempts + 1, last_contacted_at: new Date(),
        notes: appendCallNote(r.notes, at, await this.repo.memberName(tx, this.member()), note),
      });
      return (await this.repo.get(tx, id))!;
    });
  }

  /** The appointment was booked (from the follow-up list or the visit): the follow-up waits for it. */
  book(id: string, appointmentId: string) {
    return this.db.run(async (tx) => {
      const r = await this.open(tx, id);
      const appt = await this.repo.appointment(tx, appointmentId);
      if (!appt || appt.patient_id !== r.patient_id) throw Err.badRequest('appointment_mismatch', 'The appointment belongs to another patient');
      if (!['pending', 'confirmed', 'checked_in'].includes(appt.status)) throw Err.conflict('appointment_not_open', 'The appointment is no longer open', { status: appt.status });
      await this.repo.update(tx, id, { status: 'booked', appointment_id: appointmentId });
      return (await this.repo.get(tx, id))!;
    });
  }

  dismiss(id: string, reason: string | null) {
    return this.db.run(async (tx, tenantId) => {
      const r = await this.open(tx, id);
      const at = dateInZone(Date.now(), safeTimeZone(await this.repo.timezone(tx, tenantId)));
      const notes = reason ? appendCallNote(r.notes, at, await this.repo.memberName(tx, this.member()), reason) : r.notes;
      await this.repo.update(tx, id, { status: 'dismissed', notes });
      return (await this.repo.get(tx, id))!;
    });
  }

  private async open(tx: Tx, id: string) {
    const r = await this.repo.lock(tx, id);
    if (!r) throw notFound();
    if (!OPEN.includes(r.status)) throw Err.conflict('recall_closed', `This follow-up is ${r.status}`, { status: r.status });
    return r;
  }

  private member(): string {
    const m = this.cls.get('memberId');
    if (!m) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    return m;
  }
}
