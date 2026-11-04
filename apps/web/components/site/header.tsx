import { Chat, Icon, Phone } from '../icons';
import type { SiteImage } from '../../lib/media';
import { BrandMark } from './brand';
import { MobileMenu, type NavLink } from './menu';
import type { Contact } from './contact';

/**
 * The floating header bar. `home` is where the name links to ("#top" on the home page, "/" elsewhere); `book` = false
 * hides the booking button (the booking page itself).
 */
export function ClinicHeader({ name, logo, links, contact, home = '#top', book = true }: { name: string; logo?: SiteImage | null; links: NavLink[]; contact: Contact; home?: string; book?: boolean }) {
  const actions: NavLink[] = [];
  if (book && contact.bookUrl) actions.push({ href: contact.bookUrl, label: 'احجز عبر الموقع' });
  if (contact.tel) actions.push({ href: contact.tel, label: 'اتصل للحجز' });
  if (contact.whatsapp) actions.push({ href: contact.whatsapp, label: 'احجز عبر واتساب' });
  const cta = !book ? null : contact.bookUrl ? { href: contact.bookUrl, icon: <Icon name="calendar" size={18} /> } : contact.tel ? { href: contact.tel, icon: <Phone size={18} /> } : null;
  return (
    <header className="c-nav">
      <div className="c-nav-bar">
        <a href={home} className="c-brand"><BrandMark name={name} logo={logo} /></a>
        {links.length > 0 && (
          <nav className="c-links" aria-label="أقسام الموقع">
            {links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
          </nav>
        )}
        <div className="c-nav-actions">
          {contact.whatsapp && <a className="c-icon-btn c-nav-wa" href={contact.whatsapp} aria-label="تواصل عبر واتساب"><Chat size={20} /></a>}
          {cta && <a className="c-btn c-btn-sm c-nav-cta" href={cta.href}>{cta.icon}احجز موعدًا</a>}
          {(links.length > 0 || actions.length > 0) && <MobileMenu links={links} actions={actions} />}
        </div>
      </div>
    </header>
  );
}
