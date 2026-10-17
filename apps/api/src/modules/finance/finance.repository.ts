import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { dayTotals } from './finance-rules';

const memberName = (alias: string) => sql<string | null>`(select u.full_name from tenant_members m join users u on u.id = m.user_id where m.id = ${sql.ref(alias)})`;
const dateText = (col: string) => sql<string>`to_char(${sql.ref(col)}, 'YYYY-MM-DD')`;
const num = (v: string | number | null) => (v === null ? null : Number(v));

/** Expenses, their categories and the cash day (SRS EXP-*, CASH-*). Locks, day totals and the closed-day rule live in the database. */
@Injectable()
export class FinanceRepository {
  clinic(tx: Tx, tenantId: string) {
    return tx.selectFrom('tenants as t').innerJoin('tenant_settings as s', 's.tenant_id', 't.id')
      .select(['t.currency', 't.timezone', 's.reception_expense_limit_minor']).where('t.id', '=', tenantId).executeTakeFirstOrThrow()
      .then((c) => ({ ...c, reception_expense_limit_minor: Number(c.reception_expense_limit_minor) }));
  }

  setReceptionLimit(tx: Tx, tenantId: string, minor: number) {
    return tx.updateTable('tenant_settings').set({ reception_expense_limit_minor: minor }).where('tenant_id', '=', tenantId).execute();
  }

  /** the active branches the member works at, for the cash box's branch picker */
  myBranches(tx: Tx) {
    return tx.selectFrom('branches').select(['id', 'name_ar', 'name_en', 'is_main']).where('is_active', '=', true)
      .where(sql<boolean>`((select member_branch_ids()) is null or id = any((select member_branch_ids())::uuid[]))`)
      .orderBy('is_main', 'desc').orderBy('name_ar').execute();
  }

  /** an active branch the member works at (ACCESS-003: a branch-limited member sees only theirs) */
  branch(tx: Tx, id: string) {
    return tx.selectFrom('branches').select(['id', 'name_ar', 'name_en']).where('id', '=', id).where('is_active', '=', true)
      .where(sql<boolean>`((select member_branch_ids()) is null or id = any((select member_branch_ids())::uuid[]))`).executeTakeFirst();
  }

  // ---------- categories (EXP-002) ----------
  categories(tx: Tx) {
    return tx.selectFrom('expense_categories as c')
      .select(['c.id', 'c.key', 'c.name', 'c.is_active', sql<number>`(select count(*)::int from expenses e where e.category_id = c.id)`.as('uses')])
      .orderBy('c.is_active', 'desc').orderBy('c.name').execute();
  }

  category(tx: Tx, id: string) {
    return tx.selectFrom('expense_categories').select(['id', 'name', 'is_active']).where('id', '=', id).executeTakeFirst();
  }

  addCategory(tx: Tx, tenantId: string, name: string) {
    return tx.insertInto('expense_categories').values({ tenant_id: tenantId, name }).returning('id').executeTakeFirstOrThrow();
  }

  async editCategory(tx: Tx, id: string, patch: { name?: string; isActive?: boolean }): Promise<boolean> {
    const r = await tx.updateTable('expense_categories')
      .set({ ...(patch.name !== undefined && { name: patch.name }), ...(patch.isActive !== undefined && { is_active: patch.isActive }) })
      .where('id', '=', id).executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }

  // ---------- expenses (EXP-001, EXP-003, EXP-004) ----------
  private expenses(tx: Tx) {
    return tx.selectFrom('expenses as e').innerJoin('expense_categories as c', 'c.id', 'e.category_id').innerJoin('branches as b', 'b.id', 'e.branch_id')
      .select([
        'e.id', 'e.branch_id', 'e.category_id', 'c.name as category_name', 'e.amount_minor', 'e.currency', dateText('e.spent_on').as('spent_on'),
        'e.payment_method', 'e.reference', 'e.supplier_name', 'e.description', 'e.status', 'e.created_by', 'e.created_at',
        memberName('e.created_by').as('created_by_name'), 'e.approved_at', memberName('e.approved_by').as('approved_by_name'), 'e.decision_note',
        'e.void_reason', 'e.voided_at', memberName('e.voided_by').as('voided_by_name'),
        sql<{ name_ar: string | null; name_en: string | null }>`json_build_object('name_ar', b.name_ar, 'name_en', b.name_en)`.as('branch'),
      ]);
  }

