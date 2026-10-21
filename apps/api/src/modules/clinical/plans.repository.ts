import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

export type PlanStatus = 'draft' | 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
export type ItemStatus = 'planned' | 'scheduled' | 'done' | 'cancelled';
const memberName = (alias: string) => sql<string | null>`(select u.full_name from tenant_members m join users u on u.id = m.user_id where m.id = ${sql.ref(alias)})`;

/** Treatment plans and their items (SRS TPLAN-*). Status flow, estimate and progress are enforced by the database. */
@Injectable()
export class PlansRepository {
  private plans(tx: Tx) {
    return tx.selectFrom('treatment_plans as p').innerJoin('doctors as d', 'd.id', 'p.doctor_id').select([
      'p.id', 'p.patient_id', 'p.doctor_id', 'p.title', 'p.status', 'p.total_estimate_minor', 'p.notes', 'p.accepted_at', 'p.created_at', 'p.updated_at',
      memberName('p.accepted_by').as('accepted_by_name'),
      sql<{ name_ar: string | null; name_en: string | null }>`json_build_object('name_ar', d.name_ar, 'name_en', d.name_en)`.as('doctor'),
    ]);
  }

  private static plan<T extends { status: string; total_estimate_minor: string }>(r: T) {
    return { ...r, status: r.status as PlanStatus, total_estimate_minor: Number(r.total_estimate_minor) };
  }

  get(tx: Tx, id: string) {
    return this.plans(tx).where('p.id', '=', id).executeTakeFirst().then((r) => r && PlansRepository.plan(r));
  }

  forPatient(tx: Tx, patientId: string) {
    return this.plans(tx).where('p.patient_id', '=', patientId).orderBy('p.created_at', 'desc').execute().then((rows) => rows.map(PlansRepository.plan));
  }

  lock(tx: Tx, id: string) {
    return tx.selectFrom('treatment_plans').select(['id', 'status', 'doctor_id', 'patient_id']).where('id', '=', id).forUpdate().executeTakeFirst()
      .then((r) => r && { ...r, status: r.status as PlanStatus });
  }

  async create(tx: Tx, tenantId: string, p: { patientId: string; doctorId: string; title: string; notes: string | null }): Promise<string> {
    const r = await tx.insertInto('treatment_plans').values({ tenant_id: tenantId, patient_id: p.patientId, doctor_id: p.doctorId, title: p.title, notes: p.notes })
      .returning('id').executeTakeFirstOrThrow();
    return r.id;
  }

  async update(tx: Tx, id: string, f: { title?: string; notes?: string | null; status?: PlanStatus; accepted_at?: Date; accepted_by?: string }): Promise<void> {
    if (Object.keys(f).length) await tx.updateTable('treatment_plans').set(f).where('id', '=', id).execute();
  }

  /**
   * TPLAN-004: the invoice lines of each plan's procedures (procedure -> plan item), with their invoice's figures.
   * Issued, partly paid and paid invoices only (a draft is not billed yet, a void one never was).
   */
  async invoiceLines(tx: Tx, planIds: string[]) {
    if (!planIds.length) return [];
    const r = await sql<{ plan_id: string; line_total_minor: string; subtotal_minor: string; total_minor: string; paid_minor: string; balance_minor: string }>`
      select pi.plan_id, ii.line_total_minor, i.subtotal_minor, i.total_minor, i.paid_minor, i.balance_minor
      from invoice_items ii join invoices i on i.id = ii.invoice_id
      join visit_procedures vp on vp.id = ii.visit_procedure_id join treatment_plan_items pi on pi.id = vp.plan_item_id
      where pi.plan_id = any(${planIds}::uuid[]) and i.status in ('issued', 'partially_paid', 'paid')`.execute(tx);
    return r.rows.map((x) => ({ plan_id: x.plan_id, line_total_minor: Number(x.line_total_minor), subtotal_minor: Number(x.subtotal_minor), total_minor: Number(x.total_minor), paid_minor: Number(x.paid_minor), balance_minor: Number(x.balance_minor) }));
  }

