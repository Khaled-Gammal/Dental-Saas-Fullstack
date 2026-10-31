import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { sql, type Tx } from '@dental/db';
import type { RequestContext } from '../context/request-context';

export interface AuditEntry {
  action: string; // patient.view, patient.update, patient.medical_history.update
  entityType: string;
  entityId: string;
  /** {"field": [old, new]} for plain fields; medical free text is recorded as `true` (changed), never its value */
  changes?: Record<string, unknown>;
  /** who acted: a signed-in member (default), or the patient themself (online booking) */
  actorType?: 'member' | 'patient' | 'system';
}

/**
 * Writes `audit_log` rows (DSH-15, NFR-03) in the caller's transaction, so an audit row exists exactly when the
 * change it describes committed. The actor, IP and user agent come from the request context. The table is
 * append-only for the API role (no UPDATE/DELETE grant).
 */
@Injectable()
export class AuditLog {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  private actor() {
    return { actor_type: 'member', actor_user_id: this.cls.get('userId') ?? null, ip: this.cls.get('ip') ?? null, user_agent: this.cls.get('userAgent') ?? null };
  }

  async record(tx: Tx, tenantId: string, e: AuditEntry): Promise<void> {
    await tx.insertInto('audit_log').values({
      tenant_id: tenantId, action: e.action, entity_type: e.entityType, entity_id: e.entityId,
      changes: e.changes ? JSON.stringify(e.changes) : null, ...this.actor(), ...(e.actorType && e.actorType !== 'member' && { actor_type: e.actorType, actor_user_id: null }),
    }).execute();
  }

  /** Phase 2A: many rows in one statement (an import creates hundreds of records in one transaction). */
  async recordMany(tx: Tx, tenantId: string, entries: AuditEntry[]): Promise<void> {
    if (!entries.length) return;
    await tx.insertInto('audit_log').values(entries.map((e) => ({
      tenant_id: tenantId, action: e.action, entity_type: e.entityType, entity_id: e.entityId,
      changes: e.changes ? JSON.stringify(e.changes) : null, ...this.actor(),
    }))).execute();
  }

  /**
   * A "viewed" row at most once per actor, record and `windowMinutes`: a dashboard that refetches on focus must not
   * flood the log, but every distinct access is still visible.
   */
  async recordView(tx: Tx, tenantId: string, entityType: string, entityId: string, windowMinutes = 10): Promise<void> {
    const a = this.actor();
    await sql`
      insert into audit_log (tenant_id, actor_type, actor_user_id, action, entity_type, entity_id, ip, user_agent)
      select ${tenantId}, ${a.actor_type}, ${a.actor_user_id}, ${`${entityType}.view`}, ${entityType}, ${entityId}, ${a.ip}::inet, ${a.user_agent}
      where not exists (
        select 1 from audit_log
        where tenant_id = ${tenantId} and entity_type = ${entityType} and entity_id = ${entityId}
          and action = ${`${entityType}.view`} and actor_user_id is not distinct from ${a.actor_user_id}
          and created_at > now() - make_interval(mins => ${windowMinutes}))`.execute(tx);
  }
}
