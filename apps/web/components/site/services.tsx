import { Chat, Clock, Icon, Phone, type IconName } from '../icons';
import { bentoCells, bentoClass, type BentoCell } from '../../lib/display';
import { imageProps } from '../../lib/media';
import { ar, arNoun, CATEGORY_ICON, NOUNS, priceText, type SiteService } from '../../lib/site';
import { bookingLink, type Contact } from './contact';
import { Section } from './decor';

export const serviceIcon = (category: string | null): IconName => ((category && CATEGORY_ICON[category]) ?? 'tooth') as IconName;

/** The booking action for one service: the wizard with it chosen when the wizard offers it, else WhatsApp naming it, else a call. */
export function serviceBooking(service: SiteService, contact: Contact, clinicName: string) {
  const name = ar(service.name_ar, service.name_en) ?? '';
  const message = `مرحبًا، أود حجز موعد لـ${name} في ${clinicName}.`;
  if (service.bookable_online === false) return bookingLink({ ...contact, bookUrl: null }, message);
  const link = bookingLink(contact, message);
  return link?.via === 'online' ? { ...link, href: `${link.href}?service=${service.id}` } : link;
}

export const viaIcon = (via: 'online' | 'whatsapp' | 'tel', size = 16) =>
  via === 'online' ? <Icon name="calendar" size={size} /> : via === 'whatsapp' ? <Chat size={size} /> : <Phone size={size} />;

/**
 * A service in the bento grid. The whole card opens the service's own page (its title link is stretched over the card);
 * the booking button sits above that link. A card two cells wide lays out sideways (a container query) and shows the
 * service's photo, or its category drawn large on the brand colour.
 */
export function ServiceCard({ service, contact, clinicName, currency, cell }: { service: SiteService; contact: Contact; clinicName: string; currency?: string; cell?: BentoCell }) {
  const name = ar(service.name_ar, service.name_en) ?? '';
  const desc = ar(service.description_ar, service.description_en);
  const book = serviceBooking(service, contact, clinicName);
  const icon = serviceIcon(service.category);
  return (
    <article className={['c-card c-svc', cell && bentoClass(cell)].filter(Boolean).join(' ')} data-reveal>
      <div className="c-svc-in">
        {/* wide cards only (container query): the photo large, or the category drawn on the brand colour */}
        {service.image
          ? <div className="c-svc-media"><img {...imageProps(service.image, 720)} sizes="(max-width: 1023px) 45vw, 520px" alt="" loading="lazy" decoding="async" /></div>
          : <div className="c-svc-media c-svc-art" aria-hidden><Icon name={icon} size={96} strokeWidth={1.2} /></div>}
        <div className="c-svc-body">
          <div className="c-svc-top">
            {/* narrow cards: the photo as a thumbnail, so a row of cards keeps one height */}
            <span className="c-svc-icon">
              {service.image
                ? <img {...imageProps(service.image, 160)} sizes="64px" alt="" loading="lazy" decoding="async" />
                : <Icon name={icon} size={26} />}
            </span>
            <span className="c-chip"><Clock size={14} />{service.duration_minutes} {arNoun(service.duration_minutes, NOUNS.minute)}</span>
          </div>
          {/* Phase 2C-3: each service has its own page (search engines index it; visitors read more) */}
          <h3><a className="c-svc-link" href={`/services/${service.id}`}><bdi>{name}</bdi></a></h3>
          {desc && <p className="c-svc-desc">{desc}</p>}
          <div className="c-svc-foot">
            <span className="c-price"><small>السعر</small><strong>{priceText(service.price_minor, service.price_max_minor, currency)}</strong></span>
            {book && <a className="c-btn c-btn-sm c-btn-soft c-svc-book" href={book.href} aria-label={`احجز ${name}`}>{viaIcon(book.via)}احجز</a>}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ServicesSection({ services, contact, clinicName, currency, tint }: { services: SiteService[]; contact: Contact; clinicName: string; currency?: string; tint?: boolean }) {
  if (!services.length) return null;
  const cells = bentoCells(services.length);
  return (
    <Section id="services" kicker="خدماتنا" title="خدمات أسنان بأسعار واضحة" sub="تعرّف على الخدمة ومدتها المتوقعة وسعرها قبل الزيارة، واحجزها مباشرة." tint={tint}>
      <div className="c-bento">
        {services.map((s, i) => <ServiceCard key={s.id} service={s} contact={contact} clinicName={clinicName} currency={currency} cell={cells[i]} />)}
      </div>
    </Section>
  );
}
