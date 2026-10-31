import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder, type Tx } from '@dental/db';
import { toAsciiDigits } from '../../shared/phone';
import { escapeLike } from '../patients/patient-rules';

/** The invoice list's filters (BILLING-*, redesign R7). */
export interface InvoiceFilters { status?: string; patientId?: string; from?: string; to?: string; q?: string }

const memberName = (alias: string) => sql<string | null>`(select u.full_name from tenant_members m join users u on u.id = m.user_id where m.id = ${sql.ref(alias)})`;
const n = (v: string | number | null) => (v === null ? null : Number(v));
/** bigint columns arrive as strings; amounts go out as numbers (piastres stay far below 2^53). */
const money = <T extends Record<string, unknown>, K extends keyof T>(r: T, keys: readonly K[]) => {
  const out: Record<string, unknown> = { ...r };
  for (const k of keys) out[k as string] = Number(r[k] ?? 0);
  return out as Omit<T, K> & { [P in K]: number };
};
const INVOICE_MONEY = ['subtotal_minor', 'discount_minor', 'tax_minor', 'total_minor', 'paid_minor', 'adjusted_minor', 'balance_minor'] as const;
const dateText = (col: string) => sql<string | null>`to_char(${sql.ref(col)}, 'YYYY-MM-DD')`;

/** Invoices, their lines, payments and refunds (SRS BILLING-*, PAY-*). Totals, numbers and locks live in the database. */
@Injectable()
export class BillingRepository {
  private invoices(tx: Tx) {
    return tx.selectFrom('invoices as i').innerJoin('patients as p', 'p.id', 'i.patient_id').innerJoin('branches as b', 'b.id', 'i.branch_id')
      .select([
        'i.id', 'i.number', 'i.status', 'i.currency', 'i.patient_id', 'i.branch_id', 'i.subtotal_minor', 'i.discount_minor', 'i.tax_minor', 'i.total_minor',
        'i.paid_minor', 'i.adjusted_minor', 'i.balance_minor', 'i.discount_type', 'i.discount_bp', 'i.discount_reason', 'i.discount_status', 'i.discount_requested_by',
        'i.discount_decided_at', 'i.discount_note', memberName('i.discount_requested_by').as('discount_requested_by_name'), memberName('i.discount_decided_by').as('discount_decided_by_name'),
        dateText('i.issue_date').as('issue_date'), dateText('i.due_date').as('due_date'), 'i.notes', 'i.void_reason', 'i.voided_at',
        'i.created_at', memberName('i.created_by').as('created_by_name'), memberName('i.voided_by').as('voided_by_name'),
        sql<{ id: string; full_name: string; file_no: number; phone: string }>`json_build_object('id', p.id, 'full_name', p.full_name, 'file_no', p.file_no, 'phone', p.phone)`.as('patient'),
        sql<{ name_ar: string | null; name_en: string | null }>`json_build_object('name_ar', b.name_ar, 'name_en', b.name_en)`.as('branch'),
      ]);
  }

  /** The list's filters as one condition, shared by the list and its totals (redesign R7). */
  private filters(q: InvoiceFilters) {
    const parts: RawBuilder<boolean>[] = [];
    if (q.patientId) parts.push(sql<boolean>`i.patient_id = ${q.patientId}`);
    if (q.status === 'open') parts.push(sql<boolean>`i.status in ('issued', 'partially_paid')`);
    else if (q.status) parts.push(sql<boolean>`i.status = ${q.status}`);
    if (q.from) parts.push(sql<boolean>`coalesce(i.issue_date, i.created_at::date) >= ${q.from}::date`);
    if (q.to) parts.push(sql<boolean>`coalesce(i.issue_date, i.created_at::date) <= ${q.to}::date`);
    if (q.q) {
      // the invoice number or the patient's name (normalised Arabic, as the patient search); digits also match the file
      // number exactly and the mobile by its ending ("آخر أرقام الموبايل")
      const like = `%${escapeLike(q.q)}%`;
      const ascii = toAsciiDigits(q.q).trim();
      const any: RawBuilder<boolean>[] = [
        sql<boolean>`i.number ilike ${like}`,
        sql<boolean>`p.full_name_norm ilike '%' || ar_normalize(${escapeLike(q.q)}) || '%'`,
      ];
      if (/^\d{1,9}$/.test(ascii)) any.push(sql<boolean>`p.file_no = ${Number(ascii)}`);
      const digits = ascii.replace(/[\s+-]/g, '');
      if (/^\d{4,15}$/.test(digits)) any.push(sql<boolean>`p.phone like ${`%${digits.replace(/^0/, '')}`}`);
      parts.push(sql<boolean>`(${sql.join(any, sql` or `)})`);
    }
    return parts.length ? sql<boolean>`${sql.join(parts, sql` and `)}` : sql<boolean>`true`;
  }

