import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import type { NoteField } from './clinical-rules';

const memberName = (alias: string) => sql<string | null>`(select u.full_name from tenant_members m join users u on u.id = m.user_id where m.id = ${sql.ref(alias)})`;
const n = (v: string | number | null) => (v === null ? null : Number(v));

export interface VisitRow {
  id: string; status: 'draft' | 'final'; appointment_id: string | null; patient_id: string; doctor_id: string; branch_id: string;
  visit_at: Date; chief_complaint: string | null; diagnosis: string | null; clinical_notes: string | null; next_visit_note: string | null;
  finalized_at: Date | null; finalized_by_name: string | null; created_at: Date;
  doctor: { name_ar: string | null; name_en: string | null; title_ar: string | null; title_en: string | null };
  branch: { name_ar: string | null; name_en: string | null };
}

/** Visits, their amendments, procedures, prescriptions and the chart (SRS VISIT-*, CHART-001). RLS scopes every query. */
@Injectable()
export class VisitsRepository {
  private visits(tx: Tx) {
    return tx.selectFrom('visits as v').innerJoin('doctors as d', 'd.id', 'v.doctor_id').innerJoin('branches as b', 'b.id', 'v.branch_id')
      .select([
        'v.id', 'v.status', 'v.appointment_id', 'v.patient_id', 'v.doctor_id', 'v.branch_id', 'v.visit_at', 'v.chief_complaint', 'v.diagnosis',
        'v.clinical_notes', 'v.next_visit_note', 'v.finalized_at', 'v.created_at', memberName('v.finalized_by').as('finalized_by_name'),
        sql<VisitRow['doctor']>`json_build_object('name_ar', d.name_ar, 'name_en', d.name_en, 'title_ar', d.title_ar, 'title_en', d.title_en)`.as('doctor'),
        sql<VisitRow['branch']>`json_build_object('name_ar', b.name_ar, 'name_en', b.name_en)`.as('branch'),
      ]);
  }

  async get(tx: Tx, id: string): Promise<VisitRow | undefined> {
    return (await this.visits(tx).where('v.id', '=', id).executeTakeFirst()) as VisitRow | undefined;
  }

  lock(tx: Tx, id: string) {
    return tx.selectFrom('visits').select(['id', 'status', 'doctor_id', 'patient_id', 'branch_id']).where('id', '=', id).forUpdate().executeTakeFirst();
  }

  byAppointment(tx: Tx, appointmentId: string) {
    return tx.selectFrom('visits').select('id').where('appointment_id', '=', appointmentId).executeTakeFirst();
  }

  /** The appointment a visit is opened on, locked so two clicks cannot open two visits. */
  appointmentForVisit(tx: Tx, id: string) {
    return tx.selectFrom('appointments').select(['id', 'status', 'patient_id', 'doctor_id', 'branch_id']).where('id', '=', id).forUpdate().executeTakeFirst();
  }

  doctorWorksAt(tx: Tx, doctorId: string, branchId: string) {
    return tx.selectFrom('doctor_branches as db').innerJoin('doctors as d', 'd.id', 'db.doctor_id')
      .select('db.doctor_id').where('db.doctor_id', '=', doctorId).where('db.branch_id', '=', branchId).where('d.is_active', '=', true).executeTakeFirst();
  }

  async create(tx: Tx, tenantId: string, v: { appointmentId: string | null; patientId: string; doctorId: string; branchId: string; createdBy: string }): Promise<string> {
    const r = await tx.insertInto('visits').values({
      tenant_id: tenantId, appointment_id: v.appointmentId, patient_id: v.patientId, doctor_id: v.doctorId, branch_id: v.branchId, created_by: v.createdBy,
    }).returning('id').executeTakeFirstOrThrow();
    return r.id;
  }

  async saveNotes(tx: Tx, id: string, notes: Partial<Record<NoteField, string | null>>): Promise<void> {
    if (Object.keys(notes).length) await tx.updateTable('visits').set(notes).where('id', '=', id).execute();
  }

