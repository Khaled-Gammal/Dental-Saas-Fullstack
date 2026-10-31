import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Tx } from '@dental/db';
import { hasPermission } from '../../auth/permissions';
import { AuditLog } from '../../shared/audit/audit-log';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { dateInZone, safeTimeZone } from '../../shared/time/clinic-time';
import { expectedCash, needsNote } from './finance-rules';
import type { CashHistoryQueryInput } from './finance.schemas';
import { FinanceRepository } from './finance.repository';

const notFound = () => Err.notFound('session_not_found', 'Cash session not found');

/**
 * The daily cash box (SRS CASH-001…004, CLR-04): one session per branch per business day, opened and closed by
 * reception or the accountant (`cash:operate`), reopened by the owner only (`cash:reopen`) with a reason. Expected
 * cash is always computed from recorded payments, refunds and expenses; once a day is closed the database refuses
 * any movement dated into it.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: FinanceRepository,
    private readonly audit: AuditLog,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private can(p: string) { return hasPermission(this.cls.get('permissions'), p); }
  private member(): string {
    const m = this.cls.get('memberId');
    if (!m) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    return m;
  }

  private async today(tx: Tx, tenantId: string) {
    const clinic = await this.repo.clinic(tx, tenantId);
    return { clinic, date: dateInZone(Date.now(), safeTimeZone(clinic.timezone)) };
  }

  /** The branch's cash day as the screen shows it: today's session (or what to open it with) and the live figures. */
  day(branchId: string) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.branch(tx, branchId))) throw Err.notFound('branch_not_found', 'Branch not found');
      const { date } = await this.today(tx, tenantId);
      const [session, earlierOpen, suggestedOpening] = await Promise.all([
        this.repo.sessionOn(tx, branchId, date), this.repo.earlierOpen(tx, branchId, date), this.repo.lastCounted(tx, branchId, date),
      ]);
      return {
        business_date: date,
        session: session ? await this.withFigures(tx, session) : null,
        earlier_open: earlierOpen ? await this.withFigures(tx, earlierOpen) : null,
        suggested_opening: suggestedOpening,
        totals: session ? undefined : await this.repo.totals(tx, branchId, date),
      };
    });
  }

  branches() {
    return this.db.run((tx) => this.repo.myBranches(tx));
  }

  get(id: string) {
    return this.db.run(async (tx) => {
      const s = await this.repo.sessionById(tx, id);
      if (!s) throw notFound();
      return this.withFigures(tx, s);
    });
  }

  /** Redesign R9: what each figure of a cash day is made of (the screen opens it from the figure). */
  movements(id: string) {
    return this.db.run(async (tx) => {
      const s = await this.repo.sessionById(tx, id);
      if (!s) throw notFound();
      return { currency: s.currency, business_date: s.business_date, items: await this.repo.movements(tx, s.branch_id, s.business_date) };
    });
  }

  history(q: CashHistoryQueryInput) {
    return this.db.run((tx) => this.repo.history(tx, q));
  }

  /** CASH-001: today's session, once; a session left open on an earlier day is closed first. */
  open(branchId: string, openingMinor: number) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.repo.branch(tx, branchId))) throw Err.badRequest('branch_not_found', 'Branch not found');
      const { clinic, date } = await this.today(tx, tenantId);
      const existing = await this.repo.sessionOn(tx, branchId, date);
      if (existing) {
        throw existing.status === 'open'
          ? Err.conflict('session_already_open', 'Today’s cash session is already open')
          : Err.conflict('session_closed', 'Today’s cash session is closed; the owner can reopen it');
      }
      const earlier = await this.repo.earlierOpen(tx, branchId, date);
      if (earlier) throw Err.conflict('previous_session_open', 'Close the earlier cash session first', { sessionId: earlier.id, businessDate: earlier.business_date });
      const { id } = await this.repo.open(tx, tenantId, { branchId, date, currency: clinic.currency, openingMinor, by: this.member() });
      return this.withFigures(tx, (await this.repo.sessionById(tx, id))!);
    });
  }

  /**
   * CASH-003: the session row is locked first, so movements already being saved finish and later ones are refused;
   * only then is the day added up, and the counted cash compared with it.
   */
  close(id: string, countedMinor: number, note: string | null) {
    return this.db.run(async (tx, tenantId) => {
      const s = await this.repo.lockSession(tx, id);
      if (!s) throw notFound();
      if (s.status !== 'open') throw Err.conflict('session_closed', 'This cash session is already closed');
      const totals = await this.repo.totals(tx, s.branch_id, s.business_date);
      const expected = expectedCash(s.opening_minor, totals);
      if (needsNote(countedMinor, expected, note)) {
        throw Err.badRequest('difference_note_required', 'Explain the difference between the counted and the expected cash', { expected, difference: countedMinor - expected });
      }
      await this.repo.close(tx, id, { counted: countedMinor, expected, totals, note, by: this.member() });
      await this.audit.record(tx, tenantId, {
        action: 'cash_session.closed', entityType: 'cash_session', entityId: id, changes: { counted: countedMinor, expected, note: !!note },
      });
      return this.withFigures(tx, (await this.repo.sessionById(tx, id))!);
    });
  }

  /** CASH-004 (owner only): the earlier closing figures stay in the reopening history. */
  reopen(id: string, reason: string) {
    return this.db.run(async (tx, tenantId) => {
      const s = await this.repo.lockSession(tx, id);
      if (!s) throw notFound();
      if (s.status !== 'closed') throw Err.conflict('session_open', 'This cash session is open');
      await this.repo.reopen(tx, tenantId, id, reason, this.member());
      await this.audit.record(tx, tenantId, { action: 'cash_session.reopened', entityType: 'cash_session', entityId: id, changes: { reason: true } });
      return this.withFigures(tx, (await this.repo.sessionById(tx, id))!);
    });
  }

  /** Live figures while open; the figures frozen at closing once closed. */
  private async withFigures(tx: Tx, s: NonNullable<Awaited<ReturnType<FinanceRepository['sessionById']>>>) {
    const totals = s.status === 'closed' && s.closing_totals ? s.closing_totals : await this.repo.totals(tx, s.branch_id, s.business_date);
    return {
      ...s,
      totals,
      expected_minor: s.status === 'closed' ? s.expected_minor : expectedCash(s.opening_minor, totals),
      reopenings: s.reopen_count ? await this.repo.reopenings(tx, s.id) : [],
      can: { close: s.status === 'open' && this.can('cash:operate'), reopen: s.status === 'closed' && this.can('cash:reopen') },
    };
  }
}
