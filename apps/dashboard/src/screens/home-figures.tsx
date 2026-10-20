import type { ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import { can, type Session } from '../api';
import { t, type Key } from '../i18n';
import { money } from '../money';
import { attentionItems, remainingToday, type AttentionItem } from '../overview-model';
import { useAppointments, useHome, usePendingDiscounts, usePendingExpenses } from '../queries';
import { percent } from '../reports-model';
import { to, type Route } from '../router';
import type { Appointment, AppointmentStatus, HomeData } from '../types';
import { Alert, Badge, Card, ErrorText, Skeleton } from '../ui/components';
import { DataTable, type Column } from '../ui/data-table';
import { CalendarIcon, CashIcon, ChartIcon, EditIcon, PhoneIcon, ReceiptIcon, UsersIcon } from '../ui/icons';
import { RouteLink } from '../ui/page';
import { RowMenu } from '../ui/row-menu';
import { fmtNumber } from '../util';

/** As the appointments page shows each status. */
const STATUS_TONE: Record<AppointmentStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  held: 'neutral', expired: 'neutral', pending: 'warning', confirmed: 'primary', checked_in: 'success', in_progress: 'success', completed: 'neutral', cancelled: 'neutral', no_show: 'neutral',
};

/**
 * The overview's figures, sections and to-dos (SRS REPORT-006; overview redesign 2026-10-21). The API sends only the
 * blocks the member's rights cover (`/reports/home`): reception today's appointments, waiting list, collections and
 * cash box; a doctor their own day and follow-ups; the owner and the accountant today and the month in money. Every
 * figure is the API's; nothing is added up here.
 */
export function HomeFigures({ session }: { session: Session }) {
  const clinicId = session.clinic.id;
  const has = (p: string) => can(session, p);
  const home = useHome(clinicId);
  const h = home.data;
  const mine = h?.appointments?.scope === 'mine';
  // the day's list the appointments page also reads (one cache): only when the API sent the appointments block
  const day = useAppointments(clinicId, h?.today ?? '', undefined, mine, !!h?.appointments);
  const discounts = usePendingDiscounts(clinicId, has('discounts:approve'));
  const expenses = usePendingExpenses(clinicId, has('expenses:approve'));

  if (home.isError) return <Card><ErrorText error={home.error} onRetry={() => void home.refetch()} /></Card>;
  if (!h) return <><div className="ov-stats"><Skeleton h={112} count={4} /></div><Skeleton h={220} count={1} /></>;

  const upcoming = remainingToday(day.data?.appointments ?? []);
  const todo = attentionItems(h, {
    unconfirmed: day.data?.appointments.filter((a) => a.status === 'pending').length,
    discounts: discounts.data?.length,
    expenses: expenses.data?.length,
  });
  const tz = day.data?.timezone ?? 'Africa/Cairo';

  return (
    <>
      {h.linked_doctor === false && <Alert tone="info">{t('homeNotLinked')}</Alert>}
      <Stats h={h} mine={mine} />

      <div className={`ov-main${h.appointments ? '' : ' is-single'}`}>
        {h.appointments && (
          <section className="ov-section" aria-labelledby="ov-upcoming">
            <div className="ov-section-head">
              <div>
                <h2 id="ov-upcoming">{t(mine ? 'ovUpcomingMine' : 'ovUpcoming')}{day.data && <span className="page-count">{fmtNumber(upcoming.total)}</span>}</h2>
                <p className="muted small">{t('ovUpcomingSub')}</p>
              </div>
              <RouteLink route={to.list('appointments')} className="btn btn-secondary btn-sm">{t('ovAllAppointments')}</RouteLink>
            </div>
            <DataTable
              label={t('ovUpcoming')}
              rows={day.data ? upcoming.rows : undefined}
              columns={upcomingColumns(tz, mine)}
              rowKey={(a) => a.id}
              isLoading={day.isLoading}
              isFetching={day.isFetching}
              error={day.isError ? day.error : undefined}
              onRetry={() => void day.refetch()}
              actions={(a) => (
                <RowMenu label={a.patient?.full_name ?? t('time')} actions={[
                  { label: t('rowOpenFile'), icon: <UsersIcon size={16} />, route: a.patient ? to.view('patients', a.patient.id) : undefined, hidden: !a.patient || !has('patients:read') },
                  { label: t('openVisit'), icon: <ReceiptIcon size={16} />, route: a.visit_id ? to.visit(a.visit_id) : undefined, hidden: !a.visit_id || !(has('clinical:read') || has('clinical:write')) },
                  { label: t('editAppointment'), icon: <EditIcon size={16} />, route: to.edit('appointments', a.id), hidden: !has('appointments:write') },
                ]} />
              )}
              empty={{ icon: <CalendarIcon size={28} />, title: t('ovNoUpcoming'), text: t('ovNoUpcomingText') }}
              footer={upcoming.total > upcoming.rows.length && (
                <RouteLink route={to.list('appointments')} className="small">{t('ovMoreAppointments').replace('{n}', fmtNumber(upcoming.total - upcoming.rows.length))}</RouteLink>
              )}
            />
          </section>
        )}
        <Attention items={todo} />
      </div>

      {h.finance && <Finance h={h} />}
    </>
  );
}

