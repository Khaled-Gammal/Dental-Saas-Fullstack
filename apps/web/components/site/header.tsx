import { Icon, Phone } from '../icons';
import type { SiteImage } from '../../lib/media';
import { BrandMark } from './brand';
import { MobileNav, type NavLink } from './mobile-nav';
import type { Contact } from './contact';

export function ClinicHeader({ name, logo, links, contact }: { name: string; logo?: SiteImage | null; links: NavLink[]; contact: Contact }) {
  const actions: NavLink[] = [];
  if (contact.bookUrl) actions.push({ href: contact.bookUrl, label: 'احجز عبر الموقع' });
  if (contact.tel) actions.push({ href: contact.tel, label: 'اتصل للحجز' });
  if (contact.whatsapp) actions.push({ href: contact.whatsapp, label: 'احجز عبر واتساب' });
  return (
    <header className="s-nav">
      <div className="s-wrap s-nav-in">
        <a href="#top" className="s-brand"><BrandMark name={name} logo={logo} /></a>
        <nav className="s-links" aria-label="أقسام الموقع">
          {links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        </nav>
        {contact.bookUrl ? <a className="s-btn s-btn-sm s-nav-cta" href={contact.bookUrl}><Icon name="calendar" size={16} />احجز موعدًا</a>
          : contact.tel && <a className="s-btn s-btn-sm s-nav-cta" href={contact.tel}><Phone />احجز موعدًا</a>}
        {(links.length > 0 || actions.length > 0) && <MobileNav links={links} actions={actions} />}
      </div>
    </header>
  );
}
