import { z } from 'zod';

const Uuid = z.string().uuid();
const Text = (max: number) => z.string().trim().max(max).transform((v) => v || null);

/** Where a photo belongs: the whole clinic (null) or one branch. */
const Scope = Uuid.nullable();

export const CreateGalleryItem = z.object({
  fileId: Uuid,
  branchId: Scope.optional(),
  captionAr: Text(300).nullable().optional(),
  captionEn: Text(300).nullable().optional(),
  altAr: Text(200).nullable().optional(),
  altEn: Text(200).nullable().optional(),
  isPublished: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
}).strict();
export type CreateGalleryItemInput = z.infer<typeof CreateGalleryItem>;

export const UpdateGalleryItem = CreateGalleryItem.omit({ fileId: true }).partial().strict();
export type UpdateGalleryItemInput = z.infer<typeof UpdateGalleryItem>;

/** The full order of one scope, first to last. */
export const ReorderGallery = z.object({ branchId: Scope, ids: z.array(Uuid).min(1).max(500) }).strict()
  .refine((o) => new Set(o.ids).size === o.ids.length, { message: 'ids must be unique' });

export const ListGalleryQuery = z.object({
  /** all | clinic (clinic-wide only) | a branch id */
  scope: z.union([z.literal('all'), z.literal('clinic'), Uuid]).default('all'),
  status: z.enum(['all', 'published', 'draft']).default('all'),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
}).strict();
export type ListGalleryQueryInput = z.infer<typeof ListGalleryQuery>;

export const PublicGalleryQuery = z.object({
  host: z.string().trim().toLowerCase().min(1).max(253).transform((h) => h.split(':')[0].replace(/\.$/, '')),
  /** clinic (clinic-wide photos), a branch id, or all (default) */
  scope: z.union([z.literal('all'), z.literal('clinic'), Uuid]).default('all'),
}).strict();
