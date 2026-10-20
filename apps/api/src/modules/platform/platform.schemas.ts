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
export const NewNote = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

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
