import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import type { AttendanceRow, ExpenseRow, MoneyRow, OutstandingRow, OverdueRow, Period, ProcedureRow } from './reports-rules';

const visible = sql<boolean>`((select member_branch_ids()) is null or b.id = any((select member_branch_ids())::uuid[]))`;

/**
 * Reads for the reports (SRS REPORT-001…005). The sums are database functions (migration 0026) running under the
 * caller's row-level security, so a branch-limited member's rows never include another branch. Bigint sums arrive as
 * text and dates as 'YYYY-MM-DD'.
 */
@Injectable()
export class ReportsRepository {
  clinic(tx: Tx, tenantId: string) {
    return tx.selectFrom('tenants').select(['currency', 'timezone']).where('id', '=', tenantId).executeTakeFirstOrThrow();
  }

  /** the branches the member works at, inactive ones included (their history still counts) */
  branches(tx: Tx) {
    return tx.selectFrom('branches as b').select(['b.id', 'b.name_ar', 'b.name_en', 'b.is_active', 'b.is_main']).where(visible)
      .orderBy('b.is_main', 'desc').orderBy('b.name_ar').execute();
  }

  doctors(tx: Tx) {
    return tx.selectFrom('doctors').select(['id', 'name_ar', 'name_en', 'is_active']).orderBy('sort_order').orderBy('name_ar').execute();
  }

  categories(tx: Tx) {
    return tx.selectFrom('expense_categories').select(['id', 'name']).execute();
  }

  /** the doctor record a member signs in as (doctors.member_id), if any */
  async doctorOf(tx: Tx, memberId: string): Promise<string | null> {
    return (await tx.selectFrom('doctors').select('id').where('member_id', '=', memberId).executeTakeFirst())?.id ?? null;
  }

  async money(tx: Tx, p: Period, branchId: string | null): Promise<MoneyRow[]> {
    const r = await sql<{ branch_id: string; day: string; kind: MoneyRow['kind']; method: string | null; amount: string; n: string }>`
      select branch_id, to_char(day, 'YYYY-MM-DD') as day, kind, method, amount, n from report_money(${p.from}::date, ${p.to}::date, ${branchId}::uuid)`.execute(tx);
    return r.rows.map((x) => ({ ...x, amount: Number(x.amount), n: Number(x.n) }));
  }

  async expenses(tx: Tx, p: Period, branchId: string | null): Promise<ExpenseRow[]> {
    const r = await sql<{ branch_id: string; day: string; category_id: string; method: string | null; status: ExpenseRow['status']; amount: string; n: string }>`
      select branch_id, to_char(day, 'YYYY-MM-DD') as day, category_id, method, status, amount, n from report_expenses(${p.from}::date, ${p.to}::date, ${branchId}::uuid)`.execute(tx);
    return r.rows.map((x) => ({ ...x, amount: Number(x.amount), n: Number(x.n) }));
  }

  async attendance(tx: Tx, p: Period, branchId: string | null, doctorId: string | null): Promise<AttendanceRow[]> {
    const r = await sql<{ branch_id: string; doctor_id: string; status: string; n: string }>`
      select branch_id, doctor_id, status, n from report_attendance(${p.from}::date, ${p.to}::date, ${branchId}::uuid, ${doctorId}::uuid)`.execute(tx);
    return r.rows.map((x) => ({ ...x, n: Number(x.n) }));
  }

  async procedures(tx: Tx, p: Period, branchId: string | null, doctorId: string | null): Promise<ProcedureRow[]> {
    const r = await sql<{ branch_id: string; doctor_id: string; amount: string; n: string }>`
      select branch_id, doctor_id, amount, n from report_procedures(${p.from}::date, ${p.to}::date, ${branchId}::uuid, ${doctorId}::uuid)`.execute(tx);
    return r.rows.map((x) => ({ ...x, amount: Number(x.amount), n: Number(x.n) }));
  }

  async outstanding(tx: Tx, branchId: string | null): Promise<OutstandingRow[]> {
    const r = await sql<Omit<OutstandingRow, 'balance' | 'invoices'> & { balance: string; invoices: string }>`
      select o.patient_id, o.branch_id, o.balance, o.invoices, to_char(o.oldest, 'YYYY-MM-DD') as oldest, p.full_name, p.file_no, p.phone
      from report_outstanding(${branchId}::uuid) o join patients p on p.id = o.patient_id`.execute(tx);
    return r.rows.map((x) => ({ ...x, balance: Number(x.balance), invoices: Number(x.invoices) }));
  }

  /** REPORT-006: follow-ups open and due by today (VISIT-005's due list), all or one doctor's */
  async followUpsDue(tx: Tx, today: string, doctorId: string | null): Promise<number> {
    let q = tx.selectFrom('recalls as r').innerJoin('patients as p', 'p.id', 'r.patient_id').select(sql<string>`count(*)`.as('n'))
      .where('p.merged_into_id', 'is', null).where('r.status', 'in', ['pending', 'contacted']).where(sql<boolean>`r.due_date <= ${today}::date`);
    if (doctorId) q = q.where('r.doctor_id', '=', doctorId);
    return Number((await q.executeTakeFirstOrThrow()).n);
  }

  /** REPORT-006: today's cash day of each active branch the member works at (none, open or closed) */
  cashToday(tx: Tx, today: string) {
    return tx.selectFrom('branches as b')
      .leftJoin('cash_sessions as s', (j) => j.onRef('s.branch_id', '=', 'b.id').on(sql<boolean>`s.business_date = ${today}::date`))
      .select(['b.id as branch_id', 'b.name_ar', 'b.name_en', sql<'none' | 'open' | 'closed'>`coalesce(s.status, 'none')`.as('status')])
      .where('b.is_active', '=', true).where(visible).orderBy('b.is_main', 'desc').orderBy('b.name_ar').execute();
  }

  async overdue(tx: Tx, branchId: string | null): Promise<OverdueRow[]> {
    const r = await sql<Omit<OverdueRow, 'remaining'> & { remaining: string }>`
      select o.installment_id, o.invoice_id, i.number, o.branch_id, o.patient_id, p.full_name, o.seq, to_char(o.due_date, 'YYYY-MM-DD') as due_date, o.remaining, o.days_overdue
      from report_overdue_installments(${branchId}::uuid) o join invoices i on i.id = o.invoice_id join patients p on p.id = o.patient_id`.execute(tx);
    return r.rows.map((x) => ({ ...x, remaining: Number(x.remaining) }));
  }
}
