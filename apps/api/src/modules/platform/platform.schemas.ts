import { z } from 'zod';

const Email = z.string().trim().toLowerCase().email().max(254);
const Code = z.string().trim().transform((v) => v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))).pipe(z.string().regex(/^\d{6}$/));

export const PlatformLogin = z.object({ email: Email, password: z.string().min(1).max(128) }).strict();
export const PlatformVerify = z.object({ email: Email, code: Code }).strict();

/** ADM-02 */
export const ExtendTrial = z.object({ until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD') }).strict();
export const Suspend = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export const ChangePlan = z.object({ planId: z.string().uuid() }).strict();
export const Activate = z.object({ cycle: z.enum(['monthly', 'yearly']) }).strict();
/** Phase 2B: a payment the clinic made outside the system (amount in minor units; the key makes a repeated form one payment) */
export const RecordPayment = z.object({
  amountMinor: z.number().int().min(1).max(1_000_000_000),
  cycle: z.enum(['monthly', 'yearly']),
  method: z.enum(['instapay', 'vodafone_cash', 'bank_transfer', 'cash', 'other']),
  reference: z.string().trim().max(100).nullish().transform((v) => v || null),
  note: z.string().trim().max(500).nullish().transform((v) => v || null),
  idempotencyKey: z.string().uuid(),
}).strict();
export type RecordPaymentInput = z.infer<typeof RecordPayment>;
/** What the clinics are told about paying; empty clears it. */
export const BillingInstructions = z.object({ text: z.string().max(2000) }).strict();
export const NewNote = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

/** H6: a new version of a legal document (plain text; paragraphs separated by blank lines) */
export const PublishLegal = z.object({
  kind: z.enum(['terms', 'privacy', 'dpa']),
  titleAr: z.string().trim().min(2).max(200),
  bodyAr: z.string().trim().min(20).max(200_000),
  requiresReacceptance: z.boolean(),
}).strict();

/** H7: a landing-page request moves along */
export const LeadStatus = z.object({ status: z.enum(['new', 'contacted', 'converted', 'lost']) }).strict();

/** ADM-04: prices in minor units; limits and features are the plan's known keys only */
const Limit = z.number().int().min(0).max(1_000_000).nullable();
export const EditPlan = z.object({
  nameAr: z.string().trim().min(2).max(60).optional(),
  priceMonthlyMinor: z.number().int().min(0).max(100_000_000).optional(),
  priceYearlyMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  limits: z.object({ branches: Limit, staff: Limit, doctors: Limit, patients: Limit, storage_mb: Limit }).partial().strict().optional(),
  features: z.object({ custom_domain: z.boolean(), online_payments: z.boolean(), remove_badge: z.boolean() }).partial().strict().optional(),
  isPublic: z.boolean().optional(),
}).strict();
export type EditPlanInput = z.infer<typeof EditPlan>;

/** A new plan: the same fields, all required but limits and features, plus its code (the slug the landing page's «اشترك الآن» link carries; never changes). */
export const NewPlan = EditPlan.required({ nameAr: true, priceMonthlyMinor: true, priceYearlyMinor: true, trialDays: true }).extend({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, 'Latin letters, digits, - and _'),
}).strict();
export type NewPlanInput = z.infer<typeof NewPlan>;
