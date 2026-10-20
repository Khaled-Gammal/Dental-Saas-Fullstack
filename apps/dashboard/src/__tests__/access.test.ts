import { describe, expect, it } from 'vitest';
import { canOpen, canSee } from '../access';
import { parseRoute, type Page } from '../router';
import { assignableRoles, mixesClinicalAndMoney, roleOptions, togglePermission } from '../roles-model';
import type { PermissionGroup, StaffRole } from '../types';

const holder = (...perms: string[]) => (p: string) => perms.includes('*') || perms.includes(p);
const open = (has: (p: string) => boolean, hash: string) => canOpen(has, parseRoute(hash));

// the built-in roles' defaults (SRS B.1, migration 0029)
const doctor = holder('branches:read', 'patients:read', 'patients:write', 'patients:merge', 'clinical:read', 'clinical:write', 'appointments:read',
  'appointments:write:own', 'treatments:write:own', 'invoices:read:own', 'reports:read:own');
const reception = holder('branches:read', 'patients:read', 'patients:write', 'patients:merge', 'patients:block', 'clinical:read', 'appointments:read',
  'appointments:write', 'appointments:override', 'invoices:read', 'invoices:write', 'payments:write', 'payments:reverse', 'discounts:apply',
  'reports:read:daily', 'cash:operate');

describe('page access (H4)', () => {
  it('the owner opens everything; a role with nothing opens only the pages every member reads', () => {
    const pages: Page[] = ['overview', 'appointments', 'patients', 'invoices', 'expenses', 'cash', 'reports', 'staff', 'roles', 'gallery'];
    for (const p of pages) expect(canSee(holder('*'), p)).toBe(true);
    const nobody = holder();
    expect(['overview', 'profile', 'branches', 'doctors', 'services'].every((p) => canSee(nobody, p as Page))).toBe(true);
    expect(['appointments', 'patients', 'followups', 'invoices', 'gallery', 'roles'].some((p) => canSee(nobody, p as Page))).toBe(false);
  });
  it('built-in roles see what their API allows: no gallery for staff, no invoice list for a doctor', () => {
    expect(canSee(reception, 'gallery')).toBe(false);
    expect(canSee(doctor, 'invoices')).toBe(false);
    expect(open(doctor, '#/invoices/abc/view')).toBe(true); // invoices:read:own opens one invoice
    expect(canSee(reception, 'cash')).toBe(true);
    expect(canSee(reception, 'expenses')).toBe(false); // owner 2026-10-20
    expect(canSee(doctor, 'reports')).toBe(true);
  });
  it('a screen of a page can need more than the page', () => {
    expect(open(doctor, '#/appointments')).toBe(true);
    expect(open(doctor, '#/appointments/new')).toBe(false); // appointments:write
    expect(open(holder('appointments:write'), '#/appointments/new')).toBe(false); // the patient picker needs patients:read
    expect(open(reception, '#/appointments/new')).toBe(true);
    expect(open(holder('patients:read'), '#/patients/abc/merge')).toBe(false);
    expect(open(holder('patients:read', 'patients:merge'), '#/patients/abc/merge')).toBe(true);
    expect(open(holder('clinical:read'), '#/visits/abc/view')).toBe(false); // its side cards read the patient
    expect(open(holder('branches:read'), '#/branches/new')).toBe(false);
    expect(open(holder(), '#/nothing-here')).toBe(true); // not-found shows its own page
  });
});

const role = (id: string, key: string, permissions: string[], archived = false): StaffRole => ({
  id, key, name_ar: key, name_en: key, is_system: !key.startsWith('custom-'), permissions, archived_at: archived ? '2026-10-20' : null,
  members: 0, invitations: 0, mixes_clinical_and_money: false, can: { edit: false, remove: false },
});
const ROLES = [role('o', 'owner', ['*']), role('r', 'receptionist', ['patients:read', 'payments:write']), role('c', 'custom-1', ['patients:read']),
  role('x', 'custom-2', ['patients:read'], true)];

describe('who may be given which role', () => {
  it('the owner gives any role in use; a manager no owner role and nothing beyond their rights', () => {
    expect(assignableRoles(ROLES, holder('*')).map((r) => r.id)).toEqual(['o', 'r', 'c']);
    expect(assignableRoles(ROLES, holder('staff:manage', 'patients:read')).map((r) => r.id)).toEqual(['c']);
  });
  it('the member\'s current role still shows in the picker', () => {
    expect(roleOptions(ROLES, holder('staff:manage', 'patients:read'), 'r').map((r) => r.id)).toEqual(['r', 'c']);
  });
});

const CATALOGUE: PermissionGroup[] = [
  { key: 'patients', permissions: [{ key: 'patients:read', requires: [] }, { key: 'patients:write', requires: ['patients:read'] }, { key: 'patients:merge', requires: ['patients:write'] }] },
];

describe('picking permissions', () => {
  it('ticking one ticks what it needs; unticking one unticks what needs it', () => {
    expect(togglePermission(CATALOGUE, [], 'patients:merge', true)).toEqual(['patients:merge', 'patients:read', 'patients:write']);
    expect(togglePermission(CATALOGUE, ['patients:merge', 'patients:read', 'patients:write'], 'patients:read', false)).toEqual([]);
    expect(togglePermission(CATALOGUE, ['patients:merge', 'patients:read', 'patients:write'], 'patients:merge', false)).toEqual(['patients:read', 'patients:write']);
  });
  it('flags a role that writes both clinical records and money (a warning, not a refusal)', () => {
    expect(mixesClinicalAndMoney(['clinical:write', 'payments:write'])).toBe(true);
    expect(mixesClinicalAndMoney(['clinical:write', 'invoices:read'])).toBe(false);
  });
});
