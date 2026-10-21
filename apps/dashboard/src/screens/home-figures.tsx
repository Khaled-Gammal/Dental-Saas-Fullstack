import type { ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import { can, type Session } from '../api';
import { appointmentStatusLabel } from '../labels';
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
import { KpiCard, StatsKpis, StatsTrend, type StatsFilters } from './overview-stats';
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
export function HomeFigures({ session, filters }: { session: Session; filters: StatsFilters | null }) {
  const clinicId = session.clinic.id;
  const has = (p: string) => can(session, p);
  const home = useHome(clinicId);
  const h = home.data;
  const mine = h?.appointments?.scope === 'mine';
  // the day's list the appointments page also reads (one cache): only when the API sent the appointments block
  const day = useAppointments(clinicId, h?.today ?? '', undefined, mine, !!h?.appointments);
  const discounts = usePendingDiscounts(clinicId, has('discounts:approve'));
  const stats = has('reports:read') && !!filters; // GET /reports/stats is theirs (owner and accountant)
  const expenses = usePendingExpenses(clinicId, has('expenses:approve'));

  if (home.isError) return <Card><ErrorText error={home.error} onRetry={() => void home.refetch()} /></Card>;
  if (!h) return <><div className="ov-stats"><Skeleton h={150} count={4} /></div><Skeleton h={300} count={1} /></>;

  const upcoming = remainingToday(day.data?.appointments ?? [], 500); // all of them: the table pages them
  const todo = attentionItems(h, {
    unconfirmed: day.data?.appointments.filter((a) => a.status === 'pending').length,
    discounts: discounts.data?.length,
    expenses: expenses.data?.length,
  });
  const tz = day.data?.timezone ?? 'Africa/Cairo';

  return (
    <>
      {h.linked_doctor === false && <Alert tone="info">حسابك غير مرتبط بطبيب، لذلك لا يظهر يومك هنا. اطلب من صاحب العيادة ربطه من صفحة الأطباء.</Alert>}
      <AttentionStrip items={todo} />
      {/* owner and accountant: the period's figures and the one chart (statistics, 2026-10-21); everyone else: today's */}
      {stats ? <StatsKpis clinicId={clinicId} filters={filters} /> : <Stats h={h} mine={mine} />}
      {stats && <StatsTrend clinicId={clinicId} filters={filters} />}

      {h.appointments && (
        <Card className="ov-table-card">
          <div className="ov-table-head">
            <div>
              <h2 id="ov-upcoming">{mine ? 'مواعيدي المتبقية اليوم' : 'مواعيد اليوم المتبقية'}{day.data && <span className="page-count">{fmtNumber(upcoming.total)}</span>}</h2>
              <p className="muted small">من في العيادة الآن ومن لم يحن موعده، بالترتيب.</p>
            </div>
            <RouteLink route={to.list('appointments')} className="btn btn-secondary btn-sm">كل المواعيد</RouteLink>
          </div>
          <DataTable
            label="مواعيد اليوم المتبقية"
            rows={day.data ? upcoming.rows : undefined}
            columns={upcomingColumns(tz, mine)}
            rowKey={(a) => a.id}
            isLoading={day.isLoading}
            isFetching={day.isFetching}
            error={day.isError ? day.error : undefined}
            onRetry={() => void day.refetch()}
            pageSize={6}
            actions={(a) => (
              <RowMenu label={a.patient?.full_name ?? 'الوقت'} actions={[
                { label: 'ملف المريض', icon: <UsersIcon size={16} />, route: a.patient ? to.view('patients', a.patient.id) : undefined, hidden: !a.patient || !has('patients:read') },
                { label: 'فتح الزيارة', icon: <ReceiptIcon size={16} />, route: a.visit_id ? to.visit(a.visit_id) : undefined, hidden: !a.visit_id || !(has('clinical:read') || has('clinical:write')) },
                { label: 'تغيير', icon: <EditIcon size={16} />, route: to.edit('appointments', a.id), hidden: !has('appointments:write') },
              ]} />
            )}
            empty={{ icon: <CalendarIcon size={28} />, title: 'لا مواعيد متبقية اليوم.', text: 'المواعيد الجديدة تظهر هنا فور حجزها.' }}
          />
        </Card>
      )}

      {!stats && h.finance && <Finance h={h} />}
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
      key: 'appointments', icon: <CalendarIcon size={16} />, label: mine ? 'يومي' : 'مواعيد اليوم', value: n(h.appointments.booked), route: to.list('appointments'),
      sub: 'في الانتظار {w} · مع الطبيب {p} · لم يحن {u}'.replace('{w}', n(h.appointments.waiting)).replace('{p}', n(h.appointments.in_progress)).replace('{u}', n(h.appointments.upcoming)),
    });
  }
  if (h.finance) {
    cards.push({ key: 'today', icon: <ReceiptIcon size={16} />, label: 'صافي تحصيل اليوم', value: m(h.finance.today.collections_net), route: to.list('reports'),
      sub: <>الفواتير الصادرة <bdi>{m(h.finance.today.invoiced)}</bdi></> });
    cards.push({ key: 'month', icon: <ChartIcon size={16} />, label: 'صافي تحصيل الشهر', value: m(h.finance.month.collections_net), route: to.list('reports'),
      sub: <>الفواتير الصادرة <bdi>{m(h.finance.month.invoiced)}</bdi></> });
    cards.push({ key: 'owed', icon: <CashIcon size={16} />, label: 'إجمالي المستحق على المرضى', value: m(h.finance.outstanding.balance), route: { page: 'invoices', query: { status: 'open' } },
      sub: <>أقساط متأخرة <bdi>{m(h.finance.outstanding.overdue)}</bdi></>, alert: h.finance.outstanding.overdue > 0 });
  } else if (h.today_money) {
    cards.push({ key: 'today', icon: <ReceiptIcon size={16} />, label: 'صافي تحصيل اليوم', value: m(h.today_money.net), route: to.list('reports'),
      sub: '{n} دفعة'.replace('{n}', n(h.today_money.payments)) });
  }
  if (h.follow_ups && cards.length < 4) {
    cards.push({ key: 'followups', icon: <PhoneIcon size={16} />, label: 'المتابعات', value: n(h.follow_ups.due), route: to.list('followups'),
      sub: h.follow_ups.due ? 'متابعات حان موعدها؛ اتصل بالمرضى أو احجز لهم.' : 'لا متابعات مستحقة اليوم.' });
  }
  if (!cards.length) return null;
  return (
    <div className="ov-stats">
      {cards.map((c) => <KpiCard key={c.key} icon={c.icon} label={c.label} value={c.value} route={c.route} foot={c.sub} alert={c.alert} />)}
    </div>
  );
}

