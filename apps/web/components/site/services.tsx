import type { IconName } from '@dental/ui/icons';
import { Chat, Clock, Icon, Phone } from '../icons';
import { imageProps } from '../../lib/media';
import { ar, arNoun, CATEGORY_ICON, NOUNS, priceText, type SiteService } from '../../lib/site';
import { bookingLink, type Contact } from './contact';
import { Section } from './decor';

const iconFor = (category: string | null): IconName => ((category && CATEGORY_ICON[category]) ?? 'tooth') as IconName;

export function ServiceCard({ service, contact, clinicName, currency }: { service: SiteService; contact: Contact; clinicName: string; currency?: string }) {
  const name = ar(service.name_ar, service.name_en) ?? '';
  const desc = ar(service.description_ar, service.description_en);
  // the message names the service, so the clinic knows what the visitor wants before replying
  const link = bookingLink(contact, `مرحبًا، أود حجز موعد لـ${name} في ${clinicName}.`);
  // the wizard opens with this service chosen — when it offers it (Phase 2C-3); otherwise WhatsApp or a call
  const book = service.bookable_online === false ? bookingLink({ ...contact, bookUrl: null }, `مرحبًا، أود حجز موعد لـ${name} في ${clinicName}.`)
    : link?.via === 'online' ? { ...link, href: `${link.href}?service=${service.id}` } : link;
  return (
    <article className={`s-card s-service${service.image ? ' has-media' : ''}`} data-reveal>
      {service.image
        ? <img className="s-card-media" {...imageProps(service.image, 640)} sizes="(max-width: 640px) 100vw, 360px" alt="" loading="lazy" decoding="async" />
        : <span className="s-service-icon"><Icon name={iconFor(service.category)} size={26} /></span>}
      {/* Phase 2C-3: each service has its own page (search engines index it; visitors read more) */}
      <h3><a className="s-card-title-link" href={`/services/${service.id}`}><bdi>{name}</bdi></a></h3>
      {desc && <p className="s-service-desc">{desc}</p>}
      <div className="s-meta">
        <span className="s-price">{priceText(service.price_minor, service.price_max_minor, currency)}</span>
        <span className="s-duration"><Clock size={14} />{service.duration_minutes} {arNoun(service.duration_minutes, NOUNS.minute)}</span>
      </div>
      {book && <a className="s-btn s-btn-soft s-card-cta" href={book.href} aria-label={`احجز ${name}`}>{book.via === 'online' ? <Icon name="calendar" size={16} /> : book.via === 'whatsapp' ? <Chat size={16} /> : <Phone size={16} />}احجز هذه الخدمة</a>}
    </article>
  );
}

export function ServicesSection({ services, contact, clinicName, currency, tint }: { services: SiteService[]; contact: Contact; clinicName: string; currency?: string; tint?: boolean }) {
  if (!services.length) return null;
  return (
    <Section id="services" kicker="خدماتنا" title="خدمات أسنان بأسعار واضحة" sub="تعرّف على الخدمة ومدتها المتوقعة وسعرها قبل الزيارة" tint={tint}>
      <div className="s-grid">
        {services.map((s) => <ServiceCard key={s.id} service={s} contact={contact} clinicName={clinicName} currency={currency} />)}
      </div>
    </Section>
  );
}
