import { GRANTABLE, PERMISSION_GROUPS, REQUIRES } from '../../../auth/permission-catalogue';
import { added, checkRolePermissions, mixesClinicalAndMoney, notHeld } from '../role-rules';

// SRS B.1 defaults of the built-in roles (the database function default_role_permissions(), migration 0029)
const BUILT_IN = {
  doctor: ['branches:read', 'patients:read', 'patients:write', 'patients:merge', 'clinical:read', 'clinical:write', 'appointments:read',
    'appointments:write:own', 'treatments:write:own', 'invoices:read:own', 'reports:read:own'],
  receptionist: ['branches:read', 'patients:read', 'patients:write', 'patients:merge', 'patients:block', 'clinical:read', 'appointments:read',
    'appointments:write', 'appointments:override', 'invoices:read', 'invoices:write', 'payments:write', 'payments:reverse', 'discounts:apply',
    'reports:read:daily', 'cash:operate'],
  accountant: ['branches:read', 'patients:read', 'appointments:read', 'invoices:read', 'invoices:write', 'invoices:void', 'payments:write',
    'payments:refund', 'discounts:apply', 'expenses:read', 'expenses:write', 'reports:read', 'cash:operate'],
};

describe('the permission catalogue (H4)', () => {
  it('lists each permission once, never "*", and every requirement is itself in the catalogue', () => {
    expect(new Set(GRANTABLE).size).toBe(GRANTABLE.length);
    expect(GRANTABLE).not.toContain('*');
    for (const [p, needs] of Object.entries(REQUIRES)) {
      expect(GRANTABLE).toContain(p);
      for (const n of needs ?? []) expect(GRANTABLE).toContain(n);
    }
    expect(PERMISSION_GROUPS.length).toBeGreaterThan(5);
  });
  it('every built-in role (catalogue part) passes the same checks a custom role does', () => {
    for (const perms of Object.values(BUILT_IN)) expect(checkRolePermissions(perms)).toBeNull();
  });
});

describe('custom role permissions', () => {
  it('refuses what is not in the catalogue, "*" included', () => {
    expect(checkRolePermissions(['patients:read', '*'])).toEqual({ error: 'permission_unknown', permission: '*' });
    expect(checkRolePermissions(['inventory:write'])).toEqual({ error: 'permission_unknown', permission: 'inventory:write' });
  });
  it('a permission needs what its screens read first', () => {
    expect(checkRolePermissions(['patients:write'])).toEqual({ error: 'permission_requires', permission: 'patients:write', requires: 'patients:read' });
    expect(checkRolePermissions(['payments:refund', 'invoices:read'])).toEqual({ error: 'permission_requires', permission: 'payments:refund', requires: 'payments:write' });
    expect(checkRolePermissions([])).toBeNull();
  });
});

describe('no raising one\'s own rights (staff:manage may be granted)', () => {
  it('the owner gives anything; a manager only what they hold', () => {
    expect(notHeld(['*'], ['payments:refund', 'staff:manage'])).toBeNull();
    expect(notHeld(['staff:manage', 'patients:read'], ['patients:read'])).toBeNull();
    expect(notHeld(['staff:manage', 'patients:read'], ['patients:read', 'payments:refund'])).toBe('payments:refund');
    expect(notHeld(undefined, ['patients:read'])).toBe('patients:read');
  });
  it('only what an edit adds is checked; taking rights away is always allowed', () => {
    expect(added(['a', 'b'], ['b', 'c'])).toEqual(['c']);
    expect(added(['a', 'b'], ['a'])).toEqual([]);
  });
});

describe('separation rule (warning)', () => {
  it('flags a role that writes both clinical records and money', () => {
    expect(mixesClinicalAndMoney(BUILT_IN.doctor)).toBe(false);
    expect(mixesClinicalAndMoney(BUILT_IN.receptionist)).toBe(false);
    expect(mixesClinicalAndMoney(['clinical:write', 'payments:write'])).toBe(true);
    expect(mixesClinicalAndMoney(['treatments:write:own', 'cash:operate'])).toBe(true);
  });
});
