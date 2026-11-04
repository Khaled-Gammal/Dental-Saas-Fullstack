'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { clock12 } from '@dental/ui/text';
import { localNow, openStatus, type Holiday, type HourSlot } from '../../lib/hours';
import { DAYS_AR } from '../../lib/site';

/**
 * "Open now / closed now" on a cached page (review R11). Pages are cached (ISR), and the first visitor after a quiet
 * night is served the copy built the evening before ("closed") while a fresh one is made. The status is therefore
 * computed in the browser too: the first render uses the server's moment (`renderedAt`, so hydration matches), then
 * the visitor's own clock takes over and the status refreshes every minute.
 */
function useNow(renderedAt: number): Date {
  const [now, setNow] = useState(() => new Date(renderedAt));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

interface StatusProps { hours: HourSlot[]; holidays: Holiday[]; branchId: string; tz: string; renderedAt: number }

/**
 * A branch's status as a pill: a dot, "open now" or "closed now", and when it closes or opens next. `fallback` is
 * shown instead when the branch publishes no hours (nothing true to say).
 */
export function LiveStatus({ hours, holidays, branchId, tz, renderedAt, className = '', fallback = null }: StatusProps & { className?: string; fallback?: ReactNode }) {
  const now = useNow(renderedAt);
  const s = openStatus(hours, holidays, branchId, tz, now);
  if (s.kind === 'unknown') return <>{fallback}</>;
  const cls = `c-live ${className}`.trim();
  if (s.kind === 'open') {
    return <span className={`${cls} is-open`}><span className="c-live-dot" aria-hidden /><strong>مفتوح الآن</strong><span>· يغلق <bdi>{clock12(s.closesAt)}</bdi></span></span>;
  }
  const today = localNow(tz, now).weekday;
  const when = s.opensWeekday === today ? 'اليوم' : s.opensWeekday === (today + 1) % 7 ? 'غدًا' : s.opensWeekday != null ? DAYS_AR[s.opensWeekday] : null;
  return (
    <span className={`${cls} is-closed`}><span className="c-live-dot" aria-hidden />
      <strong>{s.holiday ? <>مغلق اليوم ({s.holiday})</> : 'مغلق الآن'}</strong>
      {when && s.opensAt && <span>· يفتح {when} <bdi>{clock12(s.opensAt)}</bdi></span>}
    </span>
  );
}
