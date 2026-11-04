import type { ReactNode } from 'react';
import { Chat, Icon, Phone } from '../icons';
import type { Contact } from './contact';
import { CtaArt } from './decor';

/** The closing band: the channels the clinic really answers on, with the main branch's status now (`status`). */
export function AppointmentCTA({ contact, status }: { contact: Contact; status?: ReactNode }) {
  if (!contact.bookUrl && !contact.tel && !contact.whatsapp) return null;
  return (
    <section className="c-cta" aria-labelledby="cta-t">
      <div className="c-wrap">
        <div className="c-cta-panel" data-reveal>
          <div className="c-cta-copy">
            {status}
            <h2 id="cta-t">جاهز لموعدك القادم؟</h2>
            <p>{contact.bookUrl ? 'احجز عبر الموقع في دقيقة، أو تواصل معنا مباشرة.' : 'اتصل بنا أو راسلنا على واتساب لاختيار الوقت المناسب لك.'}</p>
            <div className="c-cta-actions">
              {contact.bookUrl && <a className="c-btn c-btn-lg c-btn-light c-btn-arrow" href={contact.bookUrl}><Icon name="calendar" size={20} />احجز الآن<span className="c-btn-bubble" aria-hidden><Icon name="arrow" size={18} /></span></a>}
              {contact.tel && <a className={`c-btn c-btn-lg ${contact.bookUrl ? 'c-btn-glass' : 'c-btn-light'}`} href={contact.tel}><Phone size={20} />{contact.phone ? <bdi dir="ltr">{contact.phone}</bdi> : 'اتصل بنا'}</a>}
              {contact.whatsapp && <a className="c-btn c-btn-lg c-btn-glass" href={contact.whatsapp}><Chat size={20} />واتساب</a>}
            </div>
          </div>
          <CtaArt />
        </div>
      </div>
    </section>
  );
}

/**
 * Thumb-reach booking bar on phones (hidden on wider screens by CSS); it slides in once the hero is scrolled past.
 * `book` replaces the main action (a service's page books that service).
 */
export function MobileBookingBar({ contact, book }: { contact: Contact; book?: { href: string; label: string; icon: ReactNode } | null }) {
  if (!contact.bookUrl && !contact.tel && !contact.whatsapp) return null;
  const main = book ?? (contact.bookUrl ? { href: contact.bookUrl, label: 'احجز الآن', icon: <Icon name="calendar" size={18} /> }
    : contact.tel ? { href: contact.tel, label: 'اتصل للحجز', icon: <Phone size={18} /> }
      : { href: contact.whatsapp!, label: 'احجز عبر واتساب', icon: <Chat size={18} /> });
  return (
    <div className="c-mbar" role="group" aria-label="حجز سريع">
      <a className="c-btn" href={main.href}>{main.icon}{main.label}</a>
      {contact.whatsapp && !main.href.startsWith('https://wa.me/') && <a className="c-icon-btn c-icon-btn-lg" href={contact.whatsapp} aria-label="واتساب"><Chat size={20} /></a>}
      {contact.tel && !main.href.startsWith('tel:') && <a className="c-icon-btn c-icon-btn-lg" href={contact.tel} aria-label="اتصل بنا"><Phone size={20} /></a>}
    </div>
  );
}
