import { z } from 'zod';
import { SECTION_KEYS } from './sections';

/** Text the clinic types: trimmed; line breaks kept in answers. */
const Text = (min: number, max: number) => z.string().trim().min(min).max(max);
const OptionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const NewFaq = z.object({
  questionAr: Text(5, 300),
  answerAr: Text(2, 3000),
  questionEn: OptionalText(300),
  answerEn: OptionalText(3000),
  serviceId: z.string().uuid().nullish().transform((v) => v ?? null),
  isActive: z.boolean().optional(),
}).strict();
export type NewFaqInput = z.infer<typeof NewFaq>;

export const EditFaq = z.object({
  questionAr: Text(5, 300).optional(),
  answerAr: Text(2, 3000).optional(),
  questionEn: OptionalText(300).optional(),
  answerEn: OptionalText(3000).optional(),
  serviceId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();
export type EditFaqInput = z.infer<typeof EditFaq>;

/** The full order of the clinic's questions, first to last. */
export const FaqOrder = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict()
  .refine((o) => new Set(o.ids).size === o.ids.length, { message: 'ids must be unique' });

/** Phase 2C-3: the search title and description (empty = the defaults) and the share image (null = made from the logo). */
const SeoText = (min: number, max: number) => z.string().trim().max(max).nullable()
  .transform((v) => v || null).refine((v) => v === null || v.length >= min, { message: `at least ${min} characters` });
export const Seo = z.object({
  title: SeoText(5, 70).optional(),
  description: SeoText(20, 200).optional(),
  shareFileId: z.string().uuid().nullable().optional(),
}).strict();
export type SeoInput = z.infer<typeof Seo>;

/** The website's sections: each key exactly once, in the order shown. */
export const Sections = z.object({
  sections: z.array(z.object({ key: z.enum(SECTION_KEYS), visible: z.boolean() }).strict()).length(SECTION_KEYS.length)
    .refine((l) => new Set(l.map((s) => s.key)).size === l.length, { message: 'each section once' }),
}).strict();
export type SectionsInput = z.infer<typeof Sections>;
