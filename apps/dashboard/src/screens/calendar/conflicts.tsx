import { pickName } from '@dental/ui/text';
import { t, type Lang } from '../../i18n';
import { to } from '../../router';
import type { CalendarConflict } from '../../types';
import { Alert } from '../../ui/components';
import { RouteLink } from '../../ui/page';

const loc = (lang: Lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

/** Bookings a new closed day or time off falls on: nothing was changed; reception follows up (SRS APPT-005). */
export function Conflicts({ lang, items }: { lang: Lang; items: CalendarConflict[] }) {
  if (!items.length) return null;
  const fmt = (iso: string) => new Intl.DateTimeFormat(loc(lang), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' }).format(new Date(iso));
  return (
    <Alert tone="info">
      <strong>{t('conflictsTitle', lang)}</strong>
      <p className="small">{t('conflictsText', lang)}</p>
      <ul className="stack mt-sm">
        {items.map((c) => (
          <li key={c.id}>
            <bdi dir="ltr">{fmt(c.starts_at)}</bdi> · <bdi>{c.patient?.full_name ?? '—'}</bdi>
            {c.patient && <> · <span dir="ltr">{c.patient.phone}</span></>} · <bdi>{pickName(lang, c.doctor.name_ar, c.doctor.name_en)}</bdi>
            {' · '}<RouteLink route={to.edit('appointments', c.id)}>{t('editAppointment', lang)}</RouteLink>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
