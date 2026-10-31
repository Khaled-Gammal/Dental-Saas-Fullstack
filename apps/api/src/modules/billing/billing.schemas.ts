import { z } from 'zod';
import { ISO_DATE } from '../../shared/time/clinic-time';
import { PAYMENT_METHODS } from './billing-rules';

const Uuid = z.string().uuid();
const Money = z.number().int().min(1).max(100_000_000);
const Text = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const Reason = z.string().trim().min(3).max(500);

const ServiceLine = z.object({
  serviceId: Uuid.optional(), description: z.string().trim().min(1).max(300).optional(), quantity: z.number().int().min(1).max(100).default(1),
  unitPriceMinor: z.number().int().min(0).max(100_000_000).optional(),
}).strict().refine((l) => l.serviceId || (l.description && l.unitPriceMinor !== undefined), 'a service, or a description with a price');

/** BILLING-001: a draft for one patient and one branch, from unbilled procedures and/or service lines. */
export const NewInvoice = z.object({
  patientId: Uuid, branchId: Uuid,
  procedureIds: z.array(Uuid).max(50).default([]),
  lines: z.array(ServiceLine).max(50).default([]),
  notes: Text(1000).nullable().optional(),
  dueDate: z.string().regex(ISO_DATE).nullable().optional(),
}).strict();
export const EditInvoice = z.object({ notes: Text(1000).nullable(), dueDate: z.string().regex(ISO_DATE).nullable() }).partial().strict();
export const NewLine = z.union([z.object({ procedureId: Uuid }).strict(), ServiceLine]);
export const VoidInvoice = z.object({ reason: Reason }).strict();
/** BILLING-005 at check-in: up to 200 patient ids, comma-separated (the day list's patients). */
export const BalancesQuery = z.object({
  patientIds: z.string().transform((v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))]).pipe(z.array(Uuid).min(1).max(200)),
}).strict();

export const NewPayment = z.object({
  amountMinor: Money, method: z.enum(PAYMENT_METHODS), reference: Text(100).nullable().optional(), notes: Text(500).nullable().optional(),
  /** the same key twice records one payment (a double click, a retried request) */
  idempotencyKey: z.string().trim().min(8).max(100),
  /** PAY-004: paying an installment of the invoice's plan */
  installmentId: Uuid.optional(),
}).strict();
export const Reverse = z.object({ reason: Reason }).strict();
export const NewRefund = z.object({
  amountMinor: Money, method: z.enum(PAYMENT_METHODS), reason: Reason, reference: Text(100).nullable().optional(),
}).strict();

export const InvoicesQuery = z.object({
  status: z.enum(['draft', 'issued', 'partially_paid', 'paid', 'void', 'open']).optional(),
  from: z.string().regex(ISO_DATE).optional(), to: z.string().regex(ISO_DATE).optional(),
  /** redesign R7: search every invoice (not only the loaded page) by number, patient name, file number or mobile */
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /** "load more": the invoices listed after this one (the last of the previous page) */
  after: Uuid.optional(),
}).strict();

/** Redesign R7: the totals of what the list shows (the same filters, every page). */
export const InvoiceTotalsQuery = InvoicesQuery.omit({ limit: true, after: true });
export type InvoiceTotalsQueryInput = z.infer<typeof InvoiceTotalsQuery>;

/** The unbilled-work list (redesign R5). */
export const UnbilledQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }).strict();

export type NewInvoiceInput = z.infer<typeof NewInvoice>;
export type ServiceLineInput = z.infer<typeof ServiceLine>;
export type NewLineInput = z.infer<typeof NewLine>;
export type NewPaymentInput = z.infer<typeof NewPayment>;
export type NewRefundInput = z.infer<typeof NewRefund>;
export type InvoicesQueryInput = z.infer<typeof InvoicesQuery>;

/** DISC-001: a fixed amount (minor units) or a percentage (basis points, 0–10000), always with a reason. */
export const Discount = z.object({
  type: z.enum(['amount', 'percent']), value: z.number().int().min(1).max(100_000_000), reason: z.string().trim().min(3).max(300),
}).strict().refine((d) => d.type !== 'percent' || d.value <= 10000, 'a percentage is at most 100 %');
export const Decision = z.object({ note: Text(500).nullable().optional() }).strict();
export const Rejection = z.object({ note: z.string().trim().min(3).max(500) }).strict();
export const RoleLimit = z.object({ maxDiscountBp: z.number().int().min(0).max(10000), maxDiscountMinor: z.number().int().min(0).max(100_000_000).nullable() }).strict();
export const NewPlan = z.object({
  installments: z.array(z.object({ dueDate: z.string().regex(ISO_DATE), amountMinor: z.number().int().min(1).max(100_000_000) }).strict()).min(1).max(60),
  notes: Text(500).nullable().optional(),
}).strict();
export const MoveInstallment = z.object({ dueDate: z.string().regex(ISO_DATE) }).strict();
export const WriteOff = z.object({ amountMinor: Money, reason: Reason }).strict();
export const Waive = z.object({ reason: Reason }).strict();
export type DiscountInput = z.infer<typeof Discount>;
export type NewPlanInput = z.infer<typeof NewPlan>;
