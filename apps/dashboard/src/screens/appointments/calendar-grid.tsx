import type { CSSProperties } from 'react';
import { gridRange, layoutLanes, offHours, RELEASED, spanOf, type GridColumn, type Span } from '../../calendar-model';
import { appointmentStatusLabel } from '../../labels';
import type { Appointment } from '../../types';
import { fmtNumber, LOC } from '../../util';

/** Pixels per minute: an hour is 64 px, a 15-minute booking 16 px (its text still fits one line). */
const PX = 64 / 60;
const MIN_BLOCK = 22;

/**
 * Phase 1C (DSH-02): the calendar as a time grid. One column per doctor or chair (a day) or per day (the week), the
 * hours down the side, each booking a block at its time, coloured by status, side by side when they overlap. Outside a
 * doctor's working hours the column is shaded. A block opens the booking (`onOpen`), with the same actions as the list.
 * Right to left: the hours are on the right and the first column next to them.
 */
export function CalendarGrid({ columns, timeZone, time, today, now, onOpen, onColumn, subtitle }: {
  columns: GridColumn[];
  timeZone: string;
  /** "5:30 م" in the clinic's zone */
  time: (iso: string) => string;
  today: string;
  /** now, in minutes since midnight in the clinic's zone: the red line on today's column */
  now: number;
  onOpen: (a: Appointment) => void;
  /** a column header that leads somewhere (the week: that day's list) */
  onColumn?: (c: GridColumn) => void;
  /** what a block shows under the patient's name: the doctor (week, chairs) or the service (a doctor's column) */
  subtitle: (a: Appointment) => string | null;
}) {
  const placed = columns.map((c) => ({
    column: c,
    blocks: layoutLanes(c.appointments.map((a) => ({ appointment: a, ...spanOf(a, timeZone) })), MIN_BLOCK / PX),
  }));
  const spans: Span[] = placed.flatMap((p) => [...p.blocks, ...(p.column.working ?? [])]);
  const range = gridRange(spans);
  const hours = Array.from({ length: (range.end - range.start) / 60 }, (_, i) => range.start + i * 60);
  const height = (range.end - range.start) * PX;
  const y = (minutes: number) => (Math.min(Math.max(minutes, range.start), range.end) - range.start) * PX;
  const label = (m: number) => new Intl.DateTimeFormat(LOC, { hour: 'numeric', hour12: true, timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60) % 24)));

  return (
    <div className="cal" style={{ '--cal-cols': columns.length } as CSSProperties}>
      <div className="cal-scroll">
        <div className="cal-head">
          <div className="cal-corner" />
          {columns.map((c) => {
            const n = c.appointments.filter((a) => !RELEASED.includes(a.status)).length;
            const inner = <><span className="cal-col-title"><bdi>{c.title}</bdi></span>{n > 0 && <span className="cal-col-count">{fmtNumber(n)}</span>}</>;
            return onColumn
              ? <button key={c.key} type="button" className={`cal-col-head${c.date === today ? ' is-today' : ''}`} onClick={() => onColumn(c)}>{inner}</button>
              : <div key={c.key} className={`cal-col-head${c.date === today ? ' is-today' : ''}`}>{inner}</div>;
          })}
        </div>
        <div className="cal-body" style={{ height }}>
          <div className="cal-hours" aria-hidden>
            {hours.map((h) => <span key={h} style={{ top: y(h) }}><bdi dir="ltr">{label(h)}</bdi></span>)}
          </div>
          {placed.map(({ column, blocks }) => (
            <div key={column.key} className="cal-col" role="list" aria-label={column.title} style={{ backgroundSize: `100% ${60 * PX}px`, backgroundPositionY: `${-(range.start % 60) * PX}px` }}>
              {column.working && offHours(column.working, range).map((s) => (
                <div key={`${s.start}`} className="cal-off" style={{ top: y(s.start), height: y(s.end) - y(s.start) }} aria-hidden />
              ))}
              {column.date === today && now >= range.start && now <= range.end && <div className="cal-now" style={{ top: y(now) }} aria-hidden />}
              {blocks.map(({ appointment: a, start, end, lane, lanes }) => {
                const sub = subtitle(a);
                return (
                  <div key={a.id} role="listitem" className="cal-slot"
                    style={{ top: y(start), height: Math.max(y(end) - y(start), MIN_BLOCK), insetInlineStart: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}>
                    <button type="button" className={`cal-block is-${a.status}`} onClick={() => onOpen(a)}>
                      <span className="cal-block-time"><bdi dir="ltr">{time(a.starts_at)}</bdi></span>
                      <span className="cal-block-name"><bdi>{a.patient?.full_name ?? '—'}</bdi></span>
                      {sub && <span className="cal-block-sub"><bdi>{sub}</bdi></span>}
                      <span className="sr-only">{appointmentStatusLabel[a.status]}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

