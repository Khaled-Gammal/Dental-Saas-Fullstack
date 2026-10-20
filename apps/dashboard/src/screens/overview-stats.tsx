import { lazy, Suspense, useState, type ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import { Choice } from '../components/choice';
import { t, type Key } from '../i18n';
import { money } from '../money';
import { change } from '../overview-model';
import { useReport, useReportBranches } from '../queries';
import { PRESETS, presetPeriod, type Preset } from '../reports-model';
import { to, type Route } from '../router';
import type { StatsReport } from '../types';
import { Card, ErrorText, Skeleton } from '../ui/components';
import { CalendarIcon, ChartIcon, ReceiptIcon, UsersIcon } from '../ui/icons';
import { RouteLink } from '../ui/page';
import { fmtNumber } from '../util';

const day = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const month = (ym: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'short', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
// shadcn/ui chart (recharts) loads on demand: only the owner and the accountant see it
const StatsChart = lazy(() => import('./overview-chart'));
const compact = new Intl.NumberFormat('ar-EG-u-nu-latn', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * The clinic's figures for a period, against the period before (owner and accountant: GET /reports/stats, 2026-10-21).
 * This month by default, as the money figures always were; a branch when the member has more than one. Every number
 * is the API's: the cards, the chart and the summary show it as the reports compute it.
 */
export function OverviewStats({ clinicId, today }: { clinicId: string; today: string }) {
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [branchId, setBranchId] = useState('');
  const branches = useReportBranches(clinicId).data ?? [];
  const period = presetPeriod(preset, today);
  const stats = useReport<StatsReport>(clinicId, 'stats', { ...period, branchId: branchId || undefined });
  const s = stats.data;

  return (
    <section className="ov-period" aria-labelledby="ov-period">
      <div className="ov-section-head">
        <div>
          <h2 id="ov-period">{t('ovPeriodTitle')}</h2>
          <p className="muted small">{s ? t('ovVsPeriod').replace('{from}', day(s.previous_period.from)).replace('{to}', day(s.previous_period.to)) : ' '}</p>
        </div>
        <div className="ov-toolbar">
          <Choice value={preset} onChange={(v) => setPreset(v as Preset)} label={t('period')} className="h-9 w-40 bg-card"
            options={PRESETS.map((p) => ({ value: p, label: t(`preset_${p}` as Key) }))} />
          {branches.length > 1 && (
            <Choice value={branchId} onChange={setBranchId} label={t('branch')} noneLabel={t('allBranches')} className="h-9 w-44 bg-card"
              options={branches.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en) }))} />
          )}
        </div>
      </div>

      {stats.isError ? <Card><ErrorText error={stats.error} onRetry={() => void stats.refetch()} /></Card>
        : !s ? <><div className="ov-stats"><Skeleton h={112} count={4} /></div><Skeleton h={280} count={1} /></>
        : (
          <>
            <div className="ov-stats" aria-busy={stats.isFetching || undefined}>
              <PeriodCard icon={<ReceiptIcon size={18} />} label={t('repNet')} cur={s.totals.collections_net} prev={s.previous.collections_net} show={(v) => money(v, s.currency)} route={to.list('reports')}
                sub={<>{t('repInvoiced')} <bdi>{money(s.totals.invoiced, s.currency)}</bdi></>} />
              <PeriodCard icon={<ChartIcon size={18} />} label={t('ovNetIncome')} cur={s.totals.result} prev={s.previous.result} show={(v) => money(v, s.currency)} route={{ page: 'reports', query: { tab: 'expenses' } }}
                sub={t('repResult')} />
              <PeriodCard icon={<UsersIcon size={18} />} label={t('ovNewPatients')} cur={s.totals.new_patients} prev={s.previous.new_patients} show={fmtNumber} route={to.list('patients')}
                sub={t('ovNewPatientsSub')} />
              <PeriodCard icon={<CalendarIcon size={18} />} label={t('ovAppointments')} cur={s.totals.appointments.booked} prev={s.previous.appointments.booked} show={fmtNumber}
                route={{ page: 'reports', query: { tab: 'attendance' } }}
                sub={t('ovAttendedSub').replace('{a}', fmtNumber(s.totals.appointments.attended)).replace('{n}', fmtNumber(s.totals.appointments.no_show))} />
            </div>
            <Card className="ov-chart-card">
              <div className="ov-section-head">
                <div>
                  <h2>{t('homeMoney')}</h2>
                  <p className="muted small">{t(s.bucket === 'day' ? 'ovChartByDay' : 'ovChartByMonth')}</p>
                </div>
                <RouteLink route={to.list('reports')} className="btn btn-secondary btn-sm">{t('navReports')}</RouteLink>
              </div>
              <div className="ov-chart-body">
                <Suspense fallback={<Skeleton h={260} count={1} />}>
                  <StatsChart labels={{ collections: t('repNet'), expenses: t('repExpensesTotal'), title: t('homeMoney') }}
                    points={s.series.map((p) => ({ key: p.key, label: s.bucket === 'day' ? day(p.key) : month(p.key), collections: p.collections_net, expenses: p.expenses }))}
                    format={(v) => money(v, s.currency)} axisFormat={(v) => compact.format(v / 100)} />
                </Suspense>
                <dl className="ov-summary">
                  <div><dt>{t('repInvoiced')}</dt><dd><bdi>{money(s.totals.invoiced, s.currency)}</bdi></dd></div>
                  <div><dt>{t('repNet')}</dt><dd><bdi>{money(s.totals.collections_net, s.currency)}</bdi></dd></div>
                  <div><dt>{t('repExpensesTotal')}</dt><dd><bdi>{money(s.totals.expenses, s.currency)}</bdi></dd></div>
                  <div className="is-total"><dt>{t('ovNetIncome')}</dt><dd><bdi>{money(s.totals.result, s.currency)}</bdi></dd></div>
                  <div><dt>{t('repOwed')}</dt><dd><bdi>{money(s.outstanding.balance, s.currency)}</bdi></dd></div>
                  <div className={s.outstanding.overdue > 0 ? 'is-alert' : undefined}><dt>{t('repOverdue')}</dt><dd><bdi>{money(s.outstanding.overdue, s.currency)}</bdi></dd></div>
                </dl>
              </div>
            </Card>
          </>
        )}
    </section>
  );
}

/** One figure for the period, and how it moved against the period before (nothing shown when that was zero). */
function PeriodCard({ icon, label, cur, prev, show, sub, route }: {
  icon: ReactNode; label: string; cur: number; prev: number; show: (v: number) => string; sub: ReactNode; route: Route;
}) {
  const c = change(cur, prev);
  const pct = c === null ? null : `${Math.abs(Math.round(c * 1000) / 10)}%`;
  return (
    <RouteLink route={route} className="card ov-stat">
      <span className="ov-stat-head"><span className="stat-icon">{icon}</span>{label}</span>
      <span className="ov-stat-value"><bdi>{show(cur)}</bdi></span>
      <span className="ov-stat-sub">
        {pct !== null && c !== null && (
          <span className={`ov-delta ${c > 0 ? 'is-up' : c < 0 ? 'is-down' : ''}`} aria-label={t(c > 0 ? 'ovUpBy' : c < 0 ? 'ovDownBy' : 'ovSame').replace('{p}', pct)}>
            <span aria-hidden>{c > 0 ? '▲' : c < 0 ? '▼' : '='}</span> <bdi>{pct}</bdi>
          </span>
        )}
        {' '}{pct !== null ? t('ovVsLast') : t('ovNoCompare')}
      </span>
      <span className="ov-stat-sub">{sub}</span>
    </RouteLink>
  );
}
