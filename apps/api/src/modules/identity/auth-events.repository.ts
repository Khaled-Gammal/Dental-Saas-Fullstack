import { Injectable } from '@nestjs/common';
import { AUTH_POLICY } from '../../config';
import { TenantDb } from '../../shared/database/tenant-db.service';
import type { AuthEventType, RequestMeta } from './identity.types';

/** User agents are client-controlled: store a bounded prefix only. */
export const clipUserAgent = (ua: string | undefined) => ua?.slice(0, AUTH_POLICY.userAgentMaxLength) ?? null;

/** Security audit trail (auth_events has no RLS; purged after 180 days by the worker). */
@Injectable()
export class AuthEventsRepository {
  constructor(private readonly db: TenantDb) {}

  async record(type: AuthEventType, meta: RequestMeta, userId?: string, identifier?: string): Promise<void> {
    await this.db.platform().insertInto('auth_events')
      .values({
        type, user_id: userId ?? null, identifier: identifier ?? null, ip: meta.ip ?? null,
        user_agent: clipUserAgent(meta.userAgent),
      })
      .execute();
  }
}
