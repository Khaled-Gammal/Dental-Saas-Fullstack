import type { ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import { t, type Key } from '../i18n';
import { money } from '../money';
import { useHome } from '../queries';
import { percent } from '../reports-model';
import { to, type Page } from '../router';
import { Alert, Badge, Card, ErrorText, Skeleton } from '../ui/components';
import { CalendarIcon, CashIcon, ChartIcon, PhoneIcon, ReceiptIcon } from '../ui/icons';
import { RouteLink } from '../ui/page';
import { fmtNumber } from '../util';

const CASH_TONE = { none: 'warning', open: 'primary', closed: 'success' } as const;

/**
 * The home screen's figures per role (SRS REPORT-006). The API sends only the blocks the member's rights cover:
 * reception sees today's appointments, the waiting list, today's collections and the cash box; a doctor their own day,
 * who waits for them and their follow-ups; the owner and the accountant today and the month in money.
 */
export function HomeFigures({ clinicId }: { clinicId: string }) {
  const home = useHome(clinicId);
  if (home.isError) return <Card><ErrorText error={home.error} onRetry={() => void home.refetch()} /></Card>;
  if (!home.data) return <Skeleton h={110} count={2} />;
  const h = home.data;
  const m = (v: number) => money(v, h.currency);
  const n = (v: number) => fmtNumber(v);
  return (
    <div className="home-grid">
      {h.linked_doctor === false && <Alert tone="info">{t('homeNotLinked')}</Alert>}

      {h.appointments && (
        <Block icon={<CalendarIcon />} title={t(h.appointments.scope === 'mine' ? 'homeMyDay' : 'homeTodayAppointments')} link="appointments">
          <Figures items={[
            ['homeWaiting', n(h.appointments.waiting), h.appointments.waiting > 0],
            ['homeInProgress', n(h.appointments.in_progress)],
            ['homeUpcoming', n(h.appointments.upcoming)],
            ['homeCompleted', n(h.appointments.completed)],
            ['status_no_show', n(h.appointments.no_show)],
          ]} />
          <p className="muted small">{t('homeBooked').replace('{n}', n(h.appointments.booked))}</p>
        </Block>
      )}

      {h.follow_ups && (
        <Block icon={<PhoneIcon />} title={t('navFollowUps')} link="followups">
          <p className="home-big"><bdi>{n(h.follow_ups.due)}</bdi></p>
          <p className="muted small">{t(h.follow_ups.due ? 'homeFollowUpsDue' : 'homeFollowUpsNone')}</p>
        </Block>
      )}

      {h.cash && h.cash.length > 0 && (
        <Block icon={<CashIcon />} title={t('homeCash')} link="cash">
          <ul className="line-list">
            {h.cash.map((c) => (
              <li key={c.branch_id}>
                <span><bdi>{arName(c.name_ar, c.name_en)}</bdi></span>
                <Badge tone={CASH_TONE[c.status]}>{t(`homeCash_${c.status}` as Key)}</Badge>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {h.today_money && !h.finance && (
        <Block icon={<ReceiptIcon />} title={t('homeTodayMoney')} link="reports">
          <p className="home-big"><bdi>{m(h.today_money.net)}</bdi></p>
          <p className="muted small">{t('repPaymentsCount').replace('{n}', n(h.today_money.payments))}
            {h.today_money.refunded > 0 && <> · {t('repRefunded')} <bdi>{m(h.today_money.refunded)}</bdi></>}</p>
          {h.today_money.by_method.length > 0 && (
            <ul className="line-list mt-sm">
              {h.today_money.by_method.map((x) => <li key={x.method}><span>{t(`pm_${x.method}` as Key)}</span><bdi>{m(x.net)}</bdi></li>)}
            </ul>
          )}
        </Block>
      )}

      {h.finance && (
        <Block icon={<ChartIcon />} title={t('homeMoney')} link="reports" wide>
          <div className="table-wrap">
            <table className="report-table">
              <thead><tr><th scope="col" /><th scope="col" className="num">{t('preset_today')}</th><th scope="col" className="num">{t('preset_thisMonth')}</th></tr></thead>
              <tbody>
                <tr><th scope="row">{t('repInvoiced')}</th><td className="num">{m(h.finance.today.invoiced)}</td><td className="num">{m(h.finance.month.invoiced)}</td></tr>
                <tr><th scope="row">{t('repNet')}</th><td className="num">{m(h.finance.today.collections_net)}</td><td className="num">{m(h.finance.month.collections_net)}</td></tr>
                <tr><th scope="row">{t('repExpensesTotal')}</th><td className="num">{m(h.finance.today.expenses)}</td><td className="num">{m(h.finance.month.expenses)}</td></tr>
                <tr><th scope="row">{t('status_no_show')}</th>
                  <td className="num">{n(h.finance.today.no_show)} <span className="muted small">({percent(h.finance.today.no_show_rate)})</span></td>
                  <td className="num">{n(h.finance.month.no_show)} <span className="muted small">({percent(h.finance.month.no_show_rate)})</span></td></tr>
              </tbody>
            </table>
          </div>
          <Figures items={[
            ['repOwed', m(h.finance.outstanding.balance)],
            ['repOverdue', m(h.finance.outstanding.overdue), h.finance.outstanding.overdue > 0],
          ]} />
        </Block>
      )}
    </div>
  );
}

function Block({ icon, title, link, wide, children }: { icon: ReactNode; title: string; link: Page; wide?: boolean; children: ReactNode }) {
  return (
    <Card className={`home-block${wide ? ' is-wide' : ''}`}>
      <div className="row-between">
        <h2 className="home-title"><span className="stat-icon">{icon}</span>{title}</h2>
        <RouteLink route={to.list(link)} className="small">{t('homeOpen')}</RouteLink>
      </div>
      {children}
    </Card>
  );
}

/** Small labelled figures; `true` marks one that needs attention. */
function Figures({ items }: { items: [Key, string, boolean?][] }) {
  return (
    <dl className="home-figures">
      {items.map(([k, v, alert]) => <div key={k} className={alert ? 'is-alert' : undefined}><dt>{t(k)}</dt><dd><bdi>{v}</bdi></dd></div>)}
    </dl>
  );
}