  async list(tx: Tx, q: InvoiceFilters & { limit: number; after?: string }) {
    let query = this.invoices(tx).where(this.filters(q));
    // keyset paging (newest first, the id breaks ties): the page after `after`; an id this clinic cannot see (RLS)
    // matches no row, so nothing comes back
    if (q.after) query = query.where(sql<boolean>`(i.created_at, i.id) < (select a.created_at, a.id from invoices a where a.id = ${q.after})`);
    const rows = await query.orderBy('i.created_at', 'desc').orderBy('i.id', 'desc').limit(q.limit).execute();
    return rows.map((r) => money(r, INVOICE_MONEY));
  }

  /**
   * Redesign R7: what the filtered list adds up to, over every page: how many invoices, their total and what was
   * paid (issued ones only: a draft or a void invoice is not money), and what is still owed (the open ones).
   */
  async totals(tx: Tx, q: InvoiceFilters) {
    const r = await tx.selectFrom('invoices as i').innerJoin('patients as p', 'p.id', 'i.patient_id').where(this.filters(q))
      .select([
        sql<string>`count(*)`.as('count'),
        sql<string>`coalesce(sum(i.total_minor) filter (where i.status not in ('draft', 'void')), 0)`.as('total_minor'),
        sql<string>`coalesce(sum(i.paid_minor) filter (where i.status not in ('draft', 'void')), 0)`.as('paid_minor'),
        sql<string>`coalesce(sum(i.balance_minor) filter (where i.status in ('issued', 'partially_paid')), 0)`.as('balance_minor'),
      ]).executeTakeFirstOrThrow();
    return { count: Number(r.count), total_minor: Number(r.total_minor), paid_minor: Number(r.paid_minor), balance_minor: Number(r.balance_minor) };
  }

  async get(tx: Tx, id: string) {
    const r = await this.invoices(tx).where('i.id', '=', id).executeTakeFirst();
    return r && money(r, INVOICE_MONEY);
  }

  lock(tx: Tx, id: string) {
    return tx.selectFrom('invoices').select(['id', 'status', 'patient_id', 'branch_id', 'currency']).where('id', '=', id).forUpdate().executeTakeFirst();
  }

  async create(tx: Tx, tenantId: string, i: { patientId: string; branchId: string; currency: string; notes: string | null; dueDate: string | null; createdBy: string }): Promise<string> {
    const r = await tx.insertInto('invoices').values({
      tenant_id: tenantId, patient_id: i.patientId, branch_id: i.branchId, currency: i.currency, notes: i.notes, due_date: i.dueDate, created_by: i.createdBy,
    }).returning('id').executeTakeFirstOrThrow();
    return r.id;
  }

  async update(tx: Tx, id: string, f: { notes?: string | null; due_date?: string | null; status?: string; void_reason?: string; voided_at?: Date; voided_by?: string }): Promise<void> {
    if (Object.keys(f).length) await tx.updateTable('invoices').set(f).where('id', '=', id).execute();
  }

  async remove(tx: Tx, id: string): Promise<void> {
    await tx.deleteFrom('invoices').where('id', '=', id).where('status', '=', 'draft').execute();
  }

  async issue(tx: Tx, id: string): Promise<string> {
    const r = await sql<{ n: string }>`select issue_invoice(${id}) as n`.execute(tx);
    return r.rows[0]!.n;
  }

