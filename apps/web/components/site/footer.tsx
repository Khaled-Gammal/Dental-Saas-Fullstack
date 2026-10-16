import { Chat, Phone, Pin } from '../icons';
import { BrandMark } from './brand';
import { ar, type SiteData } from '../../lib/site';
import type { Contact } from './contact';
import type { NavLink } from './mobile-nav';

export function ClinicFooter({ site, name, about, links, contact }: { site: SiteData; name: string; about: string | null; links: NavLink[]; contact: Contact }) {
  const main = site.branches[0];
  const address = main ? ar(main.address_ar, main.address_en) : null;
  return (
    <footer className="s-foot">
      <div className="s-wrap s-foot-grid">
        <div className="s-foot-col s-foot-brand">
          <span className="s-brand"><BrandMark name={name} logo={site.clinic.logo} /></span>
          {about && <p className="s-muted">{about}</p>}
        </div>
        {links.length > 0 && (
          <nav className="s-foot-col" aria-label="روابط سريعة">
            <h3>الأقسام</h3>
            <ul className="s-foot-links">{links.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
          </nav>
        )}
        {(contact.tel || contact.whatsapp || address) && (
          <div className="s-foot-col">
            <h3>تواصل معنا</h3>
            <ul className="s-foot-links">
              {contact.tel && <li><a href={contact.tel}><Phone size={16} /><bdi dir="ltr">{contact.phone}</bdi></a></li>}
              {contact.whatsapp && <li><a href={contact.whatsapp}><Chat size={16} />واتساب</a></li>}
              {address && <li><span><Pin size={16} /><span><bdi>{address}</bdi>{main?.city && <>، <bdi>{main.city}</bdi></>}</span></span></li>}
            </ul>
          </div>
        )}
      </div>
      <div className="s-wrap s-foot-bottom">
        <span>© {new Date().getFullYear()} <bdi>{name}</bdi>. جميع الحقوق محفوظة.</span>
        {site.showPoweredBy && <span className="s-muted">Powered by Dental SaaS</span>}
      </div>
    </footer>
  );
}
