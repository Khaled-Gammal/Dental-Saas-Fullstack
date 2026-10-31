import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { sql, type Tx } from '@dental/db';
import { hasPermission } from '../../auth/permissions';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { viewRow } from './activity-redact';
import { daySpan, decodeCursor, encodeCursor, entityTypes, type ActivityQueryInput } from './activity-log.schemas';
import { ActivityLogRepository } from './activity-log.repository';

const MAX_DAYS = 366;
const DEFAULT_DAYS = 7;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Phase 2D (DSH-15, NFR-03): the clinic's activity log for whoever holds `audit:read` — who changed or opened what,
 * when. Read-only (the log is append-only). The log covers every branch, so members limited to some branches cannot
 * open it. What changed, and which record, follow the reader's other permissions (see viewRow); text people typed
 * (reasons, notes) is never returned, only that it changed.
 */
@Injectable()
export class ActivityLogService {
  constructor(private readonly db: TenantDb, private readonly repo: ActivityLogRepository, private readonly cls: ClsService<RequestContext>) {}

  private can = (p: string) => hasPermission(this.cls.get('permissions'), p);

  /** The log is the whole clinic's (it has no branch): only for members who see every branch. */
  private async assertAllBranches(tx: Tx) {
    const { rows } = await sql<{ all: boolean }>`select member_branch_ids() is null as "all"`.execute(tx);
    if (!rows[0]?.all) throw Err.forbidden('branch_scoped', 'The activity log covers every branch: only for members who see all branches');
  }

  list(q: ActivityQueryInput) {
    return this.db.run(async (tx) => {
      await this.assertAllBranches(tx);
      const today = await this.repo.today(tx);
      const to = q.to ?? (q.from && q.from > today ? q.from : today);
      const from = q.from ?? addDays(to, -(DEFAULT_DAYS - 1));
      if (daySpan(from, to) > MAX_DAYS) throw Err.badRequest('range_too_long', 'Choose a period of a year at most');
      const rows = await this.repo.list(tx, { from, to, actor: q.actor, entityTypes: entityTypes(q.entity), kind: q.kind, after: decodeCursor(q.cursor), limit: q.limit + 1 });
      const items = rows.slice(0, q.limit);
      const last = items[items.length - 1];
      return {
        from, to,
        items: items.map((r) => ({
          id: Number(r.id), at: r.created_at, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
          actorType: r.actor_type, actorName: r.actor_name, ip: r.ip, ...viewRow(r, this.can),
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.cursor_at, Number(last.id)) : null,
      };
    });
  }

  actors() {
    return this.db.run(async (tx) => {
      await this.assertAllBranches(tx);
      return (await this.repo.actors(tx)).map((a) => ({ userId: a.user_id, name: a.name, active: a.status === 'active' }));
    });
  }
}
