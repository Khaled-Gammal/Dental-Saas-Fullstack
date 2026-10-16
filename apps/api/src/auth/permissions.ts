/** The one permission rule: a role holds a permission when it lists it or holds '*'. Used by the guard and by use cases that check rights against a row (doctor "own" visits). */
export const hasPermission = (perms: readonly string[] | undefined, p: string): boolean => !!perms && (perms.includes('*') || perms.includes(p));
