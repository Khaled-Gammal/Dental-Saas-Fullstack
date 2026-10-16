import { Chat, Icon, Phone } from '../icons';
import type { Contact } from './contact';

/** Final conversion band: the two channels the clinic really answers on. */
export function AppointmentCTA({ contact }: { contact: Contact }) {
  if (!contact.bookUrl && !contact.tel && !contact.whatsapp) return null;
  return (
    <section className="s-wrap" aria-labelledby="cta-t">
      <div className="s-band" data-reveal>
        <div className="s-band-text">
          <h2 id="cta-t">جاهز لموعدك القادم؟</h2>
          <p>{contact.bookUrl ? 'احجز عبر الموقع في دقيقة، أو تواصل معنا مباشرة.' : 'اتصل بنا أو راسلنا على واتساب لاختيار الوقت المناسب لك.'}</p>
        </div>
        <div className="s-band-actions">
          {contact.bookUrl && <a className="s-btn s-btn-light s-btn-lg" href={contact.bookUrl}><Icon name="calendar" size={18} />احجز الآن</a>}
          {contact.tel && <a className={`s-btn s-btn-lg ${contact.bookUrl ? 's-btn-outline-light' : 's-btn-light'}`} href={contact.tel}><Phone />{contact.phone ? <bdi dir="ltr">{contact.phone}</bdi> : 'اتصل بنا'}</a>}
          {contact.whatsapp && <a className="s-btn s-btn-outline-light s-btn-lg" href={contact.whatsapp}><Chat />واتساب</a>}
        </div>
      </div>
    </section>
  );
}

/** Thumb-reach booking bar on phones (hidden on wider screens by CSS). */
export function MobileBookingBar({ contact }: { contact: Contact }) {
  if (!contact.bookUrl && !contact.tel && !contact.whatsapp) return null;
  return (
    <div className="s-mbar" aria-label="حجز سريع">
      {contact.bookUrl ? <a className="s-btn" href={contact.bookUrl}><Icon name="calendar" size={18} />احجز الآن</a>
        : contact.tel && <a className="s-btn" href={contact.tel}><Phone />اتصل للحجز</a>}
      {contact.whatsapp && <a className="s-btn s-btn-ghost" href={contact.whatsapp}><Chat />واتساب</a>}
    </div>
  );
}
