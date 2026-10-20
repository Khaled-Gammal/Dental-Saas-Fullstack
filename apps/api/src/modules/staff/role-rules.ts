/** Pure rules of custom roles (Phase H4). No I/O, so they are unit-tested directly. */
import { CLINICAL_WRITE, GRANTABLE, MONEY_WRITE, REQUIRES, type Permission } from '../../auth/permission-catalogue';
import { hasPermission } from '../../auth/permissions';

export type PermissionProblem =
  | { error: 'permission_unknown'; permission: string }
  | { error: 'permission_requires'; permission: string; requires: string };

/** A role's permissions: from the catalogue only (never '*'), each with what it needs. */
export function checkRolePermissions(perms: readonly string[]): PermissionProblem | null {
  const unknown = perms.find((p) => !GRANTABLE.includes(p));
  if (unknown) return { error: 'permission_unknown', permission: unknown };
  for (const p of perms) {
    const missing = (REQUIRES[p as Permission] ?? []).find((r) => !perms.includes(r));
    if (missing) return { error: 'permission_requires', permission: p, requires: missing };
  }
  return null;
}

/**
 * Anti-escalation (owner 2026-10-20: staff:manage may be granted): a member who is not the owner gives a role only
 * permissions they hold themselves. Returns the first permission they may not give, or null. The owner ('*') may give any.
 */
export function notHeld(caller: readonly string[] | undefined, granted: readonly string[]): string | null {
  return granted.find((p) => !hasPermission(caller, p)) ?? null;
}

/** What an edit adds: only new permissions are checked against the caller (taking rights away is always allowed). */
export const added = (before: readonly string[], after: readonly string[]) => after.filter((p) => !before.includes(p));

/** SRS B.1 separation rule, as a warning: clinical writing and money writing in one role. */
export const mixesClinicalAndMoney = (perms: readonly string[]) =>
  perms.some((p) => CLINICAL_WRITE.includes(p)) && perms.some((p) => MONEY_WRITE.includes(p));
