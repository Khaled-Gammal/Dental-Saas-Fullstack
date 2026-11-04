import type { ReactNode } from 'react';
import { initials } from '@dental/ui/text';
import { Chat, Icon, Phone, Tooth } from '../icons';
import { splitLastWord } from '../../lib/display';
import { imageProps } from '../../lib/media';
import { DEFAULT_TZ, price, specialtyLabel, type SiteData } from '../../lib/site';
import type { Contact } from './contact';
import { HeroArt, Swash } from './decor';
import { LiveStatus } from './live-status';

const DEFAULT_LEAD = 'رعاية أسنان متكاملة لك ولعائلتك، بفريق متخصص وأسعار معلنة.';

/** How the visitor reaches the clinic first: the online wizard, else a call, else WhatsApp. */
function primaryAction(contact: Contact): { href: string; icon: ReactNode } | null {
  if (contact.bookUrl) return { href: contact.bookUrl, icon: <Icon name="calendar" size={20} /> };
  if (contact.tel) return { href: contact.tel, icon: <Phone size={20} /> };
  if (contact.whatsapp) return { href: contact.whatsapp, icon: <Chat size={20} /> };
  return null;
}

/** The floating card on the drawing that names the booking channel, from what the clinic really offers. */
function channelCard(contact: Contact): { icon: ReactNode; small: string; strong: ReactNode } | null {
  if (contact.bookUrl) return { icon: <Icon name="calendar" size={20} />, small: 'اختر اليوم والوقت بنفسك', strong: 'احجز أونلاين' };
  if (contact.whatsapp) return { icon: <Chat size={20} />, small: 'احجز برسالة', strong: 'واتساب' };
  if (contact.tel && contact.phone) return { icon: <Phone size={20} />, small: 'اتصل للحجز', strong: <bdi dir="ltr">{contact.phone}</bdi> };
  return null;
}

/**
 * The first screen: the clinic's live status, its name with the last word underlined, its own words, the booking
 * actions and its team; beside it the brand-coloured arch drawing with two cards of real data (the lowest listed price
 * and the booking channel) and a rotating "book now" badge. `show` = the sections the clinic shows, so the hero only
 * links to what is on the page.
 */
export function HeroSection({ site, name, about, contact, show }: { site: SiteData; name: string; about: string | null; contact: Contact; show: { services: boolean; doctors: boolean } }) {
  const main = site.branches[0];
  const [head, tail] = splitLastWord(name);
  const prices = site.services.map((s) => s.price_minor).filter((p) => p > 0);
  const from = prices.length ? price(Math.min(...prices), site.clinic.currency) : null;
  const specialties = site.clinic.specialties.slice(0, 3).map(specialtyLabel);
  const team = site.doctors;
  const primary = primaryAction(contact);
  const channel = channelCard(contact);
  const eyebrow = <span className="c-live c-hero-in"><Tooth size={16} /><strong>عيادة أسنان</strong></span>;

  const secondary = contact.whatsapp && primary?.href !== contact.whatsapp
    ? <a className="c-btn c-btn-lg c-btn-ghost" href={contact.whatsapp}><Chat size={20} />واتساب</a>
    : contact.bookUrl && contact.tel ? <a className="c-btn c-btn-lg c-btn-ghost" href={contact.tel}><Phone size={20} />اتصل بنا</a> : null;

  const faces = (
    <span className="c-faces" aria-hidden>
      {team.slice(0, 4).map((d) => {
        const n = d.name_ar?.trim() || d.name_en?.trim() || '';
        return d.photo
          ? <img key={d.id} className="c-face" {...imageProps(d.photo, 96)} sizes="48px" alt="" decoding="async" />
          : <span key={d.id} className="c-face">{initials(n)}</span>;
      })}
    </span>
  );
  // the count is in the facts strip below; here the team's specialties, or the first doctors' names
  const names = team.slice(0, 2).map((d) => d.name_ar?.trim() || d.name_en?.trim()).filter(Boolean).join('، ');
  const proofText = (
    <span className="c-proof-text">
      <strong>{show.doctors ? 'تعرّف على فريقنا' : 'فريقنا الطبي'}</strong>
      <span>{specialties.length ? specialties.join(' · ') : <bdi>{names}{team.length > 2 && '…'}</bdi>}</span>
    </span>
  );

  return (
    <section className="c-hero" aria-labelledby="hero-t">
      <div className="c-wrap c-hero-grid">
        <div className="c-hero-copy">
          {main
            ? <LiveStatus className="c-hero-in" hours={main.hours} holidays={site.holidays} branchId={main.id}
                tz={main.timezone ?? site.clinic.timezone ?? DEFAULT_TZ} renderedAt={Date.now()} fallback={eyebrow} />
            : eyebrow}
          <h1 id="hero-t" className={`c-display c-hero-in${name.length > 34 ? ' is-long' : ''}`}>
            <bdi>{head && <>{head} </>}<span className="c-swash">{tail}<Swash /></span></bdi>
          </h1>
          <p className="c-lead c-hero-in">{about ?? DEFAULT_LEAD}</p>
          <div className="c-hero-cta c-hero-in">
            {primary && (
              <a className="c-btn c-btn-lg c-btn-arrow" href={primary.href}>
                {primary.icon}احجز موعدك الآن<span className="c-btn-bubble" aria-hidden><Icon name="arrow" size={18} /></span>
              </a>
            )}
            {secondary}
            {!primary && show.services && site.services.length > 0 && <a className="c-btn c-btn-lg" href="#services">تصفّح الخدمات</a>}
          </div>
          {primary && show.services && site.services.length > 0 && (
            <a className="c-hero-link c-hero-in" href="#services">أو تصفّح الخدمات والأسعار<Icon name="chevronDown" size={16} /></a>
          )}
          {team.length > 0 ? (
            show.doctors
              ? <a className="c-proof c-hero-in" href="#doctors">{faces}{proofText}<Icon name="arrow" size={16} className="c-proof-arrow" /></a>
              : <div className="c-proof c-hero-in">{faces}{proofText}</div>
          ) : specialties.length > 0 && (
            <ul className="c-tags c-hero-tags c-hero-in" aria-label="التخصصات">
              {specialties.map((s) => <li key={s} className="c-chip"><Icon name="check" size={14} /><bdi>{s}</bdi></li>)}
            </ul>
          )}
        </div>

        <div className="c-hero-visual">
          <HeroArt />
          {primary && (
            <a className="c-badge" href={primary.href} tabIndex={-1} aria-hidden>
              <svg className="c-badge-ring" viewBox="0 0 120 120" focusable="false">
                <defs><path id="c-badge-path" d="M60 60m-45 0a45 45 0 1 1 90 0a45 45 0 1 1-90 0" /></defs>
                <text><textPath href="#c-badge-path">احجز موعدك الآن ✦ احجز موعدك الآن ✦</textPath></text>
              </svg>
              <span className="c-badge-core"><Icon name="arrowUpLeft" size={22} /></span>
            </a>
          )}
          {from && (
            <div className="c-float c-float-a">
              <span className="c-float-icon"><Icon name="tag" size={20} /></span>
              <span><small>الأسعار تبدأ من</small><strong>{from}</strong></span>
            </div>
          )}
          {channel && (
            <div className="c-float c-float-b">
              <span className="c-float-icon">{channel.icon}</span>
              <span><small>{channel.small}</small><strong>{channel.strong}</strong></span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
