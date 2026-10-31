import { z } from 'zod';

const Uuid = z.string().uuid();
const Text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

/**
 * Phase 2C-2: a before/after case. `consentConfirmed`: the clinic has the patient's written consent to publish these
 * images (who confirmed it and when is recorded by the database); a case is published only with it.
 */
export const NewCase = z.object({
  beforeFileId: Uuid,
  afterFileId: Uuid,
  serviceId: Uuid.nullish().transform((v) => v ?? null),
  captionAr: Text(300),
  altAr: Text(200),
  consentConfirmed: z.boolean(),
  isPublished: z.boolean().optional(),
}).strict().refine((c) => c.beforeFileId !== c.afterFileId, { message: 'two different images', path: ['afterFileId'] });
export type NewCaseInput = z.infer<typeof NewCase>;

export const EditCase = z.object({
  beforeFileId: Uuid.optional(),
  afterFileId: Uuid.optional(),
  serviceId: Uuid.nullable().optional(),
  captionAr: Text(300).optional(),
  altAr: Text(200).optional(),
  consentConfirmed: z.boolean().optional(),
  isPublished: z.boolean().optional(),
}).strict();
export type EditCaseInput = z.infer<typeof EditCase>;

export const CaseOrder = z.object({ ids: z.array(Uuid).min(1).max(200) }).strict()
  .refine((o) => new Set(o.ids).size === o.ids.length, { message: 'ids must be unique' });
