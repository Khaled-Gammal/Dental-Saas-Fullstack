import { z } from 'zod';
import { ISO_DATE } from '../../shared/time/clinic-time';
import { EXPENSE_METHODS } from './finance-rules';

const Uuid = z.string().uuid();
const Money = z.number().int().min(1).max(100_000_000);
const Cash = z.number().int().min(0).max(100_000_000);
const Text = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const Reason = z.string().trim().min(3).max(500);

/** EXP-001: the member recording it is the responsible staff member; the date defaults to the clinic's today. */
export const NewExpense = z.object({
  branchId: Uuid, categoryId: Uuid, amountMinor: Money, method: z.enum(EXPENSE_METHODS),
  spentOn: z.string().regex(ISO_DATE).optional(),
  reference: Text(100).nullable().optional(), supplierName: Text(120).nullable().optional(), description: Text(500).nullable().optional(),
}).strict();
export const ExpensesQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'void']).optional(),
  branchId: Uuid.optional(), categoryId: Uuid.optional(),
  from: z.string().regex(ISO_DATE).optional(), to: z.string().regex(ISO_DATE).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  /** "load more": the expenses listed after this one (the last of the previous page) */
  after: Uuid.optional(),
}).strict();
export const ExpenseDecision = z.object({ note: Text(500).nullable().optional() }).strict();
export const ExpenseRejection = z.object({ note: z.string().trim().min(3).max(500) }).strict();
export const VoidExpense = z.object({ reason: Reason }).strict();

export const NewCategory = z.object({ name: z.string().trim().min(2).max(80) }).strict();
export const EditCategory = z.object({ name: z.string().trim().min(2).max(80), isActive: z.boolean() }).partial().strict();

/** CASH-001…004 */
export const CashQuery = z.object({ branchId: Uuid }).strict();
export const OpenCash = z.object({ branchId: Uuid, openingMinor: Cash }).strict();
export const CloseCash = z.object({ countedMinor: Cash, note: Text(500).nullable().optional() }).strict();
export const ReopenCash = z.object({ reason: Reason }).strict();
export const CashHistoryQuery = z.object({
  branchId: Uuid.optional(), from: z.string().regex(ISO_DATE).optional(), to: z.string().regex(ISO_DATE).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
}).strict();

export type NewExpenseInput = z.infer<typeof NewExpense>;
export type ExpensesQueryInput = z.infer<typeof ExpensesQuery>;
export type CashHistoryQueryInput = z.infer<typeof CashHistoryQuery>;