/** Up to four headline figures, the ones the member's blocks hold, each opening its page. */
function Stats({ h, mine }: { h: HomeData; mine: boolean }) {
  const m = (v: number) => money(v, h.currency);
  const n = (v: number) => fmtNumber(v);
  const cards: { key: string; icon: ReactNode; label: string; value: string; sub: ReactNode; route: Route; alert?: boolean }[] = [];
  if (h.appointments) {
    cards.push({
      key: 'appointments', icon: <CalendarIcon size={18} />, label: t(mine ? 'homeMyDay' : 'homeTodayAppointments'), value: n(h.appointments.booked), route: to.list('appointments'),
      sub: t('ovApptSub').replace('{w}', n(h.appointments.waiting)).replace('{p}', n(h.appointments.in_progress)).replace('{u}', n(h.appointments.upcoming)),
    });
  }
  if (h.finance) {
    cards.push({ key: 'today', icon: <ReceiptIcon size={18} />, label: t('ovTodayNet'), value: m(h.finance.today.collections_net), route: to.list('reports'),
      sub: <>{t('repInvoiced')} <bdi>{m(h.finance.today.invoiced)}</bdi></> });
    cards.push({ key: 'month', icon: <ChartIcon size={18} />, label: t('ovMonthNet'), value: m(h.finance.month.collections_net), route: to.list('reports'),
      sub: <>{t('repInvoiced')} <bdi>{m(h.finance.month.invoiced)}</bdi></> });
    cards.push({ key: 'owed', icon: <CashIcon size={18} />, label: t('repOwed'), value: m(h.finance.outstanding.balance), route: { page: 'invoices', query: { status: 'open' } },
      sub: <>{t('repOverdue')} <bdi>{m(h.finance.outstanding.overdue)}</bdi></>, alert: h.finance.outstanding.overdue > 0 });
  } else if (h.today_money) {
    cards.push({ key: 'today', icon: <ReceiptIcon size={18} />, label: t('ovTodayNet'), value: m(h.today_money.net), route: to.list('reports'),
      sub: t('repPaymentsCount').replace('{n}', n(h.today_money.payments)) });
  }
  if (h.follow_ups && cards.length < 4) {
    cards.push({ key: 'followups', icon: <PhoneIcon size={18} />, label: t('navFollowUps'), value: n(h.follow_ups.due), route: to.list('followups'),
      sub: t(h.follow_ups.due ? 'homeFollowUpsDue' : 'homeFollowUpsNone') });
  }
  if (!cards.length) return null;
  return (
    <div className="ov-stats">
      {cards.map((c) => (
        <RouteLink key={c.key} route={c.route} className={`card ov-stat${c.alert ? ' is-alert' : ''}`}>
          <span className="ov-stat-head"><span className="stat-icon">{c.icon}</span>{c.label}</span>
          <span className="ov-stat-value"><bdi>{c.value}</bdi></span>
          <span className="ov-stat-sub">{c.sub}</span>
        </RouteLink>
      ))}
    </div>
  );
}