  async finalize(tx: Tx, id: string, memberId: string): Promise<void> {
    await tx.updateTable('visits').set({ status: 'final', finalized_by: memberId }).where('id', '=', id).where('status', '=', 'draft').execute();
  }

  async addAmendment(tx: Tx, tenantId: string, a: { visitId: string; field: NoteField; text: string; reason: string; authorId: string }): Promise<void> {
    await tx.insertInto('visit_amendments').values({ tenant_id: tenantId, visit_id: a.visitId, field: a.field, new_text: a.text, reason: a.reason, author_id: a.authorId }).execute();
  }

  amendments(tx: Tx, visitId: string) {
    return tx.selectFrom('visit_amendments as a').select(['a.id', 'a.field', 'a.new_text', 'a.reason', 'a.created_at', memberName('a.author_id').as('author_name')])
      .where('a.visit_id', '=', visitId).orderBy('a.created_at').execute();
  }

  /** A patient's visits, newest first: the clinical timeline of the profile. */
  forPatient(tx: Tx, patientId: string, limit: number) {
    return this.visits(tx).select((eb) => [
      eb.selectFrom('visit_procedures as vp').select((e) => e.fn.countAll<string>().as('c')).whereRef('vp.visit_id', '=', 'v.id').as('procedures'),
    ]).where('v.patient_id', '=', patientId).orderBy('v.visit_at', 'desc').limit(limit).execute()
      .then((rows) => rows.map((r) => ({ ...(r as unknown as VisitRow), procedures: Number(r.procedures ?? 0) })));
  }

  /** The clinic's timezone, for "today" (redesign R5). */
  timezone(tx: Tx, tenantId: string) {
    return tx.selectFrom('tenants').select('timezone').where('id', '=', tenantId).executeTakeFirstOrThrow().then((t) => t.timezone);
  }

  /**
   * The visits list (redesign R5), newest first, keyset-paged on (visit_at, id). Each row carries the patient, how many
   * procedures it has and how many of them are on no invoice yet. RLS limits a branch-limited member to their branches.
   */
  async list(tx: Tx, q: { from?: Date; to?: Date; draftsOnly: boolean; doctorId: string | null; limit: number; after?: string }) {
    let query = this.visits(tx).innerJoin('patients as p', 'p.id', 'v.patient_id').select((eb) => [
      sql<{ id: string; full_name: string; file_no: number }>`json_build_object('id', p.id, 'full_name', p.full_name, 'file_no', p.file_no)`.as('patient'),
      eb.selectFrom('visit_procedures as vp').select((e) => e.fn.countAll<string>().as('c')).whereRef('vp.visit_id', '=', 'v.id').as('procedures'),
      eb.selectFrom('visit_procedures as vp').select((e) => e.fn.countAll<string>().as('c')).whereRef('vp.visit_id', '=', 'v.id')
        .where(sql<boolean>`not exists (select 1 from invoice_items ii join invoices i on i.id = ii.invoice_id where ii.visit_procedure_id = vp.id and i.status <> 'void')`)
        .as('unbilled'),
    ]);
    if (q.from) query = query.where('v.visit_at', '>=', q.from);
    if (q.to) query = query.where('v.visit_at', '<', q.to);
    if (q.draftsOnly) query = query.where('v.status', '=', 'draft');
    if (q.doctorId) query = query.where('v.doctor_id', '=', q.doctorId);
    // an id this clinic cannot see (RLS) matches no row, so nothing comes back
    if (q.after) query = query.where(sql<boolean>`(v.visit_at, v.id) < (select a.visit_at, a.id from visits a where a.id = ${q.after})`);
    const rows = await query.orderBy('v.visit_at', 'desc').orderBy('v.id', 'desc').limit(q.limit).execute();
    return rows.map((r) => ({ ...(r as unknown as VisitRow & { patient: { id: string; full_name: string; file_no: number } }), procedures: Number(r.procedures ?? 0), unbilled: Number(r.unbilled ?? 0) }));
  }

