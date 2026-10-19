import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Tx } from '@dental/db';
import { hasPermission } from '../../auth/permissions';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { dateInZone, safeTimeZone } from '../../shared/time/clinic-time';
import {
  attendanceReport, expensesReport, netCollections, outstandingReport, performanceReport, reportAccess, resolvePeriod, revenueReport,
  type Period, type ReportKind, type Scope,
} from './reports-rules';
import type { ReportQueryInput } from './reports.schemas';
import { ReportsRepository } from './reports.repository';

const REPORT_PERMISSIONS = ['reports:read', 'reports:read:daily', 'reports:read:own'];
type Name = { name_ar: string | null; name_en: string | null };

/**
 * The reports (SRS REPORT-001…005). Each request names a period (at most a year) and optionally one branch; the
 * member's branches bound everything (row-level security). Reception sees today's revenue and collections only; a
 * doctor sees attendance and performance for themselves only. Nothing here writes.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: ReportsRepository,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /** the branch picker: the branches the member works at */
  branches() {
    if (!REPORT_PERMISSIONS.some((p) => hasPermission(this.cls.get('permissions'), p))) throw Err.forbidden('missing_permission', 'You cannot see reports');
    return this.db.run((tx) => this.repo.branches(tx));
  }

  revenue(q: ReportQueryInput) {
    return this.report('revenue', q, async (tx, p, branchId) => revenueReport(await this.repo.money(tx, p, branchId)));
  }

  expenses(q: ReportQueryInput) {
    return this.report('expenses', q, async (tx, p, branchId) => {
      const [rows, money, categories] = await Promise.all([this.repo.expenses(tx, p, branchId), this.repo.money(tx, p, branchId), this.repo.categories(tx)]);
      const r = expensesReport(rows, netCollections(money));
      const names = new Map(categories.map((c) => [c.id, c.name]));
      return { ...r, by_category: r.by_category.map((c) => ({ ...c, name: names.get(c.category_id) ?? null })) };
    });
  }

  attendance(q: ReportQueryInput) {
    return this.report('attendance', q, async (tx, p, branchId, doctorId) => attendanceReport(await this.repo.attendance(tx, p, branchId, doctorId)));
  }

  performance(q: ReportQueryInput) {
    return this.report('performance', q, async (tx, p, branchId, doctorId, scope) => {
      const [att, procs, money] = await Promise.all([
        this.repo.attendance(tx, p, branchId, doctorId), this.repo.procedures(tx, p, branchId, doctorId),
        scope === 'own' ? null : this.repo.money(tx, p, branchId), // a doctor's own view has no collections
      ]);
      return performanceReport(att, procs, money);
    });
  }

  /** REPORT-004 is a picture of now: the period does not apply. */
  outstanding(q: ReportQueryInput) {
    return this.report('outstanding', q, async (tx, _p, branchId) => {
      const [rows, overdue] = await Promise.all([this.repo.outstanding(tx, branchId), this.repo.overdue(tx, branchId)]);
      return outstandingReport(rows, overdue);
    });
  }

  /**
   * The common frame: today in the clinic's zone, the period, the access decision, the branch check, then the report
   * with branch and doctor names filled in.
   */
  private report<R extends object>(kind: ReportKind, q: ReportQueryInput, build: (tx: Tx, p: Period, branchId: string | null, doctorId: string | null, scope: Scope) => Promise<R>) {
    return this.db.run(async (tx, tenantId) => {
      const perms = this.cls.get('permissions');
      const clinic = await this.repo.clinic(tx, tenantId);
      const today = dateInZone(Date.now(), safeTimeZone(clinic.timezone));
      const dailyOnly = kind === 'revenue' && !hasPermission(perms, 'reports:read') && hasPermission(perms, 'reports:read:daily');
      const period = resolvePeriod(q, today, dailyOnly);
      if ('error' in period) {
        throw Err.badRequest(period.error, period.error === 'period_too_long' ? 'A report covers at most a year' : 'The period ends before it starts');
      }
      const access = reportAccess(perms, kind, q.from || q.to ? period : null, today);
      if ('error' in access) {
        throw access.error === 'today_only'
          ? Err.forbidden('today_only', 'You can see today’s figures only')
          : Err.forbidden('missing_permission', 'You cannot see this report');
      }
      const branches = await this.repo.branches(tx);
      if (q.branchId && !branches.some((b) => b.id === q.branchId)) throw Err.notFound('branch_not_found', 'Branch not found');

      let doctorId: string | null = null;
      if (access.scope === 'own') {
        const memberId = this.cls.get('memberId');
        doctorId = memberId ? await this.repo.doctorOf(tx, memberId) : null;
        if (!doctorId) throw Err.forbidden('not_a_doctor', 'Your account is not linked to a doctor');
      }
      const body = await build(tx, period, q.branchId ?? null, doctorId, access.scope);
      const doctors = await this.repo.doctors(tx);
      return {
        kind, scope: access.scope, period: kind === 'outstanding' ? null : period, today, branch_id: q.branchId ?? null, currency: clinic.currency,
        ...withNames(body, new Map(branches.map((b) => [b.id, b])), new Map(doctors.map((d) => [d.id, d]))),
      };
    });
  }
}

/** Puts the branch and doctor names next to their ids in every list of the report (the rows carry ids only). */
function withNames<R extends object>(report: R, branches: Map<string, Name>, doctors: Map<string, Name>): R {
  const name = (n: Name | undefined) => (n ? { name_ar: n.name_ar, name_en: n.name_en } : null);
  const fill = (row: unknown): unknown => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const r = row as Record<string, unknown>;
    return {
      ...r,
      ...(typeof r.branch_id === 'string' && { branch: name(branches.get(r.branch_id)) }),
      ...(typeof r.doctor_id === 'string' && { doctor: name(doctors.get(r.doctor_id)) }),
    };
  };
  return Object.fromEntries(Object.entries(report).map(([k, v]) => [k, Array.isArray(v) ? v.map(fill) : v])) as R;
}
