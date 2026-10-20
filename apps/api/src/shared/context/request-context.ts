import { type ClsStore } from 'nestjs-cls';

/** What we know about the caller for the lifetime of one request (stored with AsyncLocalStorage). */
export interface RequestContext extends ClsStore {
  requestId: string;
  tenantId?: string;
  userId?: string;
  memberId?: string;
  permissions?: string[];
  /** H5: the platform admin a /platform request acts for (set by PlatformGuard; never with a clinic) */
  platformUserId?: string;
  /** client address and agent, for audit rows (set by JwtAuthGuard) */
  ip?: string;
  userAgent?: string;
}