  // ---------- procedures ----------
  service(tx: Tx, id: string) {
    return tx.selectFrom('services').select(['id', 'price_minor', 'price_max_minor', 'is_active', sql<boolean>`deleted_at is not null`.as('deleted')]).where('id', '=', id).executeTakeFirst()
      .then((s) => s && { ...s, price_minor: Number(s.price_minor), price_max_minor: n(s.price_max_minor) });
  }

  planItem(tx: Tx, id: string) {
    return tx.selectFrom('treatment_plan_items as i').innerJoin('treatment_plans as p', 'p.id', 'i.plan_id')
      .select(['i.id', 'i.service_id', 'i.tooth_code', 'i.surfaces', 'i.price_minor', 'i.status', 'p.patient_id', 'p.status as plan_status'])
      .where('i.id', '=', id).executeTakeFirst()
      .then((r) => r && { ...r, price_minor: Number(r.price_minor) });
  }

  doctorCommission(tx: Tx, doctorId: string) {
    return tx.selectFrom('doctors').select('commission_bp').where('id', '=', doctorId).executeTakeFirstOrThrow().then((d) => d.commission_bp ?? 0);
  }

  async addProcedure(tx: Tx, tenantId: string, p: {
    visitId: string; serviceId: string; doctorId: string; planItemId: string | null; toothCode: number | null; surfaces: string[];
    priceMinor: number; commissionBp: number; notes: string | null; createdBy: string;
  }): Promise<string> {
    const r = await tx.insertInto('visit_procedures').values({
      tenant_id: tenantId, visit_id: p.visitId, service_id: p.serviceId, doctor_id: p.doctorId, plan_item_id: p.planItemId, tooth_code: p.toothCode,
      surfaces: p.surfaces, price_minor: p.priceMinor, commission_bp: p.commissionBp, notes: p.notes, created_by: p.createdBy,
    }).returning('id').executeTakeFirstOrThrow();
    return r.id;
  }

