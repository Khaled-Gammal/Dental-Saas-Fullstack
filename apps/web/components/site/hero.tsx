import { Chat, Clock, Icon, Phone, Tooth } from '../icons';
import { arNoun, DEFAULT_TZ, NOUNS, price, specialtyLabel, type SiteData } from '../../lib/site';
import type { Contact } from './contact';
import { ToothArt } from './decor';
import { HeroStatus } from './live-status';

/**
 * Chips on the illustration carry real data only: the main branch's status right now (computed live in the browser,
 * see live-status.tsx) and the lowest listed price.
 */
function heroFacts(site: SiteData) {
  const prices = site.services.map((s) => s.price_minor).filter((p) => p > 0);
  const fromPrice = prices.length ? `خدمات تبدأ من ${price(Math.min(...prices), site.clinic.currency)}` : null;
  return { fromPrice };
}

/** `servicesShown`: the services section is on the page (Phase 2C-1: the clinic may hide it), so the hero may link to it. */
export function HeroSection({ site, name, about, contact, servicesShown = true }: { site: SiteData; name: string; about: string | null; contact: Contact; servicesShown?: boolean }) {
  const { fromPrice } = heroFacts(site);
  const main = site.branches[0];
  const specialties = site.clinic.specialties.slice(0, 4);
  const { doctors, services, branches } = site;
  return (
    <section className="s-hero" aria-labelledby="hero-t">
      <div className="s-hero-bg" aria-hidden><span /><span /><span /></div>
      <div className="s-wrap s-hero-in">
        <div className="s-hero-text">
          <span className="s-eyebrow"><Tooth size={16} />عيادة أسنان</span>
          <h1 id="hero-t"><bdi>{name}</bdi></h1>
          <p className="s-lead">{about ?? 'رعاية أسنان متكاملة لك ولعائلتك، بفريق متخصص وأسعار معلنة.'}</p>
          <div className="s-cta">
            {contact.bookUrl ? <a className="s-btn s-btn-lg" href={contact.bookUrl}><Icon name="calendar" size={18} />احجز موعدك الآن</a>
              : contact.tel && <a className="s-btn s-btn-lg" href={contact.tel}><Phone />احجز موعدك الآن</a>}
            {contact.whatsapp ? <a className="s-btn s-btn-lg s-btn-ghost" href={contact.whatsapp}><Chat />تواصل عبر واتساب</a>
              : contact.bookUrl && contact.tel && <a className="s-btn s-btn-lg s-btn-ghost" href={contact.tel}><Phone />اتصل بنا</a>}
            {!contact.bookUrl && !contact.tel && !contact.whatsapp && servicesShown && services.length > 0 && <a className="s-btn s-btn-lg" href="#services">تصفّح الخدمات</a>}
          </div>
          {(contact.bookUrl || contact.tel || contact.whatsapp) && servicesShown && services.length > 0 && <a className="s-hero-link" href="#services">أو تصفّح الخدمات والأسعار<Icon name="chevronDown" size={16} /></a>}
          {specialties.length > 0 && (
            <ul className="s-chips" aria-label="التخصصات">
              {specialties.map((s) => <li key={s} className="s-chip"><Icon name="check" size={14} /><bdi>{specialtyLabel(s)}</bdi></li>)}
            </ul>
          )}
        </div>

        <div className="s-hero-art" data-reveal>
          <div className="s-art">
            <ToothArt />
            {main && <HeroStatus icon={<Clock />} hours={main.hours} holidays={site.holidays} branchId={main.id}
              tz={main.timezone ?? site.clinic.timezone ?? DEFAULT_TZ} renderedAt={Date.now()} />}
            {fromPrice && <span className="s-float s-float-b"><Tooth size={16} />{fromPrice}</span>}
            {doctors.length > 0 && <span className="s-float s-float-c"><Icon name="user" size={16} />{doctors.length} {arNoun(doctors.length, NOUNS.doctor)}{branches.length > 1 && <> · {branches.length} {arNoun(branches.length, NOUNS.branch)}</>}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
