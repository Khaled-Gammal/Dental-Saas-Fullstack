import { lazy, Suspense, type ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import { Choice } from '../components/choice';
import { csvFileName, downloadCsv, pounds, toCsv } from '../csv';
import { periodPresetLabel } from '../labels';
import { money } from '../money';
import { change } from '../overview-model';
import { useReport, useReportBranches } from '../queries';
import { PRESETS, presetPeriod, type Preset } from '../reports-model';
import { to, type Route } from '../router';
import type { StatsReport } from '../types';
import { Button, Card, ErrorText, Skeleton } from '../ui/components';
import { CalendarIcon, ChartIcon, ReceiptIcon, UsersIcon } from '../ui/icons';
import { RouteLink } from '../ui/page';
import { fmtNumber } from '../util';

// shadcn/ui charts (recharts) load on demand: only the owner and the accountant see them
const MoneyTrend = lazy(() => import('./overview-chart').then((m) => ({ default: m.MoneyTrend })));
const Sparkline = lazy(() => import('./overview-chart').then((m) => ({ default: m.Sparkline })));

const dayLabel = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const monthLabel = (ym: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'short', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
const compact = new Intl.NumberFormat('ar-EG-u-nu-latn', { notation: 'compact', maximumFractionDigits: 1 });

/** The overview's period and branch (owner and accountant). Held by the page: the header holds the controls. */
export interface StatsFilters { preset: Preset; branchId: string; today: string }
const query = (f: StatsFilters) => ({ ...presetPeriod(f.preset, f.today), branchId: f.branchId || undefined });

/**
 * The header's actions (after the Untitled UI reference: "Select date" and "Export"): the period (the reports page's
 * presets), the branch when there is more than one, and the period's figures as a CSV file.
 */
export function StatsControls({ clinicId, value, onChange }: { clinicId: string; value: StatsFilters; onChange: (f: StatsFilters) => void }) {
  const branches = useReportBranches(clinicId).data ?? [];
  const stats = useReport<StatsReport>(clinicId, 'stats', query(value)).data; // the figures' own request (one cache)
  const exportCsv = () => {
    if (!stats) return;
    const head = [stats.bucket === 'day' ? 'التاريخ' : 'الشهر', 'الفواتير الصادرة', 'صافي التحصيل', 'إجمالي المصروفات', 'صافي الدخل', 'مرضى جدد'];
    const rows = stats.series.map((p) => [p.key, pounds(p.invoiced), pounds(p.collections_net), pounds(p.expenses), pounds(p.result), p.new_patients]);
    const foot = ['الإجمالي', pounds(stats.totals.invoiced), pounds(stats.totals.collections_net), pounds(stats.totals.expenses), pounds(stats.totals.result), stats.totals.new_patients];
    downloadCsv(csvFileName('stats', stats.period?.from, stats.period?.to), toCsv(head, rows, foot));
  };
  return (
    <div className="ov-toolbar">
      <Choice value={value.preset} onChange={(v) => onChange({ ...value, preset: v as Preset })} label="الفترة" className="h-10 w-40 bg-card"
        options={PRESETS.map((p) => ({ value: p, label: periodPresetLabel[p] }))} />
      {branches.length > 1 && (
        <Choice value={value.branchId} onChange={(branchId) => onChange({ ...value, branchId })} label="الفرع" noneLabel="كل الفروع" className="h-10 w-44 bg-card"
          options={branches.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en) }))} />
      )}
      <Button variant="secondary" onClick={exportCsv} disabled={!stats}>تصدير</Button>
    </div>
  );
}

/** The period's four figures against the period before (GET /reports/stats); only the ▲/▼ percentage is worked out here. */
export function StatsKpis({ clinicId, filters }: { clinicId: string; filters: StatsFilters }) {
  const stats = useReport<StatsReport>(clinicId, 'stats', query(filters));
  const s = stats.data;
  if (stats.isError) return <Card><ErrorText error={stats.error} onRetry={() => void stats.refetch()} /></Card>;
  if (!s) return <div className="ov-stats"><Skeleton h={150} count={4} /></div>;
  const m = (v: number) => money(v, s.currency);
  const a = s.totals.appointments;
  return (
    <div className="ov-stats" aria-busy={stats.isFetching || undefined}>
      <KpiCard icon={<ReceiptIcon size={16} />} label="صافي التحصيل" value={m(s.totals.collections_net)} route={to.list('reports')}
        delta={{ cur: s.totals.collections_net, prev: s.previous.collections_net }} spark={{ values: s.series.map((p) => p.collections_net), color: 'var(--chart-1)' }} />
      <KpiCard icon={<ChartIcon size={16} />} label="صافي الدخل" value={m(s.totals.result)} negative={s.totals.result < 0} route={{ page: 'reports', query: { tab: 'expenses' } }}
        delta={{ cur: s.totals.result, prev: s.previous.result }} spark={{ values: s.series.map((p) => p.result), color: 'var(--chart-3)' }} />
      <KpiCard icon={<UsersIcon size={16} />} label="مرضى جدد" value={fmtNumber(s.totals.new_patients)} route={to.list('patients')}
        delta={{ cur: s.totals.new_patients, prev: s.previous.new_patients }} spark={{ values: s.series.map((p) => p.new_patients), color: 'var(--chart-5)' }} />
      <KpiCard icon={<CalendarIcon size={16} />} label="المواعيد" value={fmtNumber(a.booked)} route={{ page: 'reports', query: { tab: 'attendance' } }}
        delta={{ cur: a.booked, prev: s.previous.appointments.booked }}
        foot={'حضر {a} · لم يحضر {n}'.replace('{a}', fmtNumber(a.attended)).replace('{n}', fmtNumber(a.no_show))} />
    </div>
  );
}

