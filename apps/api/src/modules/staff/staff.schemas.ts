import { z } from 'zod';
import { DisplayName } from '../../shared/validation/common';

const Uuid = z.string().uuid();
const BranchIds = z.array(Uuid).max(50).transform((ids) => [...new Set(ids)]);
const JobTitle = z.string().trim().max(80).transform((v) => v || null);

export const InviteBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  roleId: Uuid,
  /** true = every branch; false = only `branchIds` (at least one) */
  allBranches: z.boolean().default(true),
  branchIds: BranchIds.default([]),
  jobTitle: JobTitle.nullable().optional(),
  /** the doctor record this person will sign in as */
  doctorId: Uuid.nullable().optional(),
}).strict().refine((b) => b.allBranches || b.branchIds.length > 0, { message: 'Choose at least one branch', path: ['branchIds'] });
export type InviteInput = z.infer<typeof InviteBody>;

export const UpdateMemberBody = z.object({
  roleId: Uuid.optional(),
  status: z.enum(['active', 'disabled']).optional(),
  allBranches: z.boolean().optional(),
  branchIds: BranchIds.optional(),
  jobTitle: JobTitle.nullable().optional(),
}).strict().refine((b) => b.allBranches !== false || (b.branchIds?.length ?? 0) > 0, { message: 'Choose at least one branch', path: ['branchIds'] });
export type UpdateMemberInput = z.infer<typeof UpdateMemberBody>;

/** Accepting an invitation: a new account gives its name and a password; an existing one confirms its password. */
export const AcceptBody = z.object({ fullName: DisplayName.optional(), password: z.string().min(1).max(128) }).strict();
export type AcceptInput = z.infer<typeof AcceptBody>;

/** The opaque token in the emailed link (32 random bytes, base64url). */
export const InvitationToken = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/, 'invitation link is not valid');
