import { describe, expect, it } from 'vitest';
import { EMPTY_INVITE, inviteProblem, memberForm, toInviteBody, toMemberPatch } from '../staff-model';
import type { StaffMember } from '../types';

describe('invite form', () => {
  it('needs an email, a role, and branches when not all', () => {
    expect(inviteProblem(EMPTY_INVITE)).toBe('email');
    expect(inviteProblem({ ...EMPTY_INVITE, email: 'a@b.co' })).toBe('role');
    expect(inviteProblem({ ...EMPTY_INVITE, email: 'a@b.co', roleId: 'r', allBranches: false })).toBe('branches');
    expect(inviteProblem({ ...EMPTY_INVITE, email: 'a@b.co', roleId: 'r', allBranches: false, branchIds: ['b'] })).toBeNull();
  });

  it('sends branches only when limited, and leaves out empty optional fields', () => {
    expect(toInviteBody({ ...EMPTY_INVITE, email: ' Sara@Clinic.EG ', roleId: 'r', branchIds: ['b'] }))
      .toEqual({ email: 'sara@clinic.eg', roleId: 'r', allBranches: true, branchIds: [] });
    expect(toInviteBody({ ...EMPTY_INVITE, email: 'x@y.eg', roleId: 'r', allBranches: false, branchIds: ['b'], jobTitle: ' استقبال ', doctorId: 'd' }))
      .toEqual({ email: 'x@y.eg', roleId: 'r', allBranches: false, branchIds: ['b'], jobTitle: 'استقبال', doctorId: 'd' });
  });
});

describe('member form', () => {
  const m: StaffMember = {
    id: 'm', status: 'active', all_branches: false, branch_ids: ['b1'], job_title: null, joined_at: '2026-01-01',
    role: { id: 'r1', key: 'receptionist', name_ar: 'الاستقبال', name_en: 'Receptionist' }, user: { full_name: 'X', email: 'x@y.eg', phone: null }, doctor: null,
  };

  it('an untouched form sends nothing', () => {
    expect(toMemberPatch(memberForm(m), memberForm(m))).toEqual({});
  });

  it('sends only what changed', () => {
    const orig = memberForm(m);
    expect(toMemberPatch({ ...orig, active: false }, orig)).toEqual({ status: 'disabled' });
    expect(toMemberPatch({ ...orig, branchIds: ['b2', 'b1'] }, orig)).toEqual({ branchIds: ['b2', 'b1'] });
    expect(toMemberPatch({ ...orig, branchIds: ['b1'] }, orig)).toEqual({}); // same set
    expect(toMemberPatch({ ...orig, allBranches: true }, orig)).toEqual({ allBranches: true });
    expect(toMemberPatch({ ...orig, roleId: 'r2', jobTitle: 'مدير' }, orig)).toEqual({ roleId: 'r2', jobTitle: 'مدير' });
  });

  it('limiting an all-branch member sends the chosen branches with the switch', () => {
    const orig = memberForm({ ...m, all_branches: true, branch_ids: [] });
    expect(toMemberPatch({ ...orig, allBranches: false, branchIds: ['b1'] }, orig)).toEqual({ allBranches: false, branchIds: ['b1'] });
  });
});
