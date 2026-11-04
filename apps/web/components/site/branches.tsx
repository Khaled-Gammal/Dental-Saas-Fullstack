import { clock12, telHref } from '@dental/ui/text';
import { Chat, Clock, Icon, Phone, Pin } from '../icons';
import { imageProps } from '../../lib/media';
import { ar, DAYS_AR, DEFAULT_TZ, mapsHref, WEEK_ORDER, whatsappHref, type SiteBranch } from '../../lib/site';
import { groupWeek, localNow, type Holiday, type HourSlot } from '../../lib/hours';
import { LiveStatus } from './live-status';
import type { Contact } from './contact';
import { MapArt, Section } from './decor';

export const Slots = ({ slots }: { slots: HourSlot[] }) =>
  slots.length
    ? <span className="c-slots">{slots.map((h) => <bdi key={h.opens_at}>{clock12(h.opens_at)}–{clock12(h.closes_at)}</bdi>)}</span>
    : <span className="c-closed">مغلق</span>;

export const dayRange = (days: number[]) => (days.length === 1 ? DAYS_AR[days[0]] : `${DAYS_AR[days[0]]} – ${DAYS_AR[days[days.length - 1]]}`);

/**
 * A branch: its photo, or a drawn neighbourhood with the brand pin, with its status now; then its name, address, today's
 * hours, the whole week (grouped, one tap away) and the ways to reach it. Sideways when the card is wide (one branch).
 */
export function BranchCard({ branch, index, holidays, clinicTz, contact, clinicName }: { branch: SiteBranch; index: number; holidays: Holiday[]; clinicTz: string; contact: Contact; clinicName: string }) {
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
    <article className="c-card c-branch" data-reveal>
      <div className="c-branch-in">
        <div className="c-branch-media">
          {branch.photo
            ? <img {...imageProps(branch.photo, 720)} sizes="(max-width: 640px) 100vw, 560px" alt="" loading="lazy" decoding="async" />
            : <MapArt flip={index % 2 === 1} />}
          {branch.hours.length > 0 && <LiveStatus className="c-live-on" hours={branch.hours} holidays={holidays} branchId={branch.id} tz={tz} renderedAt={Date.now()} />}
        </div>
        <div className="c-branch-body">
          <div>
            <h3><bdi>{name}</bdi>{branch.is_main && <span className="c-badge-main">الفرع الرئيسي</span>}</h3>
            {(address || branch.city) && (
              <p className="c-branch-addr"><Pin size={18} /><span>{address && <bdi>{address}</bdi>}{address && branch.city && '، '}{branch.city && <bdi>{branch.city}</bdi>}</span></p>
            )}
          </div>

          {branch.hours.length > 0 && (
            <div className="c-hours">
              <p className="c-hours-today"><Clock size={16} /><span>اليوم ({DAYS_AR[today]})</span><Slots slots={todaySlots} /></p>
              <details className="c-week">
                <summary>مواعيد الأسبوع<Icon name="chevronDown" size={16} /></summary>
                <table>
                  <caption className="sr-only">مواعيد عمل {name}</caption>
                  <tbody>
                    {week.map((row) => (
                      <tr key={row.days[0]} className={row.days.includes(today) ? 'is-today' : undefined}>
                        <th scope="row">{dayRange(row.days)}</th>
                        <td><Slots slots={row.slots} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          )}

          <div className="c-branch-actions">
            {tel && <a className="c-btn c-btn-sm c-btn-soft" href={tel}><Phone size={16} /><bdi dir="ltr">{phone}</bdi></a>}
            {wa && <a className="c-btn c-btn-sm c-btn-soft" href={wa}><Chat size={16} />واتساب</a>}
            {maps && <a className="c-btn c-btn-sm c-btn-ghost" href={maps} target="_blank" rel="noopener noreferrer"><Icon name="directions" size={16} />الاتجاهات</a>}
          </div>
        </div>
      </div>
    </article>
  );
}

export function BranchesSection({ branches, holidays, clinicTz, contact, clinicName, tint }: { branches: SiteBranch[]; holidays: Holiday[]; clinicTz: string; contact: Contact; clinicName: string; tint?: boolean }) {
  if (!branches.length) return null;
  return (
    <Section id="branches" kicker="الفروع" title="أقرب فرع إليك ومواعيد العمل" sub="حالة الفرع الآن، ومواعيد الأسبوع كاملة بنقرة واحدة." tint={tint}>
      <div className="c-branches" data-count={Math.min(branches.length, 3)}>
        {branches.map((b, i) => <BranchCard key={b.id} branch={b} index={i} holidays={holidays} clinicTz={clinicTz} contact={contact} clinicName={clinicName} />)}
      </div>
    </Section>
  );
}