  async removeProcedure(tx: Tx, visitId: string, id: string): Promise<boolean> {
    const r = await tx.deleteFrom('visit_procedures').where('id', '=', id).where('visit_id', '=', visitId).executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  procedures(tx: Tx, visitId: string) {
    return tx.selectFrom('visit_procedures as vp').innerJoin('services as s', 's.id', 'vp.service_id')
      .select([
        'vp.id', 'vp.service_id', 's.name_ar as service_ar', 's.name_en as service_en', 'vp.tooth_code', 'vp.surfaces', 'vp.price_minor',
        'vp.plan_item_id', 'vp.notes', 'vp.created_at',
        sql<boolean>`exists (select 1 from invoice_items ii join invoices i on i.id = ii.invoice_id where ii.visit_procedure_id = vp.id and i.status <> 'void')`.as('billed'),
      ])
      .where('vp.visit_id', '=', visitId).orderBy('vp.created_at').execute()
      .then((rows) => rows.map((r) => ({ ...r, price_minor: Number(r.price_minor) })));
  }

  // ---------- prescriptions ----------
  async addPrescription(tx: Tx, tenantId: string, p: {
    visitId: string; patientId: string; doctorId: string; notes: string | null; replacesId: string | null; issuedBy: string;
    items: { drugName: string; dose?: string | null; frequency?: string | null; duration?: string | null; instructions?: string | null }[];
  }): Promise<string> {
    const { id } = await tx.insertInto('prescriptions').values({
      tenant_id: tenantId, visit_id: p.visitId, patient_id: p.patientId, doctor_id: p.doctorId, notes: p.notes, replaces_id: p.replacesId, issued_by: p.issuedBy,
    }).returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('prescription_items').values(p.items.map((i, k) => ({
      tenant_id: tenantId, prescription_id: id, drug_name: i.drugName, dose: i.dose ?? null, frequency: i.frequency ?? null,
      duration: i.duration ?? null, instructions: i.instructions ?? null, sort_order: k,
    }))).execute();
    return id;
  }

  prescriptionPatient(tx: Tx, id: string) {
    return tx.selectFrom('prescriptions').select(['id', 'patient_id']).where('id', '=', id).executeTakeFirst();
  }

  /** Prescriptions of a visit (or one), each with its lines and whether a correction replaced it. */
  async prescriptions(tx: Tx, where: { visitId: string } | { id: string }) {
    let q = tx.selectFrom('prescriptions as p').select([
      'p.id', 'p.visit_id', 'p.patient_id', 'p.doctor_id', 'p.notes', 'p.issued_at', 'p.replaces_id', memberName('p.issued_by').as('issued_by_name'),
      sql<string | null>`(select c.id from prescriptions c where c.replaces_id = p.id)`.as('replaced_by_id'),
    ]);
    q = 'id' in where ? q.where('p.id', '=', where.id) : q.where('p.visit_id', '=', where.visitId);
    const rx = await q.orderBy('p.issued_at').execute();
    if (!rx.length) return [];
    const items = await tx.selectFrom('prescription_items').select(['id', 'prescription_id', 'drug_name', 'dose', 'frequency', 'duration', 'instructions'])
      .where('prescription_id', 'in', rx.map((r) => r.id)).orderBy('sort_order').execute();
    return rx.map((r) => ({ ...r, items: items.filter((i) => i.prescription_id === r.id).map(({ prescription_id: _p, ...i }) => i) }));
  }

  /**
   * Redesign R8: the drugs this clinic has prescribed (by name, case and spaces aside), the doctor's own first, then
   * the most used; each with the dose, frequency, duration and instructions last written for it (by this doctor when
   * they have prescribed it), so picking a name can fill the line.
   */
  async drugSuggestions(tx: Tx, doctorId: string | null, q: string | undefined, limit: number) {
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const { rows } = await sql<{ drug_name: string; dose: string | null; frequency: string | null; duration: string | null; instructions: string | null; uses: string; mine: string }>`
      with used as (
        select pi.drug_name, pi.dose, pi.frequency, pi.duration, pi.instructions, p.issued_at, p.doctor_id, lower(btrim(pi.drug_name)) as k
          from prescription_items pi join prescriptions p on p.id = pi.prescription_id
         where (${like}::text is null or pi.drug_name ilike ${like}::text)
      ), counted as (
        select k, count(*) as uses, count(*) filter (where doctor_id = ${doctorId}::uuid) as mine from used group by k
      )
      select distinct on (u.k) u.drug_name, u.dose, u.frequency, u.duration, u.instructions, c.uses, c.mine
        from used u join counted c on c.k = u.k
       order by u.k, coalesce(u.doctor_id = ${doctorId}::uuid, false) desc, u.issued_at desc`.execute(tx);
    return rows
      .map((r) => ({ ...r, uses: Number(r.uses), mine: Number(r.mine) }))
      .sort((a, b) => b.mine - a.mine || b.uses - a.uses || a.drug_name.localeCompare(b.drug_name))
      .slice(0, limit);
  }

  // ---------- chart ----------
  async addChartEntries(tx: Tx, tenantId: string, patientId: string, visitId: string | null, memberId: string,
    entries: { toothCode: number; surfaces: string[]; condition: string; notes?: string | null }[]): Promise<void> {
    await tx.insertInto('tooth_records').values(entries.map((e) => ({
      tenant_id: tenantId, patient_id: patientId, visit_id: visitId, tooth_code: e.toothCode, surfaces: e.surfaces,
      condition: e.condition, notes: e.notes ?? null, recorded_by: memberId,
    }))).execute();
  }

  /** Every chart entry of a patient, newest first; the current chart is the first entry per tooth. */
  chart(tx: Tx, patientId: string, visitId?: string) {
    let q = tx.selectFrom('tooth_records as t').select([
      't.id', 't.tooth_code', 't.surfaces', 't.condition', 't.notes', 't.visit_id', 't.recorded_at', memberName('t.recorded_by').as('recorded_by_name'),
    ]).where('t.patient_id', '=', patientId);
    if (visitId) q = q.where('t.visit_id', '=', visitId);
    return q.orderBy('t.recorded_at', 'desc').orderBy('t.id').limit(2000).execute();
  }
}
