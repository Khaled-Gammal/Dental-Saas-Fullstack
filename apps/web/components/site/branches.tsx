import { telHref } from '@dental/ui/text';
import { Chat, Clock, Icon, Phone, Pin } from '../icons';
import { imageProps } from '../../lib/media';
import { ar, DAYS_AR, DEFAULT_TZ, mapsHref, WEEK_ORDER, whatsappHref, type SiteBranch } from '../../lib/site';
import { clock12 } from '@dental/ui/text';
import { groupWeek, localNow, type Holiday, type HourSlot } from '../../lib/hours';
import { BranchStatus } from './live-status';
import type { Contact } from './contact';
import { Section } from './decor';

const Slots = ({ slots }: { slots: HourSlot[] }) =>
  slots.length
    ? <span className="s-slots">{slots.map((h) => <bdi key={h.opens_at}>{clock12(h.opens_at)}–{clock12(h.closes_at)}</bdi>)}</span>
    : <span className="s-closed">مغلق</span>;

const dayRange = (days: number[]) => (days.length === 1 ? DAYS_AR[days[0]] : `${DAYS_AR[days[0]]} – ${DAYS_AR[days[days.length - 1]]}`);

export function BranchCard({ branch, holidays, clinicTz, contact, clinicName }: { branch: SiteBranch; holidays: Holiday[]; clinicTz: string; contact: Contact; clinicName: string }) {
  const name = ar(branch.name_ar, branch.name_en) ?? '';
  const address = ar(branch.address_ar, branch.address_en);
  const tz = branch.timezone ?? clinicTz ?? DEFAULT_TZ;
  const today = localNow(tz).weekday;
  const todaySlots = branch.hours.filter((h) => h.weekday === today);
  const phone = branch.phone ?? contact.phone;
  const tel = telHref(phone);
  const wa = whatsappHref(branch.whatsapp, `مرحبًا، أود حجز موعد في فرع ${name} – ${clinicName}.`);
  const maps = mapsHref(branch.latitude, branch.longitude);
  const week = groupWeek(branch.hours, WEEK_ORDER);
  return (
    <article className={`s-card s-branch${branch.photo ? ' has-media' : ''}`} data-reveal>
      {branch.photo && <img className="s-card-media" {...imageProps(branch.photo, 640)} sizes="(max-width: 640px) 100vw, 480px" alt="" loading="lazy" decoding="async" />}
      <div className="s-branch-head">
        <span className="s-service-icon"><Pin size={24} /></span>
        <div className="s-branch-titles">
          <h3><bdi>{name}</bdi>{branch.is_main && <span className="s-badge">الفرع الرئيسي</span>}</h3>
          {(address || branch.city) && <p className="s-muted">{address && <bdi>{address}</bdi>}{address && branch.city && '، '}{branch.city && <bdi>{branch.city}</bdi>}</p>}
        </div>
      </div>

      {branch.hours.length > 0 && (
        <div className="s-today">
          <BranchStatus hours={branch.hours} holidays={holidays} branchId={branch.id} tz={tz} renderedAt={Date.now()} />
          <p className="s-today-hours"><Clock size={16} /><span>اليوم ({DAYS_AR[today]}):</span> <Slots slots={todaySlots} /></p>
          <details className="s-week">
            <summary>مواعيد الأسبوع<Icon name="chevronDown" size={16} /></summary>
            <table>
              <caption className="sr-only">مواعيد عمل {name}</caption>
              <tbody>
                {week.map((row) => (
                  <tr key={row.days[0]} className={row.days.includes(today) ? 'today' : undefined}>
                    <th scope="row">{dayRange(row.days)}</th>
                    <td><Slots slots={row.slots} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}

      <div className="s-branch-actions">
        {tel && <a className="s-btn s-btn-soft" href={tel}><Phone size={16} /><bdi dir="ltr">{phone}</bdi></a>}
        {wa && <a className="s-btn s-btn-soft" href={wa}><Chat size={16} />واتساب</a>}
        {maps && <a className="s-btn s-btn-ghost" href={maps} target="_blank" rel="noopener noreferrer"><Icon name="directions" size={16} />الاتجاهات</a>}
      </div>
    </article>
  );
}

export function BranchesSection({ branches, holidays, clinicTz, contact, clinicName, tint }: { branches: SiteBranch[]; holidays: Holiday[]; clinicTz: string; contact: Contact; clinicName: string; tint?: boolean }) {
  if (!branches.length) return null;
  return (
    <Section id="branches" kicker="الفروع" title="أقرب فرع إليك ومواعيد العمل" sub="حالة الفرع الآن، ومواعيد الأسبوع كاملة بنقرة واحدة" tint={tint}>
      <div className="s-grid s-grid-wide">
        {branches.map((b) => <BranchCard key={b.id} branch={b} holidays={holidays} clinicTz={clinicTz} contact={contact} clinicName={clinicName} />)}
      </div>
    </Section>
  );
}
