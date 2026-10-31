import { arName } from '@dental/ui/text';
import { to } from '../../router';
import type { CalendarConflict } from '../../types';
import { Alert } from '../../ui/components';
import { RouteLink } from '../../ui/page';
import { clinicTimeZone, LOC } from '../../util';


/** Bookings a new closed day or time off falls on: nothing was changed; reception follows up (SRS APPT-005). */
export function Conflicts({ items }: { items: CalendarConflict[] }) {
  if (!items.length) return null;
  const fmt = (iso: string) => new Intl.DateTimeFormat(LOC, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: clinicTimeZone() }).format(new Date(iso));
  return (
    <Alert tone="info">
      <strong>مواعيد محجوزة في هذا الوقت</strong>
      <p className="small">لم يُلغَ أي موعد. تواصل مع المرضى ثم غيّر مواعيدهم أو ألغها من صفحة المواعيد.</p>
      <ul className="stack mt-sm">
        {items.map((c) => (
          <li key={c.id}>
            <bdi dir="ltr">{fmt(c.starts_at)}</bdi> · <bdi>{c.patient?.full_name ?? '—'}</bdi>
            {c.patient && <> · <span dir="ltr">{c.patient.phone}</span></>} · <bdi>{arName(c.doctor.name_ar, c.doctor.name_en)}</bdi>
            {' · '}<RouteLink route={to.edit('appointments', c.id)}>تغيير</RouteLink>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