/** The day's remaining appointments (time, patient, doctor, service, status). */
function upcomingColumns(tz: string, mine: boolean): Column<Appointment>[] {
  const time = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
  return [
    { id: 'time', header: t('time'), sortValue: (a) => a.starts_at, cell: (a) => <strong className="whitespace-nowrap">{time(a.starts_at)}</strong> },
    {
      id: 'patient', header: t('patientColName'), sortValue: (a) => a.patient?.full_name ?? '',
      cell: (a) => (a.patient ? <><bdi className="font-semibold">{a.patient.full_name}</bdi><bdi dir="ltr" className="muted small block tabular-nums">{a.patient.phone}</bdi></> : <span className="muted">—</span>),
    },
    ...(mine ? [] : [{ id: 'doctor', header: t('doctor'), hideOnMobile: true, cell: (a: Appointment) => <bdi>{arName(a.doctor.name_ar, a.doctor.name_en, '—')}</bdi> }]),
    { id: 'service', header: t('service'), hideOnMobile: true, cell: (a) => (a.service ? <bdi>{arName(a.service.name_ar, a.service.name_en, '—')}</bdi> : <span className="muted">—</span>) },
    { id: 'status', header: t('status'), cell: (a) => <Badge tone={STATUS_TONE[a.status]} dot>{t(`status_${a.status}` as Key)}</Badge> },
  ];
}

const ATTENTION: Record<AttentionItem['key'], { text: Key; route: Route }> = {
  waiting: { text: 'ovWaiting', route: { page: 'appointments', query: { view: 'waiting' } } },
  unconfirmed: { text: 'ovUnconfirmed', route: { page: 'appointments' } },
  followUps: { text: 'ovFollowUps', route: { page: 'followups' } },
  overdue: { text: 'ovOverdue', route: { page: 'invoices', query: { status: 'overdue' } } },
  discounts: { text: 'ovDiscounts', route: { page: 'discounts' } },
  expenses: { text: 'ovExpenses', route: { page: 'expenses' } },
  cash: { text: 'ovCashClosed', route: { page: 'cash' } },
};

/** What is waiting for someone, each opening the page that deals with it. */
function Attention({ items }: { items: AttentionItem[] }) {
  return (
    <Card className="ov-attention">
      <h2>{t('ovAttention')}</h2>
      {items.length === 0 ? <p className="muted small mt-sm">{t('ovAttentionNone')}</p> : (
        <ul>
          {items.map((i) => (
            <li key={i.key + (i.branch?.name_ar ?? '')}>
              <RouteLink route={ATTENTION[i.key].route} className="ov-attention-item">
                <span className="ov-attention-n"><bdi>{i.key === 'cash' ? '!' : fmtNumber(i.n)}</bdi></span>
                <span>{t(ATTENTION[i.key].text).replace('{branch}', i.branch ? arName(i.branch.name_ar, i.branch.name_en) : '')}</span>
              </RouteLink>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Today and this month in money, as the reports compute them (what patients owe is in the figures above). */
function Finance({ h }: { h: HomeData }) {
  const f = h.finance!;
  const m = (v: number) => money(v, h.currency);
  const n = (v: number) => fmtNumber(v);
  return (
    <Card>
      <div className="ov-section-head">
        <div>
          <h2>{t('homeMoney')}</h2>
          <p className="muted small">{t('ovFinanceSub')}</p>
        </div>
        <RouteLink route={to.list('reports')} className="btn btn-secondary btn-sm">{t('navReports')}</RouteLink>
      </div>
      <div className="table-wrap mt-sm">
        <table className="report-table">
          <thead><tr><th scope="col" /><th scope="col" className="num">{t('preset_today')}</th><th scope="col" className="num">{t('preset_thisMonth')}</th></tr></thead>
          <tbody>
            <tr><th scope="row">{t('repInvoiced')}</th><td className="num">{m(f.today.invoiced)}</td><td className="num">{m(f.month.invoiced)}</td></tr>
            <tr><th scope="row">{t('repNet')}</th><td className="num">{m(f.today.collections_net)}</td><td className="num">{m(f.month.collections_net)}</td></tr>
            <tr><th scope="row">{t('repExpensesTotal')}</th><td className="num">{m(f.today.expenses)}</td><td className="num">{m(f.month.expenses)}</td></tr>
            <tr><th scope="row">{t('status_no_show')}</th>
              <td className="num">{n(f.today.no_show)} <span className="muted small">({percent(f.today.no_show_rate)})</span></td>
              <td className="num">{n(f.month.no_show)} <span className="muted small">({percent(f.month.no_show_rate)})</span></td></tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