/** The one chart: net collections and expenses over the period, per day or month as the API groups them. */
export function StatsTrend({ clinicId, filters }: { clinicId: string; filters: StatsFilters }) {
  const s = useReport<StatsReport>(clinicId, 'stats', query(filters)).data; // the same request (one cache)
  if (!s) return null; // the cards above show the loading and the error
  const m = (v: number) => money(v, s.currency);
  return (
    <Card className="ov-card">
      <div className="ov-section-head">
        <div>
          <h2>الإيرادات والمصروفات</h2>
          <p className="muted small">صافي التحصيل والمصروفات على مدار الفترة.</p>
        </div>
        <RouteLink route={to.list('reports')} className="btn btn-secondary btn-sm">التقارير</RouteLink>
      </div>
      <Suspense fallback={<Skeleton h={300} count={1} />}>
        <MoneyTrend labels={{ collections: 'صافي التحصيل', expenses: 'إجمالي المصروفات', title: 'الإيرادات والمصروفات' }}
          points={s.series.map((p) => ({ key: p.key, label: s.bucket === 'day' ? dayLabel(p.key) : monthLabel(p.key), collections: p.collections_net, expenses: p.expenses }))}
          format={m} axisFormat={(v) => compact.format(v / 100)} />
      </Suspense>
    </Card>
  );
}

/**
 * One figure card, as in the reference: icon and label, the value on its own line, then how it moved (▲/▼ against the
 * period before) beside its trend. Without a comparison or a trend (reception's today figures) the bottom line is a
 * short note. The card opens the figure's page.
 */
export function KpiCard({ icon, label, value, route, delta, spark, foot, negative, alert }: {
  icon: ReactNode; label: string; value: string; route: Route;
  delta?: { cur: number; prev: number }; spark?: { values: number[]; color: string }; foot?: ReactNode; negative?: boolean; alert?: boolean;
}) {
  const c = delta ? change(delta.cur, delta.prev) : undefined;
  const pct = c === null || c === undefined ? null : `${Math.abs(Math.round(c * 1000) / 10)}%`;
  return (
    <RouteLink route={route} className={`card ov-kpi${alert ? ' is-alert' : ''}`}>
      <span className="ov-kpi-label"><span className="ov-kpi-icon" aria-hidden>{icon}</span>{label}</span>
      <span className={`ov-kpi-value${negative ? ' is-negative' : ''}`}><bdi>{value}</bdi></span>
      <span className="ov-kpi-bottom">
        <span className="ov-kpi-delta">
          {c !== undefined && (c === null
            ? <span className="ov-delta" title="لا شيء في الفترة السابقة للمقارنة">—</span>
            : (
              <span className={`ov-delta${c > 0 ? ' is-up' : c < 0 ? ' is-down' : ''}`} aria-label={c > 0 ? 'ارتفع {p}' : c < 0 ? 'انخفض {p}' : 'لم يتغير'.replace('{p}', pct ?? '')}>
                <span aria-hidden>{c > 0 ? '↑' : c < 0 ? '↓' : '='}</span><bdi>{pct}</bdi>
              </span>
            ))}
          {c !== undefined && <span className="muted small">{c === null ? 'لا مقارنة' : 'عن الفترة السابقة'}</span>}
          {foot && <span className="muted small ov-kpi-foot">{foot}</span>}
        </span>
        {spark && spark.values.length > 1 && (
          <span className="ov-kpi-spark"><Suspense fallback={null}><Sparkline values={spark.values} color={spark.color} /></Suspense></span>
        )}
      </span>
    </RouteLink>
  );
}