  lines(tx: Tx, invoiceId: string) {
    return tx.selectFrom('invoice_items').select([
      'id', 'service_id', 'visit_procedure_id', 'doctor_id', 'description', 'tooth_code', 'quantity', 'unit_price_minor', 'discount_minor', 'line_total_minor', 'sort_order',
      'discount_type', 'discount_bp', 'discount_reason',
    ]).where('invoice_id', '=', invoiceId).orderBy('sort_order').orderBy('id').execute()
      .then((rows) => rows.map((r) => money(r, ['unit_price_minor', 'discount_minor', 'line_total_minor'])));
  }

  async addLine(tx: Tx, tenantId: string, invoiceId: string, l: {
    serviceId: string | null; procedureId: string | null; doctorId: string | null; description: string; toothCode: number | null; quantity: number; unitPriceMinor: number;
  }): Promise<void> {
    const next = await tx.selectFrom('invoice_items').select((e) => sql<number>`coalesce(max(${e.ref('sort_order')}), -1) + 1`.as('n'))
      .where('invoice_id', '=', invoiceId).executeTakeFirstOrThrow();
    await tx.insertInto('invoice_items').values({
      tenant_id: tenantId, invoice_id: invoiceId, service_id: l.serviceId, visit_procedure_id: l.procedureId, doctor_id: l.doctorId, description: l.description,
      tooth_code: l.toothCode, quantity: l.quantity, unit_price_minor: l.unitPriceMinor, line_total_minor: l.quantity * l.unitPriceMinor, sort_order: Number(next.n),
    }).execute();
  }