  async list(tx: Tx, q: { status?: string; branchId?: string; categoryId?: string; from?: string; to?: string; createdBy?: string; limit: number }) {
    let query = this.expenses(tx);
    if (q.status) query = query.where('e.status', '=', q.status);
    if (q.branchId) query = query.where('e.branch_id', '=', q.branchId);
    if (q.categoryId) query = query.where('e.category_id', '=', q.categoryId);
    if (q.createdBy) query = query.where('e.created_by', '=', q.createdBy);
    if (q.from) query = query.where(sql<boolean>`e.spent_on >= ${q.from}::date`);
    if (q.to) query = query.where(sql<boolean>`e.spent_on <= ${q.to}::date`);
    const rows = await query.orderBy('e.spent_on', 'desc').orderBy('e.created_at', 'desc').limit(q.limit).execute();
    return rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) }));
  }

  async get(tx: Tx, id: string) {
    const r = await this.expenses(tx).where('e.id', '=', id).executeTakeFirst();
    return r && { ...r, amount_minor: Number(r.amount_minor) };
  }

  lock(tx: Tx, id: string) {
    return tx.selectFrom('expenses').select(['id', 'status', 'created_by']).where('id', '=', id).forUpdate().executeTakeFirst();
  }

  add(tx: Tx, tenantId: string, e: {
    branchId: string; categoryId: string; amountMinor: number; currency: string; spentOn: string; method: string; reference: string | null;
    supplierName: string | null; description: string | null; status: string; createdBy: string;
  }) {
    return tx.insertInto('expenses').values({
      tenant_id: tenantId, branch_id: e.branchId, category_id: e.categoryId, amount_minor: e.amountMinor, currency: e.currency, spent_on: e.spentOn,
      payment_method: e.method, reference: e.reference, supplier_name: e.supplierName, description: e.description, status: e.status, created_by: e.createdBy,
    }).returning('id').executeTakeFirstOrThrow();
  }

  decide(tx: Tx, id: string, d: { status: 'approved' | 'rejected'; by: string; note: string | null }) {
    return tx.updateTable('expenses').set({ status: d.status, approved_by: d.by, approved_at: sql<Date>`now()`, decision_note: d.note }).where('id', '=', id).execute();
  }

  void(tx: Tx, id: string, by: string, reason: string) {
    return tx.updateTable('expenses').set({ status: 'void', voided_by: by, voided_at: sql<Date>`now()`, void_reason: reason }).where('id', '=', id).execute();
  }

  /** Approved and pending money per category over the period (EXP-002 at a glance; full reports come in E4). */
  async byCategory(tx: Tx, q: { branchId?: string; from?: string; to?: string }) {
    let query = tx.selectFrom('expenses as e').innerJoin('expense_categories as c', 'c.id', 'e.category_id')
      .select(['c.id', 'c.name', sql<string>`sum(e.amount_minor)`.as('amount')]).where('e.status', 'in', ['approved', 'pending']);
    if (q.branchId) query = query.where('e.branch_id', '=', q.branchId);
    if (q.from) query = query.where(sql<boolean>`e.spent_on >= ${q.from}::date`);
    if (q.to) query = query.where(sql<boolean>`e.spent_on <= ${q.to}::date`);
    const rows = await query.groupBy(['c.id', 'c.name']).orderBy('amount', 'desc').execute();
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  }

  // ---------- cash sessions (CASH-001…004) ----------
  private sessions(tx: Tx) {
    return tx.selectFrom('cash_sessions as s').innerJoin('branches as b', 'b.id', 's.branch_id')
      .select([
        's.id', 's.branch_id', dateText('s.business_date').as('business_date'), 's.currency', 's.status', 's.opening_minor', 's.opened_at',
        memberName('s.opened_by').as('opened_by_name'), 's.counted_minor', 's.expected_minor', 's.difference_minor', 's.closing_totals', 's.note',
        's.closed_at', memberName('s.closed_by').as('closed_by_name'),
        sql<number>`(select count(*)::int from cash_session_reopenings r where r.session_id = s.id)`.as('reopen_count'),
        sql<{ name_ar: string | null; name_en: string | null }>`json_build_object('name_ar', b.name_ar, 'name_en', b.name_en)`.as('branch'),
      ]);
  }

  private session<T extends { opening_minor: string; counted_minor: string | null; expected_minor: string | null; difference_minor: string | null; closing_totals: unknown }>(r: T) {
    return {
      ...r, opening_minor: Number(r.opening_minor), counted_minor: num(r.counted_minor), expected_minor: num(r.expected_minor), difference_minor: num(r.difference_minor),
      closing_totals: r.closing_totals ? dayTotals(r.closing_totals) : null,
    };
  }

  async sessionOn(tx: Tx, branchId: string, date: string) {
    const r = await this.sessions(tx).where('s.branch_id', '=', branchId).where(sql<boolean>`s.business_date = ${date}::date`).executeTakeFirst();
    return r && this.session(r);
  }

  async sessionById(tx: Tx, id: string) {
    const r = await this.sessions(tx).where('s.id', '=', id).executeTakeFirst();
    return r && this.session(r);
  }

  /** a session left open on an earlier day: it is closed before a new day opens */
  async earlierOpen(tx: Tx, branchId: string, date: string) {
    const r = await this.sessions(tx).where('s.branch_id', '=', branchId).where('s.status', '=', 'open').where(sql<boolean>`s.business_date < ${date}::date`).executeTakeFirst();
    return r && this.session(r);
  }

  /** CASH-001: the last counted closing cash is proposed as the opening */
  async lastCounted(tx: Tx, branchId: string, before: string) {
    const r = await tx.selectFrom('cash_sessions').select('counted_minor').where('branch_id', '=', branchId).where('status', '=', 'closed')
      .where(sql<boolean>`business_date < ${before}::date`).orderBy('business_date', 'desc').limit(1).executeTakeFirst();
    return r ? num(r.counted_minor) : null;
  }

  async history(tx: Tx, q: { branchId?: string; from?: string; to?: string; limit: number }) {
    let query = this.sessions(tx);
    if (q.branchId) query = query.where('s.branch_id', '=', q.branchId);
    if (q.from) query = query.where(sql<boolean>`s.business_date >= ${q.from}::date`);
    if (q.to) query = query.where(sql<boolean>`s.business_date <= ${q.to}::date`);
    const rows = await query.orderBy('s.business_date', 'desc').orderBy('b.name_ar').limit(q.limit).execute();
    return rows.map((r) => this.session(r));
  }

  reopenings(tx: Tx, sessionId: string) {
    return tx.selectFrom('cash_session_reopenings as r')
      .select(['r.id', 'r.reason', 'r.previous_counted', 'r.previous_expected', 'r.previous_note', 'r.previous_closed_at', memberName('r.previous_closed_by').as('previous_closed_by_name'),
        'r.reopened_at', memberName('r.reopened_by').as('reopened_by_name')])
      .where('r.session_id', '=', sessionId).orderBy('r.reopened_at').execute()
      .then((rows) => rows.map((r) => ({ ...r, previous_counted: Number(r.previous_counted), previous_expected: Number(r.previous_expected) })));
  }

  /** the row lock a close takes before adding up the day; movements in flight finish first, later ones are refused */
  lockSession(tx: Tx, id: string) {
    return tx.selectFrom('cash_sessions').select(['id', 'status', 'branch_id', 'opening_minor', dateText('business_date').as('business_date')])
      .where('id', '=', id).forUpdate().executeTakeFirst().then((r) => r && { ...r, opening_minor: Number(r.opening_minor) });
  }

  async totals(tx: Tx, branchId: string, date: string) {
    const r = await sql<{ t: unknown }>`select cash_day_totals(${branchId}, ${date}::date) as t`.execute(tx);
    return dayTotals(r.rows[0]?.t);
  }

  open(tx: Tx, tenantId: string, s: { branchId: string; date: string; currency: string; openingMinor: number; by: string }) {
    return tx.insertInto('cash_sessions').values({
      tenant_id: tenantId, branch_id: s.branchId, business_date: s.date, currency: s.currency, opening_minor: s.openingMinor, opened_by: s.by,
    }).returning('id').executeTakeFirstOrThrow();
  }

  close(tx: Tx, id: string, c: { counted: number; expected: number; totals: unknown; note: string | null; by: string }) {
    return tx.updateTable('cash_sessions').set({
      status: 'closed', counted_minor: c.counted, expected_minor: c.expected, closing_totals: JSON.stringify(c.totals), note: c.note,
      closed_by: c.by, closed_at: sql<Date>`now()`,
    }).where('id', '=', id).execute();
  }

  /** CASH-004: the reopening row (with the figures it undoes) first, then the session opens again — the database checks the order */
  async reopen(tx: Tx, tenantId: string, id: string, reason: string, by: string) {
    await sql`insert into cash_session_reopenings (tenant_id, session_id, reason, previous_counted, previous_expected, previous_note, previous_closed_by, previous_closed_at, reopened_by)
      select tenant_id, id, ${reason}, counted_minor, expected_minor, note, closed_by, closed_at, ${by} from cash_sessions where id = ${id} and tenant_id = ${tenantId}`.execute(tx);
    await tx.updateTable('cash_sessions').set({ status: 'open', counted_minor: null, expected_minor: null, closing_totals: null, note: null, closed_by: null, closed_at: null })
      .where('id', '=', id).execute();
  }
}