  items(tx: Tx, planIds: string[]) {
    if (!planIds.length) return Promise.resolve([]);
    return tx.selectFrom('treatment_plan_items as i').innerJoin('services as s', 's.id', 'i.service_id')
      .leftJoin('appointments as a', 'a.id', 'i.appointment_id')
      .select([
        'i.id', 'i.plan_id', 'i.service_id', 's.name_ar as service_ar', 's.name_en as service_en', 's.duration_minutes', 'i.tooth_code', 'i.surfaces',
        'i.price_minor', 'i.discount_minor', 'i.status', 'i.appointment_id', 'i.sort_order', 'a.starts_at as appointment_at',
        sql<string | null>`(select vp.visit_id from visit_procedures vp where vp.plan_item_id = i.id limit 1)`.as('done_visit_id'),
      ])
      .where('i.plan_id', 'in', planIds).orderBy('i.sort_order').orderBy('i.id').execute()
      .then((rows) => rows.map((r) => ({ ...r, status: r.status as ItemStatus, price_minor: Number(r.price_minor), discount_minor: Number(r.discount_minor) })));
  }

  item(tx: Tx, planId: string, id: string) {
    return tx.selectFrom('treatment_plan_items').select(['id', 'status', 'service_id', 'price_minor', 'discount_minor']).where('id', '=', id).where('plan_id', '=', planId)
      .forUpdate().executeTakeFirst().then((r) => r && { ...r, status: r.status as ItemStatus, price_minor: Number(r.price_minor), discount_minor: Number(r.discount_minor) });
  }

  nextSortOrder(tx: Tx, planId: string) {
    return tx.selectFrom('treatment_plan_items').select((e) => sql<number>`coalesce(max(${e.ref('sort_order')}), -1) + 1`.as('n'))
      .where('plan_id', '=', planId).executeTakeFirstOrThrow().then((r) => Number(r.n));
  }

  async addItem(tx: Tx, tenantId: string, planId: string, i: { serviceId: string; toothCode: number | null; surfaces: string[]; priceMinor: number; discountMinor: number; sortOrder: number }): Promise<void> {
    await tx.insertInto('treatment_plan_items').values({
      tenant_id: tenantId, plan_id: planId, service_id: i.serviceId, tooth_code: i.toothCode, surfaces: i.surfaces,
      price_minor: i.priceMinor, discount_minor: i.discountMinor, sort_order: i.sortOrder,
    }).execute();
  }

  async updateItem(tx: Tx, id: string, f: { tooth_code?: number | null; surfaces?: string[]; price_minor?: number; discount_minor?: number; sort_order?: number; status?: ItemStatus; appointment_id?: string | null }): Promise<void> {
    if (Object.keys(f).length) await tx.updateTable('treatment_plan_items').set(f).where('id', '=', id).execute();
  }

  async removeItem(tx: Tx, id: string): Promise<void> {
    await tx.deleteFrom('treatment_plan_items').where('id', '=', id).execute();
  }

  /** The doctor's latest "next visit" note for this patient: part of the plan's next recommended visit (TPLAN-004). */
  latestNextVisitNote(tx: Tx, patientId: string, doctorId: string) {
    return tx.selectFrom('visits').select(['next_visit_note', 'visit_at']).where('patient_id', '=', patientId).where('doctor_id', '=', doctorId)
      .where('next_visit_note', 'is not', null).orderBy('visit_at', 'desc').limit(1).executeTakeFirst();
  }

  /** An open appointment of this patient, for linking a planned item or a follow-up to it. */
  openAppointment(tx: Tx, id: string) {
    return tx.selectFrom('appointments').select(['id', 'patient_id', 'status']).where('id', '=', id).executeTakeFirst();
  }

  /** A service's price range: for a new item only while it is on the price list, for an item already planned even once deleted. */
  service(tx: Tx, id: string, withDeleted = false) {
    let q = tx.selectFrom('services').select(['id', 'price_minor', 'price_max_minor']).where('id', '=', id);
    if (!withDeleted) q = q.where('deleted_at', 'is', null);
    return q.executeTakeFirst()
      .then((s) => s && { id: s.id, price_minor: Number(s.price_minor), price_max_minor: s.price_max_minor === null ? null : Number(s.price_max_minor) });
  }

  doctorExists(tx: Tx, id: string) {
    return tx.selectFrom('doctors').select('id').where('id', '=', id).where('is_active', '=', true).executeTakeFirst();
  }
}