  async removeLine(tx: Tx, invoiceId: string, lineId: string): Promise<boolean> {
    const r = await tx.deleteFrom('invoice_items').where('id', '=', lineId).where('invoice_id', '=', invoiceId).executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  /** Procedures of this patient not on any non-void invoice: what is left to bill (BILLING-001). */
  unbilledProcedures(tx: Tx, patientId: string, ids?: string[]) {
    let q = tx.selectFrom('visit_procedures as vp').innerJoin('visits as v', 'v.id', 'vp.visit_id').innerJoin('services as s', 's.id', 'vp.service_id')
      .innerJoin('doctors as d', 'd.id', 'vp.doctor_id')
      .select([
        'vp.id', 'vp.visit_id', 'vp.service_id', 's.name_ar as service_ar', 's.name_en as service_en', 'vp.tooth_code', 'vp.surfaces', 'vp.price_minor', 'vp.doctor_id',
        'v.branch_id', 'v.visit_at', 'd.name_ar as doctor_ar', 'd.name_en as doctor_en',
      ])
      .where('v.patient_id', '=', patientId)
      .where(sql<boolean>`not exists (select 1 from invoice_items ii join invoices i on i.id = ii.invoice_id where ii.visit_procedure_id = vp.id and i.status <> 'void')`);
    if (ids) q = q.where('vp.id', 'in', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    return q.orderBy('v.visit_at').orderBy('vp.created_at').execute().then((rows) => rows.map((r) => ({ ...r, price_minor: Number(r.price_minor) })));
  }

  /**
   * The clinic's unbilled work (redesign R5): procedures on no non-void invoice, one row per patient and branch (an
   * invoice is for one patient at one branch), the longest-waiting first. RLS limits a branch-limited member.
   */
  async unbilledByPatient(tx: Tx, limit: number) {
    const rows = await tx.selectFrom('visit_procedures as vp').innerJoin('visits as v', 'v.id', 'vp.visit_id')
      .innerJoin('patients as p', 'p.id', 'v.patient_id').innerJoin('branches as b', 'b.id', 'v.branch_id')
      .select((eb) => [
        'p.id as patient_id', 'p.full_name', 'p.file_no', 'p.phone', 'v.branch_id', 'b.name_ar as branch_ar', 'b.name_en as branch_en',
        eb.fn.countAll<string>().as('procedures'),
        eb.fn.sum<string>('vp.price_minor').as('total_minor'),
        eb.fn.min('v.visit_at').as('oldest_at'),
        eb.fn.max('v.visit_at').as('latest_at'),
        sql<number>`count(distinct v.id)`.as('visits'),
      ])
      .where(sql<boolean>`not exists (select 1 from invoice_items ii join invoices i on i.id = ii.invoice_id where ii.visit_procedure_id = vp.id and i.status <> 'void')`)
      .groupBy(['p.id', 'p.full_name', 'p.file_no', 'p.phone', 'v.branch_id', 'b.name_ar', 'b.name_en'])
      .orderBy(sql`min(v.visit_at)`).limit(limit).execute();
    return rows.map((r) => ({ ...r, procedures: Number(r.procedures), visits: Number(r.visits), total_minor: Number(r.total_minor ?? 0) }));
  }

  /** A service for a new invoice line (a deleted one is gone from the price list). */
  service(tx: Tx, id: string) {
    return tx.selectFrom('services').select(['id', 'name_ar', 'name_en', 'price_minor', 'price_max_minor']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst()
      .then((s) => s && { ...s, price_minor: Number(s.price_minor), price_max_minor: n(s.price_max_minor) });
  }

  clinic(tx: Tx, tenantId: string) {
    return tx.selectFrom('tenants as t').innerJoin('tenant_settings as s', 's.tenant_id', 't.id').select(['t.currency', 't.timezone', 's.tax_rate_bp', 's.invoice_prefix'])
      .where('t.id', '=', tenantId).executeTakeFirstOrThrow();
  }

  branchExists(tx: Tx, id: string) {
    return tx.selectFrom('branches').select('id').where('id', '=', id).where('is_active', '=', true).executeTakeFirst();
  }

  /** Doctors with invoices:read:own see the billing of patients they have treated or booked (SRS BILLING-005). */
  doctorTreats(tx: Tx, doctorId: string, patientId: string) {
    return sql<{ ok: boolean }>`select exists (select 1 from visits where doctor_id = ${doctorId} and patient_id = ${patientId})
      or exists (select 1 from appointments where doctor_id = ${doctorId} and patient_id = ${patientId}) as ok`.execute(tx).then((r) => !!r.rows[0]?.ok);
  }

  doctorOfMember(tx: Tx, memberId: string) {
    return tx.selectFrom('doctors').select('id').where('member_id', '=', memberId).executeTakeFirst().then((d) => d?.id ?? null);
  }

  /** The patient's outstanding balance: issued and partly paid invoices, never typed (BILLING-005). */
  balance(tx: Tx, patientId: string) {
    return tx.selectFrom('invoices').select((e) => sql<string>`coalesce(sum(${e.ref('balance_minor')}), 0)`.as('b'))
      .where('patient_id', '=', patientId).where('status', 'in', ['issued', 'partially_paid']).executeTakeFirstOrThrow().then((r) => Number(r.b));
  }

  /**
   * BILLING-005 at check-in: what each of these patients owes (issued and partly paid invoices), for the day list.
   * With `doctorId`, only patients that doctor has treated or booked (invoices:read:own).
   */
  async balances(tx: Tx, patientIds: string[], doctorId: string | null): Promise<Record<string, number>> {
    const r = await sql<{ patient_id: string; balance: string }>`
      select i.patient_id, sum(i.balance_minor) as balance from invoices i
      where i.patient_id = any(${patientIds}::uuid[]) and i.status in ('issued', 'partially_paid') and i.balance_minor > 0
        and (${doctorId}::uuid is null or i.patient_id in (select patient_id from visits where doctor_id = ${doctorId}::uuid
                                                   union select patient_id from appointments where doctor_id = ${doctorId}::uuid))
      group by i.patient_id`.execute(tx);
    return Object.fromEntries(r.rows.map((x) => [x.patient_id, Number(x.balance)]));
  }

  // ---------- payments ----------
  private payments(tx: Tx) {
    return tx.selectFrom('payments as pm').select([
      'pm.id', 'pm.invoice_id', 'pm.patient_id', 'pm.branch_id', 'pm.amount_minor', 'pm.refunded_minor', 'pm.currency', 'pm.method', 'pm.reference', 'pm.status',
      'pm.paid_at', 'pm.notes', 'pm.received_by', 'pm.reversed_at', 'pm.reversal_reason', memberName('pm.received_by').as('received_by_name'),
      memberName('pm.reversed_by').as('reversed_by_name'),
    ]);
  }

  async paymentsOf(tx: Tx, invoiceId: string) {
    const rows = await this.payments(tx).where('pm.invoice_id', '=', invoiceId).orderBy('pm.paid_at').execute();
    if (!rows.length) return [];
    const refunds = await tx.selectFrom('refunds as r').select([
      'r.id', 'r.payment_id', 'r.amount_minor', 'r.method', 'r.reason', 'r.reference', 'r.refunded_at', memberName('r.created_by').as('created_by_name'),
    ]).where('r.payment_id', 'in', rows.map((r) => r.id)).orderBy('r.refunded_at').execute();
    return rows.map((p) => ({
      ...money(p, ['amount_minor', 'refunded_minor']),
      refunds: refunds.filter((r) => r.payment_id === p.id).map(({ payment_id: _p, ...r }) => ({ ...r, amount_minor: Number(r.amount_minor) })),
    }));
  }

  async payment(tx: Tx, id: string) {
    const r = await this.payments(tx).where('pm.id', '=', id).executeTakeFirst();
    return r && money(r, ['amount_minor', 'refunded_minor']);
  }

  lockPayment(tx: Tx, id: string) {
    return tx.selectFrom('payments').select(['id', 'status', 'invoice_id', 'received_by', 'refunded_minor', 'paid_at']).where('id', '=', id).forUpdate().executeTakeFirst();
  }

  byIdempotencyKey(tx: Tx, key: string) {
    return tx.selectFrom('payments').select(['id', 'invoice_id']).where('idempotency_key', '=', key).executeTakeFirst();
  }

  async addPayment(tx: Tx, tenantId: string, p: {
    installmentId: string | null; invoiceId: string; patientId: string; branchId: string; amountMinor: number; currency: string; method: string; reference: string | null;
    notes: string | null; idempotencyKey: string; receivedBy: string;
  }): Promise<string> {
    const r = await tx.insertInto('payments').values({
      tenant_id: tenantId, invoice_id: p.invoiceId, installment_id: p.installmentId, patient_id: p.patientId, branch_id: p.branchId, amount_minor: p.amountMinor, currency: p.currency,
      method: p.method, reference: p.reference, notes: p.notes, idempotency_key: p.idempotencyKey, received_by: p.receivedBy, paid_at: sql<Date>`now()`, status: 'succeeded',
    }).returning('id').executeTakeFirstOrThrow();
    return r.id;
  }

  /** review R11: an event for the worker, in the caller's transaction (transactional outbox, SRS 8.3) */
  async addOutboxEvent(tx: Tx, tenantId: string, type: string, payload: Record<string, unknown>): Promise<void> {
    await tx.insertInto('outbox_events').values({ tenant_id: tenantId, type, payload: JSON.stringify(payload) }).execute();
  }

  async reverse(tx: Tx, id: string, by: string, reason: string): Promise<void> {
    await tx.updateTable('payments').set({ status: 'reversed', reversed_at: sql<Date>`now()`, reversed_by: by, reversal_reason: reason }).where('id', '=', id).execute();
  }

  refundByIdempotencyKey(tx: Tx, key: string) {
    return tx.selectFrom('refunds').select(['id', 'payment_id']).where('idempotency_key', '=', key).executeTakeFirst();
  }

  async addRefund(tx: Tx, tenantId: string, r: { paymentId: string; amountMinor: number; method: string; reason: string; reference: string | null; createdBy: string; idempotencyKey: string | null }): Promise<void> {
    await tx.insertInto('refunds').values({
      tenant_id: tenantId, payment_id: r.paymentId, amount_minor: r.amountMinor, method: r.method, reason: r.reason, reference: r.reference, created_by: r.createdBy,
      idempotency_key: r.idempotencyKey,
      branch_id: sql<string>`(select branch_id from payments where id = ${r.paymentId})`,
    }).execute();
  }

  // ---------- discounts (DISC-*) ----------
  async setInvoiceDiscount(tx: Tx, id: string, d: { type: 'amount' | 'percent'; value: number; reason: string } | null): Promise<void> {
    await tx.updateTable('invoices').set(d
      ? { discount_type: d.type, discount_bp: d.type === 'percent' ? d.value : null, discount_minor: d.type === 'amount' ? d.value : 0, discount_reason: d.reason }
      : { discount_type: null, discount_bp: null, discount_minor: 0, discount_reason: null }).where('id', '=', id).execute();
  }

  async setLineDiscount(tx: Tx, invoiceId: string, lineId: string, d: { type: 'amount' | 'percent'; value: number; reason: string } | null): Promise<boolean> {
    const r = await tx.updateTable('invoice_items').set(d
      ? { discount_type: d.type, discount_bp: d.type === 'percent' ? d.value : null, discount_minor: d.type === 'amount' ? d.value : 0, discount_reason: d.reason }
      : { discount_type: null, discount_bp: null, discount_minor: 0, discount_reason: null })
      .where('id', '=', lineId).where('invoice_id', '=', invoiceId).executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }

  /** Every discount on a draft and what it is a share of: the gross is quantity × unit price before any discount. */
  async discountTotals(tx: Tx, invoiceId: string): Promise<{ gross: number; total: number }> {
    const r = await sql<{ gross: string; lines: string; invoice: string }>`
      select coalesce((select sum(quantity * unit_price_minor) from invoice_items where invoice_id = ${invoiceId}), 0) as gross,
             coalesce((select sum(discount_minor) from invoice_items where invoice_id = ${invoiceId}), 0) as lines,
             (select discount_minor from invoices where id = ${invoiceId}) as invoice`.execute(tx);
    const x = r.rows[0]!;
    return { gross: Number(x.gross), total: Number(x.lines) + Number(x.invoice) };
  }

  async roleLimit(tx: Tx, memberId: string): Promise<{ bp: number; minor: number | null }> {
    const r = await tx.selectFrom('tenant_members as m').innerJoin('roles as r', 'r.id', 'm.role_id').select(['r.max_discount_bp', 'r.max_discount_minor'])
      .where('m.id', '=', memberId).executeTakeFirst();
    return { bp: r?.max_discount_bp ?? 0, minor: r?.max_discount_minor == null ? null : Number(r.max_discount_minor) };
  }

  async setDiscountStatus(tx: Tx, id: string, f: { status: string; requestedBy?: string | null; decidedBy?: string | null; note?: string | null }): Promise<void> {
    await tx.updateTable('invoices').set({
      discount_status: f.status,
      ...(f.requestedBy !== undefined && { discount_requested_by: f.requestedBy }),
      discount_decided_by: f.decidedBy ?? null, discount_decided_at: f.decidedBy ? sql<Date>`now()` : null, discount_note: f.note ?? null,
    }).where('id', '=', id).execute();
  }

  async pendingDiscounts(tx: Tx) {
    const rows = await this.invoices(tx).where('i.discount_status', '=', 'pending').orderBy('i.created_at').limit(200).execute();
    return rows.map((r) => money(r, INVOICE_MONEY));
  }

  async roleLimits(tx: Tx) {
    const rows = await tx.selectFrom('roles').select(['id', 'key', 'name_ar', 'name_en', 'is_system', 'permissions', 'max_discount_bp', 'max_discount_minor']).where('archived_at', 'is', null)
      .orderBy('is_system', 'desc').orderBy('key').execute();
    return rows.map((r) => ({ ...r, max_discount_minor: r.max_discount_minor == null ? null : Number(r.max_discount_minor), unlimited: r.permissions.includes('*') }));
  }

  async setRoleLimit(tx: Tx, roleId: string, bp: number, minor: number | null): Promise<boolean> {
    const r = await tx.updateTable('roles').set({ max_discount_bp: bp, max_discount_minor: minor }).where('id', '=', roleId).executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }

  // ---------- installment plans (PAY-004) ----------
  async plan(tx: Tx, invoiceId: string) {
    const p = await tx.selectFrom('payment_plans').select(['id', 'status', 'total_minor', 'down_payment_minor', 'installments_count', dateText('start_date').as('start_date'), 'notes', 'created_at'])
      .where('invoice_id', '=', invoiceId).orderBy('created_at', 'desc').executeTakeFirst();
    if (!p) return null;
    const items = await tx.selectFrom('installments').select([
      'id', 'seq', dateText('due_date').as('due_date'), 'amount_minor', 'paid_minor', 'status', 'paid_at', 'waived_at', 'waived_reason', memberName('waived_by').as('waived_by_name'),
    ]).where('plan_id', '=', p.id).orderBy('seq').execute();
    return { ...money(p, ['total_minor', 'down_payment_minor']), installments: items.map((i) => money(i, ['amount_minor', 'paid_minor'])) };
  }

  async createPlan(tx: Tx, tenantId: string, p: { patientId: string; invoiceId: string; currency: string; total: number; down: number; notes: string | null; createdBy: string;
    installments: { dueDate: string; amountMinor: number }[] }): Promise<void> {
    const { id } = await tx.insertInto('payment_plans').values({
      tenant_id: tenantId, patient_id: p.patientId, invoice_id: p.invoiceId, currency: p.currency, total_minor: p.total, down_payment_minor: p.down,
      installments_count: p.installments.length, start_date: p.installments[0]!.dueDate, notes: p.notes, created_by: p.createdBy,
    }).returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('installments').values(p.installments.map((i, k) => ({
      tenant_id: tenantId, plan_id: id, seq: k + 1, due_date: i.dueDate, amount_minor: i.amountMinor,
    }))).execute();
    await sql`set constraints payment_plans_totals, installments_totals immediate`.execute(tx); // a schedule that does not add up fails here, clearly
  }

  async installment(tx: Tx, id: string) {
    const r = await tx.selectFrom('installments as s').innerJoin('payment_plans as p', 'p.id', 's.plan_id')
      .select(['s.id', 's.plan_id', 's.status', 's.amount_minor', 's.paid_minor', 'p.invoice_id', 'p.status as plan_status']).where('s.id', '=', id).forUpdate('s').executeTakeFirst();
    return r && money(r, ['amount_minor', 'paid_minor']);
  }

  async moveInstallment(tx: Tx, id: string, dueDate: string): Promise<void> {
    await tx.updateTable('installments').set({ due_date: dueDate }).where('id', '=', id).execute();
  }

  async overdue(tx: Tx, today: string) {
    const rows = await tx.selectFrom('installments as s').innerJoin('payment_plans as pp', 'pp.id', 's.plan_id').innerJoin('invoices as i', 'i.id', 'pp.invoice_id')
      .innerJoin('patients as p', 'p.id', 'i.patient_id')
      .select([
        's.id', 's.seq', dateText('s.due_date').as('due_date'), 's.amount_minor', 's.paid_minor', 's.status', 'i.id as invoice_id', 'i.number', 'i.currency',
        sql<{ id: string; full_name: string; file_no: number; phone: string }>`json_build_object('id', p.id, 'full_name', p.full_name, 'file_no', p.file_no, 'phone', p.phone)`.as('patient'),
      ])
      .where('s.status', 'in', ['due', 'partially_paid']).where(sql<boolean>`s.due_date < ${today}::date`).where('pp.status', '=', 'active')
      .orderBy('s.due_date').limit(300).execute();
    return rows.map((r) => money(r, ['amount_minor', 'paid_minor']));
  }

  // ---------- waivers and write-offs (PAY-006) ----------
  async addAdjustment(tx: Tx, tenantId: string, a: { invoiceId: string; installmentId: string | null; kind: 'waiver' | 'write_off'; amountMinor: number; reason: string; createdBy: string }): Promise<void> {
    await tx.insertInto('balance_adjustments').values({
      tenant_id: tenantId, invoice_id: a.invoiceId, installment_id: a.installmentId, kind: a.kind, amount_minor: a.amountMinor, reason: a.reason, created_by: a.createdBy,
    }).execute();
  }

  async adjustments(tx: Tx, invoiceId: string) {
    const rows = await tx.selectFrom('balance_adjustments').select(['id', 'kind', 'installment_id', 'amount_minor', 'reason', 'created_at', memberName('created_by').as('created_by_name')])
      .where('invoice_id', '=', invoiceId).orderBy('created_at').execute();
    return rows.map((r) => money(r, ['amount_minor']));
  }
}