/** The day's remaining appointments (time, patient, doctor, service, status). */
function upcomingColumns(tz: string, mine: boolean): Column<Appointment>[] {
  const time = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
  return [
    { id: 'time', header: 'الوقت', sortValue: (a) => a.starts_at, cell: (a) => <strong className="whitespace-nowrap">{time(a.starts_at)}</strong> },
    {
      id: 'patient', header: 'المريض', sortValue: (a) => a.patient?.full_name ?? '',
      cell: (a) => (a.patient ? <><bdi className="font-semibold">{a.patient.full_name}</bdi><bdi dir="ltr" className="muted small block tabular-nums">{a.patient.phone}</bdi></> : <span className="muted">—</span>),
    },
    ...(mine ? [] : [{ id: 'doctor', header: 'الطبيب', hideOnMobile: true, cell: (a: Appointment) => <bdi>{arName(a.doctor.name_ar, a.doctor.name_en, '—')}</bdi> }]),
    { id: 'service', header: 'الخدمة', hideOnMobile: true, cell: (a) => (a.service ? <bdi>{arName(a.service.name_ar, a.service.name_en, '—')}</bdi> : <span className="muted">—</span>) },
    { id: 'status', header: 'الحالة', cell: (a) => <Badge tone={STATUS_TONE[a.status]} dot>{appointmentStatusLabel[a.status]}</Badge> },
  ];
}

const ATTENTION: Record<AttentionItem['key'], { text: string; route: Route }> = {
  waiting: { text: 'مرضى في الانتظار', route: { page: 'appointments', query: { view: 'waiting' } } },
  unconfirmed: { text: 'حجوزات بانتظار التأكيد', route: { page: 'appointments' } },
  followUps: { text: 'متابعات حان موعدها', route: { page: 'followups' } },
  overdue: { text: 'أقساط متأخرة', route: { page: 'invoices', query: { status: 'overdue' } } },
  discounts: { text: 'خصومات بانتظار موافقتك', route: { page: 'discounts' } },
  expenses: { text: 'مصروفات بانتظار موافقتك', route: { page: 'expenses' } },
  cash: { text: 'خزائن لم تُفتح اليوم: {branch}', route: { page: 'cash' } },
};

/** What is waiting for someone: one quiet line of links under the header, each opening its page (none: no line). */
function AttentionStrip({ items }: { items: AttentionItem[] }) {
  if (!items.length) return null;
  return (
    <nav className="ov-attention-strip" aria-label="يحتاج انتباهك">
      <span className="ov-attention-title">يحتاج انتباهك</span>
      {items.map((i) => (
        <RouteLink key={i.key} route={ATTENTION[i.key].route} className="ov-attention-link">
          <span className="ov-attention-n"><bdi>{fmtNumber(i.n)}</bdi></span>
          {ATTENTION[i.key].text.replace('{branch}', (i.branches ?? []).map((b) => arName(b.name_ar, b.name_en)).join('، '))}
        </RouteLink>
      ))}
    </nav>
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
          <h2>الإيرادات والمصروفات</h2>
          <p className="muted small">اليوم وهذا الشهر، بالأرقام نفسها التي تحسبها التقارير.</p>
        </div>
        <RouteLink route={to.list('reports')} className="btn btn-secondary btn-sm">التقارير</RouteLink>
      </div>
      <div className="table-wrap mt-sm">
        <table className="report-table">
          <thead><tr><th scope="col" /><th scope="col" className="num">اليوم</th><th scope="col" className="num">هذا الشهر</th></tr></thead>
          <tbody>
            <tr><th scope="row">الفواتير الصادرة</th><td className="num">{m(f.today.invoiced)}</td><td className="num">{m(f.month.invoiced)}</td></tr>
            <tr><th scope="row">صافي التحصيل</th><td className="num">{m(f.today.collections_net)}</td><td className="num">{m(f.month.collections_net)}</td></tr>
            <tr><th scope="row">إجمالي المصروفات</th><td className="num">{m(f.today.expenses)}</td><td className="num">{m(f.month.expenses)}</td></tr>
            <tr><th scope="row">لم يحضر</th>
              <td className="num">{n(f.today.no_show)} <span className="muted small">({percent(f.today.no_show_rate)})</span></td>
              <td className="num">{n(f.month.no_show)} <span className="muted small">({percent(f.month.no_show_rate)})</span></td></tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
