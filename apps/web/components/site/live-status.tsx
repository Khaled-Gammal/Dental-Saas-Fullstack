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

/** A branch card's pill. */
export function BranchStatus({ hours, holidays, branchId, tz, renderedAt }: StatusProps) {
  const now = useNow(renderedAt);
  const s = openStatus(hours, holidays, branchId, tz, now);
  if (s.kind === 'unknown') return null;
  if (s.kind === 'open') return <span className="s-status is-open"><span className="s-dot" />مفتوح الآن · يغلق <bdi>{clock12(s.closesAt)}</bdi></span>;
  const today = localNow(tz, now).weekday;
  const when = s.opensWeekday === today ? 'اليوم' : s.opensWeekday === (today + 1) % 7 ? 'غدًا' : s.opensWeekday != null ? DAYS_AR[s.opensWeekday] : null;
  return (
    <span className="s-status is-closed"><span className="s-dot" />
      {s.holiday ? <>مغلق اليوم ({s.holiday})</> : 'مغلق الآن'}
      {when && s.opensAt && <> · يفتح {when} <bdi>{clock12(s.opensAt)}</bdi></>}
    </span>
  );
}

/** The hero's floating chip for the main branch; nothing when there is nothing true to say. */
export function HeroStatus({ icon, hours, holidays, branchId, tz, renderedAt }: StatusProps & { icon: ReactNode }) {
  const now = useNow(renderedAt);
  const s = openStatus(hours, holidays, branchId, tz, now);
  const text = s.kind === 'open' ? `مفتوح الآن حتى ${clock12(s.closesAt)}`
    : s.kind === 'closed' && s.opensAt ? `يفتح ${DAYS_AR[s.opensWeekday!]} ${clock12(s.opensAt)}` : null;
  return text ? <span className="s-float s-float-a">{icon}{text}</span> : null;
}
