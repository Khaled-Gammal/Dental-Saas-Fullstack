import type { StaffMember } from './types';

/** The invite form (`#/staff/new`). Mirrors the API's InviteBody. */
export interface InviteForm { email: string; roleId: string; allBranches: boolean; branchIds: string[]; jobTitle: string; doctorId: string }
export const EMPTY_INVITE: InviteForm = { email: '', roleId: '', allBranches: true, branchIds: [], jobTitle: '', doctorId: '' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What stops the invite from being sent, in the order the form shows it; null when it can be sent. */
export function inviteProblem(f: InviteForm): 'email' | 'role' | 'branches' | null {
  if (!EMAIL.test(f.email.trim())) return 'email';
  if (!f.roleId) return 'role';
  if (!f.allBranches && f.branchIds.length === 0) return 'branches';
  return null;
}

export function toInviteBody(f: InviteForm): Record<string, unknown> {
  return {
    email: f.email.trim().toLowerCase(),
    roleId: f.roleId,
    allBranches: f.allBranches,
    branchIds: f.allBranches ? [] : f.branchIds,
    ...(f.jobTitle.trim() && { jobTitle: f.jobTitle.trim() }),
    ...(f.doctorId && { doctorId: f.doctorId }),
  };
}

/** A member's editable access (`#/staff/<id>/edit`). */
export interface MemberForm { roleId: string; allBranches: boolean; branchIds: string[]; jobTitle: string; active: boolean }

export const memberForm = (m: StaffMember): MemberForm => ({
  roleId: m.role.id, allBranches: m.all_branches, branchIds: m.all_branches ? [] : m.branch_ids, jobTitle: m.job_title ?? '', active: m.status === 'active',
});

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Only what changed (so a background refetch can never be saved back over someone else's change). */
export function toMemberPatch(f: MemberForm, orig: MemberForm): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.roleId !== orig.roleId) body.roleId = f.roleId;
  if (f.active !== orig.active) body.status = f.active ? 'active' : 'disabled';
  if (f.jobTitle.trim() !== orig.jobTitle.trim()) body.jobTitle = f.jobTitle.trim();
  if (f.allBranches !== orig.allBranches) body.allBranches = f.allBranches;
  if (!f.allBranches && (f.allBranches !== orig.allBranches || !sameSet(f.branchIds, orig.branchIds))) body.branchIds = f.branchIds;
  return body;
}
