import { type ClsStore } from 'nestjs-cls';

/** What we know about the caller for the lifetime of one request (stored with AsyncLocalStorage). */
export interface RequestContext extends ClsStore {
  requestId: string;
  tenantId?: string;
  userId?: string;
  memberId?: string;
  permissions?: string[];
  /** client address and agent, for audit rows (set by JwtAuthGuard) */
  ip?: string;
  userAgent?: string;
}
