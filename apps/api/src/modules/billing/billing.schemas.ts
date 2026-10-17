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

export const NewPayment = z.object({
  amountMinor: Money, method: z.enum(PAYMENT_METHODS), reference: Text(100).nullable().optional(), notes: Text(500).nullable().optional(),
  /** the same key twice records one payment (a double click, a retried request) */
  idempotencyKey: z.string().trim().min(8).max(100),
}).strict();
export const Reverse = z.object({ reason: Reason }).strict();
export const NewRefund = z.object({
  amountMinor: Money, method: z.enum(PAYMENT_METHODS), reason: Reason, reference: Text(100).nullable().optional(),
}).strict();

export const InvoicesQuery = z.object({
  status: z.enum(['draft', 'issued', 'partially_paid', 'paid', 'void', 'open']).optional(),
  from: z.string().regex(ISO_DATE).optional(), to: z.string().regex(ISO_DATE).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

export type NewInvoiceInput = z.infer<typeof NewInvoice>;
export type ServiceLineInput = z.infer<typeof ServiceLine>;
export type NewLineInput = z.infer<typeof NewLine>;
export type NewPaymentInput = z.infer<typeof NewPayment>;
export type NewRefundInput = z.infer<typeof NewRefund>;
export type InvoicesQueryInput = z.infer<typeof InvoicesQuery>;
