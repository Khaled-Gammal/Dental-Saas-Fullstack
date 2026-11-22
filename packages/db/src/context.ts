import { createHmac } from 'node:crypto';

/**
 * ARC-01 (docs/database/arc-01-signed-tenant-context.md): the clinic context of a transaction is signed with a key the
 * database role cannot read. The same key lives in the database's app_context_keys table (written by
 * `pnpm db:context-key`), where enter_context() checks the signature. SQL that runs as the API role therefore cannot
 * choose another clinic: it has no key to sign with.
 */
export interface ContextKey {
  /** app_context_keys.id: several keys can be live during a rotation */
  id: number;
  /** the secret; its UTF-8 bytes are the HMAC key, as `convert_to(secret, 'UTF8')` stores it */
  secret: string;
}

/** The development key (refused in production by apps/api config.ts; `pnpm db:context-key` writes the same default). */
export const DEV_TENANT_CONTEXT_KEY = 'dev-only-tenant-context-key-change-me-in-production';

const mac = (key: ContextKey, message: string) => createHmac('sha256', Buffer.from(key.secret, 'utf8')).update(message, 'utf8').digest('hex');

/** The fields enter_context() takes, with the signature over them (same message as the SQL side). */
export function signContext(key: ContextKey, c: { tenantId: string; memberId?: string | null; userId?: string | null; actorType?: string | null },
  issuedAt = Date.now()) {
  const tenantId = c.tenantId.toLowerCase();
  const memberId = c.memberId ? c.memberId.toLowerCase() : null;
  const userId = c.userId ? c.userId.toLowerCase() : null;
  const actorType = c.actorType || null;
  const sig = mac(key, ['enter-v1', tenantId, memberId ?? '', userId ?? '', actorType ?? '', String(issuedAt)].join('|'));
  return { tenantId, memberId, userId, actorType, issuedAt, keyId: key.id, sig };
}

/** The public website's context: the signature covers the hostname, the database resolves the clinic. */
export function signHost(key: ContextKey, host: string, issuedAt = Date.now()) {
  return { host, issuedAt, keyId: key.id, sig: mac(key, ['host-v1', host, String(issuedAt)].join('|')) };
}
