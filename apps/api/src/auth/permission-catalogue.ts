/**
 * The permissions a role can hold (SRS B.1), grouped as the roles screen shows them. The database keeps the same list
 * in `grantable_permissions()` and refuses anything else on a custom role; `roles.e2e-spec.ts` compares the two.
 * `*` is not here: it is the owner role's alone.
 */
export const PERMISSION_GROUPS = [
  { key: 'clinic', permissions: ['branches:read', 'branches:write', 'settings:write', 'website:write', 'staff:manage'] },
  { key: 'patients', permissions: ['patients:read', 'patients:write', 'patients:merge', 'patients:block'] },
  { key: 'clinical', permissions: ['clinical:read', 'clinical:write', 'treatments:write:own'] },
  { key: 'appointments', permissions: ['appointments:read', 'appointments:write', 'appointments:write:own', 'appointments:override'] },
  {
    key: 'billing',
    permissions: ['invoices:read', 'invoices:read:own', 'invoices:write', 'invoices:void', 'payments:write', 'payments:refund', 'payments:reverse',
      'payments:adjust', 'discounts:apply', 'discounts:approve'],
  },
  { key: 'finance', permissions: ['expenses:read', 'expenses:write', 'expenses:approve', 'cash:operate', 'cash:reopen'] },
  { key: 'reports', permissions: ['reports:read', 'reports:read:daily', 'reports:read:own', 'audit:read'] },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]['permissions'][number];
export const GRANTABLE: readonly string[] = PERMISSION_GROUPS.flatMap((g) => g.permissions);

/** A permission is useless without these (the screens behind it read them first); every built-in role satisfies this. */
export const REQUIRES: Readonly<Partial<Record<Permission, readonly Permission[]>>> = {
  'branches:write': ['branches:read'],
  'patients:write': ['patients:read'],
  'patients:merge': ['patients:write'],
  'patients:block': ['patients:read'],
  'clinical:read': ['patients:read'],
  'clinical:write': ['clinical:read'],
  'treatments:write:own': ['clinical:read'],
  'appointments:write': ['appointments:read'],
  'appointments:write:own': ['appointments:read'],
  'appointments:override': ['appointments:write'],
  'invoices:write': ['invoices:read'],
  'invoices:void': ['invoices:read'],
  'payments:write': ['invoices:read'],
  'payments:refund': ['payments:write'],
  'payments:reverse': ['payments:write'],
  'payments:adjust': ['invoices:read'],
  'discounts:apply': ['invoices:write'],
  'discounts:approve': ['invoices:read'],
  'expenses:write': ['expenses:read'],
  'expenses:approve': ['expenses:read'],
  'cash:reopen': ['cash:operate'],
};

/** SRS B.1 separation rule: a role holding one of each kind is flagged (custom roles: warning only, owner 2026-10-20). */
export const CLINICAL_WRITE: readonly string[] = ['clinical:write', 'treatments:write:own'];
export const MONEY_WRITE: readonly string[] = [
  'invoices:write', 'invoices:void', 'payments:write', 'payments:refund', 'payments:reverse', 'payments:adjust', 'discounts:apply',
  'discounts:approve', 'expenses:write', 'expenses:approve', 'cash:operate', 'cash:reopen',
];
