import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { PatientDirectory } from '../patients';
import { ClinicalAccess, type ClinicalActor } from './clinical-access';
import { cleanSurfaces, planBilling, planSummary, priceFor } from './clinical-rules';
import type { EditPlanInput, EditPlanItemInput, NewPlanInput, NewPlanItemInput } from './clinical.schemas';
import { PlansRepository, type PlanStatus } from './plans.repository';

const planNotFound = () => Err.notFound('plan_not_found', 'Treatment plan not found');
const EDITABLE: PlanStatus[] = ['draft', 'proposed'];
/** The moves a person makes; accepted -> in progress -> completed follow the items (database). */
const MANUAL: Record<'proposed' | 'accepted' | 'cancelled', PlanStatus[]> = {
  proposed: ['draft'], accepted: ['proposed'], cancelled: ['draft', 'proposed', 'accepted', 'in_progress'],
};

/**
 * Treatment plans (SRS TPLAN-001…004). Doctors write their own plans (treatments:write:own), owners all; members who
 * read patients read plans. The estimate, the status flow, the frozen items after acceptance and the progress from
 * performed procedures are enforced by the database; this service adds who may act, prices (CLR-16) and acceptance
 * (CLR-11: the member and the time). Invoiced and paid amounts join the summary with billing (Phase E).
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: PlansRepository,
    private readonly access: ClinicalAccess,
    private readonly patients: PatientDirectory,
  ) {}

  forPatient(patientId: string) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      const plans = await this.repo.forPatient(tx, patientId);
      const [items, a] = await Promise.all([this.repo.items(tx, plans.map((p) => p.id)), this.access.actor(tx)]);
      const money = await this.billingOf(tx, a, plans);
      return plans.map((p) => ({ ...p, summary: planSummary(items.filter((i) => i.plan_id === p.id)), billing: money.get(p.id) ?? null }));
    });
  }

  get(id: string) {
    return this.db.run((tx) => this.view(tx, id));
  }

  create(patientId: string, input: NewPlanInput) {
    return this.db.run(async (tx, tenantId) => {
      const a = await this.access.actor(tx);
      const doctorId = input.doctorId ?? a.doctorId;
      if (!doctorId) throw Err.badRequest('doctor_required', 'Choose the treating doctor');
      ClinicalAccess.assertTreatmentWriter(a, doctorId);
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      if (!(await this.repo.doctorExists(tx, doctorId))) throw Err.badRequest('doctor_not_found', 'Doctor not found');
      const id = await this.repo.create(tx, tenantId, { patientId, doctorId, title: input.title, notes: input.notes ?? null });
      return this.view(tx, id);
    });
  }

  edit(id: string, input: EditPlanInput) {
    return this.db.run(async (tx) => {
      const p = await this.writable(tx, id);
      if (p.status === 'completed' || p.status === 'cancelled') throw Err.conflict('plan_closed', `The plan is ${p.status}`);
      await this.repo.update(tx, id, { ...(input.title !== undefined && { title: input.title }), ...(input.notes !== undefined && { notes: input.notes }) });
      return this.view(tx, id);
    });
  }

  /** draft -> proposed -> accepted (who and when: CLR-11), or cancelled from any open status (TPLAN-002). */
  setStatus(id: string, to: 'proposed' | 'accepted' | 'cancelled') {
    return this.db.run(async (tx) => {
      const p = await this.writable(tx, id);
      if (!MANUAL[to].includes(p.status)) throw Err.conflict('invalid_transition', `A ${p.status} plan cannot become ${to}`, { from: p.status, to });
      if (to !== 'cancelled' && planSummary(await this.repo.items(tx, [id])).items_total === 0) throw Err.badRequest('plan_empty', 'Add at least one item first');
      const a = await this.access.actor(tx);
      await this.repo.update(tx, id, to === 'accepted' ? { status: to, accepted_at: new Date(), accepted_by: a.memberId } : { status: to });
      return this.view(tx, id);
    });
  }

  addItem(id: string, input: NewPlanItemInput) {
    return this.db.run(async (tx, tenantId) => {
      await this.editableItems(tx, id);
      const service = await this.repo.service(tx, input.serviceId);
      if (!service) throw Err.badRequest('service_not_found', 'Service not found');
      const priceMinor = priceFor(service, input.priceMinor);
      const discountMinor = input.discountMinor ?? 0;
      if (discountMinor > priceMinor) throw Err.badRequest('discount_too_large', 'The discount cannot exceed the price');
      await this.repo.addItem(tx, tenantId, id, {
        serviceId: input.serviceId, toothCode: input.toothCode ?? null, surfaces: cleanSurfaces(input.surfaces), priceMinor, discountMinor,
        sortOrder: await this.repo.nextSortOrder(tx, id),
      });
      return this.view(tx, id);
    });
  }

  editItem(id: string, itemId: string, input: EditPlanItemInput) {
    return this.db.run(async (tx) => {
      await this.editableItems(tx, id);
      const item = await this.repo.item(tx, id, itemId);
      if (!item) throw Err.notFound('plan_item_not_found', 'Plan item not found');
      const priceMinor = input.priceMinor !== undefined ? priceFor((await this.repo.service(tx, item.service_id, true))!, input.priceMinor) : item.price_minor;
      const discountMinor = input.discountMinor ?? item.discount_minor;
      if (discountMinor > priceMinor) throw Err.badRequest('discount_too_large', 'The discount cannot exceed the price');
      await this.repo.updateItem(tx, itemId, {
        ...(input.toothCode !== undefined && { tooth_code: input.toothCode }), ...(input.surfaces && { surfaces: cleanSurfaces(input.surfaces) }),
        ...(input.priceMinor !== undefined && { price_minor: priceMinor }), ...(input.discountMinor !== undefined && { discount_minor: discountMinor }),
        ...(input.sortOrder !== undefined && { sort_order: input.sortOrder }),
      });
      return this.view(tx, id);
    });
  }

  /** Only while the plan is a draft or proposal; an accepted item is cancelled instead and stays visible. */
  removeItem(id: string, itemId: string) {
    return this.db.run(async (tx) => {
      await this.editableItems(tx, id);
      if (!(await this.repo.item(tx, id, itemId))) throw Err.notFound('plan_item_not_found', 'Plan item not found');
      await this.repo.removeItem(tx, itemId);
      return this.view(tx, id);
    });
  }

  cancelItem(id: string, itemId: string) {
    return this.db.run(async (tx) => {
      const p = await this.writable(tx, id);
      if (p.status === 'cancelled') throw Err.conflict('plan_closed', 'The plan is cancelled');
      const item = await this.repo.item(tx, id, itemId);
      if (!item) throw Err.notFound('plan_item_not_found', 'Plan item not found');
      if (item.status === 'done' || item.status === 'cancelled') throw Err.conflict('plan_item_closed', `This item is ${item.status}`);
      await this.repo.updateItem(tx, itemId, { status: 'cancelled' });
      return this.view(tx, id);
    });
  }

  /**
   * APPT-007: the next appointment is booked for a planned item. Reception (appointments:write) or the plan's writer
   * links them; the item becomes "scheduled", and goes back to "planned" if the appointment is cancelled or missed.
   */
  scheduleItem(id: string, itemId: string, appointmentId: string) {
    return this.db.run(async (tx) => {
      const p = await this.repo.lock(tx, id);
      if (!p) throw planNotFound();
      const a = await this.access.actor(tx);
      if (!a.can('appointments:write') && !ClinicalAccess.writesTreatment(a, p.doctor_id)) throw Err.forbidden('missing_permission', 'Missing permission: appointments:write');
      if (p.status === 'completed' || p.status === 'cancelled') throw Err.conflict('plan_closed', `The plan is ${p.status}`);
      const item = await this.repo.item(tx, id, itemId);
      if (!item) throw Err.notFound('plan_item_not_found', 'Plan item not found');
      if (item.status === 'done' || item.status === 'cancelled') throw Err.conflict('plan_item_closed', `This item is ${item.status}`);
      const appt = await this.repo.openAppointment(tx, appointmentId);
      if (!appt || appt.patient_id !== p.patient_id) throw Err.badRequest('appointment_mismatch', 'The appointment belongs to another patient');
      if (!['pending', 'confirmed', 'checked_in'].includes(appt.status)) throw Err.conflict('appointment_not_open', 'The appointment is no longer open', { status: appt.status });
      await this.repo.updateItem(tx, itemId, { status: 'scheduled', appointment_id: appointmentId });
      return this.view(tx, id);
    });
  }

  private async view(tx: Tx, id: string) {
    const plan = await this.repo.get(tx, id);
    if (!plan) throw planNotFound();
    const a = await this.access.actor(tx);
    const items = await this.repo.items(tx, [id]);
    const next = items.find((i) => i.status === 'planned' || i.status === 'scheduled') ?? null;
    // the doctor's note is clinical text: only for members who read clinical data
    const clinical = a.can('clinical:read') || a.can('clinical:write');
    const note = clinical ? await this.repo.latestNextVisitNote(tx, plan.patient_id, plan.doctor_id) : undefined;
    return {
      ...plan, items, summary: planSummary(items), billing: (await this.billingOf(tx, a, [plan])).get(plan.id) ?? null,
      next: { item: next, next_visit_note: note?.next_visit_note ?? null, noted_at: note?.visit_at ?? null },
      can: { write: ClinicalAccess.writesTreatment(a, plan.doctor_id), schedule: a.can('appointments:write') || ClinicalAccess.writesTreatment(a, plan.doctor_id) },
    };
  }

  private async writable(tx: Tx, id: string) {
    const p = await this.repo.lock(tx, id);
    if (!p) throw planNotFound();
    ClinicalAccess.assertTreatmentWriter(await this.access.actor(tx), p.doctor_id);
    return p;
  }

  private async editableItems(tx: Tx, id: string) {
    const p = await this.writable(tx, id);
    if (!EDITABLE.includes(p.status)) throw Err.conflict('plan_locked', 'Items of an accepted plan are fixed; cancel an item, or start a new plan');
    return p;
  }

  /**
   * TPLAN-004: invoiced, paid and balance per plan, for members who may see the patient's billing (BILLING-005):
   * invoices:read, or invoices:read:own for the plan's own doctor. Others get no money figures (null).
   */
  private async billingOf(tx: Tx, a: ClinicalActor, plans: readonly { id: string; doctor_id: string }[]) {
    const shown = plans.filter((p) => a.can('invoices:read') || (a.can('invoices:read:own') && a.doctorId === p.doctor_id));
    const lines = await this.repo.invoiceLines(tx, shown.map((p) => p.id));
    return new Map(shown.map((p) => [p.id, planBilling(lines.filter((l) => l.plan_id === p.id))]));
  }
}
