import { Chat, Phone, Pin } from '../icons';
import { WEEK_ORDER, ar, type SiteData } from '../../lib/site';
import { groupWeek } from '../../lib/hours';
import { BrandMark } from './brand';
import { dayRange, Slots } from './branches';
import type { Contact } from './contact';
import type { NavLink } from './menu';

/** The dark footer: the clinic, its sections, its contacts, the main branch's week, and its name set very large. */
export function ClinicFooter({ site, name, about, links, contact }: { site: SiteData; name: string; about: string | null; links: NavLink[]; contact: Contact }) {
  const main = site.branches[0];
  const address = main ? ar(main.address_ar, main.address_en) : null;
  const week = main?.hours.length ? groupWeek(main.hours, WEEK_ORDER) : [];
  return (
    <footer className="c-foot">
      <div className="c-wrap">
        <div className="c-foot-grid">
          <div className="c-foot-brand">
            <span className="c-brand"><BrandMark name={name} logo={site.clinic.logo} /></span>
            {about && <p>{about}</p>}
          </div>
          {links.length > 0 && (
            <nav aria-label="روابط سريعة">
              <h3>الأقسام</h3>
              <ul className="c-foot-links">{links.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
            </nav>
          )}
          {(contact.tel || contact.whatsapp || address) && (
            <div>
              <h3>تواصل معنا</h3>
              <ul className="c-foot-links">
                {contact.tel && <li><a href={contact.tel}><Phone size={16} /><bdi dir="ltr">{contact.phone}</bdi></a></li>}
                {contact.whatsapp && <li><a href={contact.whatsapp}><Chat size={16} />واتساب</a></li>}
                {address && <li><span><Pin size={16} /><span><bdi>{address}</bdi>{main?.city && <>، <bdi>{main.city}</bdi></>}</span></span></li>}
              </ul>
            </div>
          )}
          {week.length > 0 && (
            <div>
              <h3>مواعيد العمل</h3>
              <dl className="c-foot-week">
                {week.map((row) => <div key={row.days[0]}><dt>{dayRange(row.days)}</dt><dd><Slots slots={row.slots} /></dd></div>)}
              </dl>
            </div>
          )}
        </div>
        <p className="c-wordmark" aria-hidden><bdi>{name}</bdi></p>
        <div className="c-foot-bottom">
          <span>© {new Date().getFullYear()} <bdi>{name}</bdi>. جميع الحقوق محفوظة.</span>
          {site.showPoweredBy && <span>بواسطة منصة الأسنان</span>}
        </div>
      </div>
    </footer>
  );
}
