/**
 * Roles and permissions on the dashboard (H4). Pure, unit-tested. The API decides; these only keep the screens from
 * offering what it would refuse: a member who is not the owner gives only permissions they hold, never the owner role.
 */
import type { PermissionGroup, StaffRole } from './types';

type Has = (p: string) => boolean;

/** Roles a member may give: none archived; the owner any; anyone else no owner role and no right they lack. */
export function assignableRoles(roles: readonly StaffRole[], has: Has): StaffRole[] {
  return roles.filter((r) => !r.archived_at && (has('*') || (r.key !== 'owner' && r.permissions.every(has))));
}

/** The role picker: what may be given, plus the member's current role so it still shows. */
export function roleOptions(roles: readonly StaffRole[], has: Has, currentId?: string): StaffRole[] {
  const ok = assignableRoles(roles, has);
  const current = roles.find((r) => r.id === currentId);
  return current && !ok.includes(current) ? [current, ...ok] : ok;
}

/**
 * Ticking a permission ticks what it needs (and what that needs); unticking one unticks what needs it. So a role is
 * always valid as the API checks it (`permission_requires`).
 */
export function togglePermission(catalogue: readonly PermissionGroup[], selected: readonly string[], key: string, on: boolean): string[] {
  const requires = new Map(catalogue.flatMap((g) => g.permissions.map((p) => [p.key, p.requires] as const)));
  const next = new Set(selected);
  if (on) {
    const add = (k: string) => { if (next.has(k)) return; next.add(k); (requires.get(k) ?? []).forEach(add); };
    add(key);
  } else {
    const remove = (k: string) => {
      if (!next.delete(k)) return;
      for (const [p, needs] of requires) if (needs.includes(k)) remove(p);
    };
    remove(key);
  }
  return [...next].sort();
}

/** SRS B.1 separation rule, as the warning the API also sends: clinical writing and money writing in one role. */
const CLINICAL_WRITE = ['clinical:write', 'treatments:write:own'];
const MONEY_WRITE = ['invoices:write', 'invoices:void', 'payments:write', 'payments:refund', 'payments:reverse', 'payments:adjust', 'discounts:apply',
  'discounts:approve', 'expenses:write', 'expenses:approve', 'cash:operate', 'cash:reopen'];
export const mixesClinicalAndMoney = (perms: readonly string[]) =>
  perms.some((p) => CLINICAL_WRITE.includes(p)) && perms.some((p) => MONEY_WRITE.includes(p));
