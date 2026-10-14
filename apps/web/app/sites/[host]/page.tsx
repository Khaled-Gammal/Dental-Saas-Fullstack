import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { initials, onColor, readableOnWhite, telHref } from '@dental/ui/text';
import { Clock, Phone, Pin, Tooth } from '../../../components/icons';
import { Arch, Section } from '../../../components/site/decor';
import { arNoun, clinicWeekday, DAYS_AR, egp, getSite, hhmm, NOUNS, priceText, safeColor, WEEK_ORDER, type SiteData } from '../../../lib/site';

type Props = { params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await getSite(decodeURIComponent((await params).host));
  if (!site) return {};
  const name = site.clinic.name_ar ?? site.clinic.name_en ?? '';
  return { title: `${name} | عيادة أسنان`, description: site.clinic.about_ar ?? site.clinic.about_en ?? `احجز موعدك في ${name}` };
}

/** Brand colour plus the two derived colours that keep text readable on any colour the clinic picks. */
function brandStyle(primary?: string): CSSProperties {
  const brand = safeColor(primary);
  return { '--brand': brand, '--on-brand': onColor(brand), '--brand-text': readableOnWhite(brand) } as CSSProperties;
}

/** Hero chips use real data only: today's hours at the first branch and the lowest listed price. */
function heroFacts(site: SiteData, today: number) {
  const slots = site.branches[0]?.hours.filter((h) => h.weekday === today) ?? [];
  const hours = slots.map((h) => `${hhmm(h.opens_at)}–${hhmm(h.closes_at)}`).join(' ، ');
  const todayText = !site.branches.length ? null
    : slots.length ? <>مفتوح اليوم <bdi dir="ltr">{hours}</bdi></> : 'مغلق اليوم';
  const prices = site.services.map((s) => s.price_minor).filter((p) => p > 0);
  const fromPrice = prices.length ? `خدمات تبدأ من ${egp(Math.min(...prices))}` : null;
  return { todayText, fromPrice };
}

export default async function ClinicSite({ params }: Props) {
  const site = await getSite(decodeURIComponent((await params).host));
  if (!site) notFound();
  const { clinic, services, doctors, branches } = site;
  const name = clinic.name_ar ?? clinic.name_en ?? '';
  const phone = clinic.primary_phone;
  const tel = telHref(phone);
  const today = clinicWeekday();
  const { todayText, fromPrice } = heroFacts(site, today);

  return (
    <div className="site" style={brandStyle(site.theme.primary)}>
      <header className="s-nav">
        <div className="s-wrap s-nav-in">
          <a href="#top" className="s-brand"><span className="s-mark"><Tooth /></span><bdi>{name}</bdi></a>
          <nav className="s-links" aria-label="أقسام الموقع">
            {services.length > 0 && <a href="#services">الخدمات</a>}
            {doctors.length > 0 && <a href="#doctors">الأطباء</a>}
            {branches.length > 0 && <a href="#branches">الفروع</a>}
          </nav>
          {tel && <a className="s-btn s-btn-sm" href={tel}><Phone />احجز</a>}
        </div>
      </header>

      <main id="top">
        <section className="s-hero">
          <div className="s-wrap s-hero-in">
            <div className="s-hero-text">
              <span className="s-eyebrow">عيادة أسنان</span>
              <h1><bdi>{name}</bdi></h1>
              {(clinic.about_ar ?? clinic.about_en) && <p className="s-lead">{clinic.about_ar ?? clinic.about_en}</p>}
              <div className="s-cta">
                {tel && <a className="s-btn" href={tel}><Phone />احجز الآن · <bdi dir="ltr">{phone}</bdi></a>}
                {services.length > 0 && <a className="s-btn s-btn-ghost" href="#services">تصفّح الخدمات</a>}
              </div>
              <ul className="s-facts" aria-label="عن العيادة">
                {doctors.length > 0 && <li><strong>{doctors.length}</strong> {arNoun(doctors.length, NOUNS.doctor)}</li>}
                {services.length > 0 && <li><strong>{services.length}</strong> {arNoun(services.length, NOUNS.service)}</li>}
                {branches.length > 0 && <li><strong>{branches.length}</strong> {arNoun(branches.length, NOUNS.branch)}</li>}
              </ul>
            </div>
            <div className="s-hero-art">
              <div className="s-blob" aria-hidden />
              <Arch />
              {todayText && <span className="s-float s-float-a"><Clock />{todayText}</span>}
              {fromPrice && <span className="s-float s-float-b"><Tooth size={16} />{fromPrice}</span>}
            </div>
          </div>
        </section>

        {services.length > 0 && (
          <Section id="services" title="خدماتنا" sub="أسعار واضحة ومدة متوقعة لكل زيارة">
            <div className="s-grid">
              {services.map((s) => (
                <article className="s-card s-service" key={s.id}>
                  <span className="s-icon"><Tooth size={22} /></span>
                  <h3><bdi>{s.name_ar ?? s.name_en}</bdi></h3>
                  <div className="s-meta">
                    <span className="s-price">{priceText(s.price_minor, s.price_max_minor)}</span>
                    <span className="s-chip"><Clock />{s.duration_minutes} {arNoun(s.duration_minutes, NOUNS.minute)}</span>
                  </div>
                </article>
              ))}
            </div>
          </Section>
        )}

        {doctors.length > 0 && (
          <Section id="doctors" title="أطباؤنا" sub="فريق متخصص يهتم بابتسامتك" tint>
            <div className="s-grid">
              {doctors.map((d) => {
                const dn = d.name_ar ?? d.name_en ?? '';
                return (
                  <article className="s-card s-doctor" key={d.id}>
                    <span className="s-avatar" aria-hidden>{initials(dn)}</span>
                    <div>
                      <h3><bdi>{dn}</bdi></h3>
                      {d.title_ar && <p className="s-muted">{d.title_ar}</p>}
                    </div>
                  </article>
                );
              })}
            </div>
          </Section>
        )}

        {branches.length > 0 && (
          <Section id="branches" title="الفروع ومواعيد العمل" sub="اختر الفرع الأقرب لك">
            <div className="s-grid s-grid-wide">
              {branches.map((b) => {
                const bn = b.name_ar ?? b.name_en ?? '';
                const branchPhone = b.phone ?? phone;
                const branchTel = telHref(branchPhone);
                return (
                  <article className="s-card s-branch" key={b.id}>
                    <div className="s-branch-head">
                      <span className="s-icon"><Pin /></span>
                      <div>
                        <h3><bdi>{bn}</bdi></h3>
                        {b.address_ar && <p className="s-muted">{b.address_ar}</p>}
                      </div>
                    </div>
                    <table className="s-hours">
                      <caption className="sr-only">مواعيد عمل {bn}</caption>
                      <tbody>
                        {WEEK_ORDER.map((day) => {
                          const slots = b.hours.filter((h) => h.weekday === day);
                          return (
                            <tr key={day} className={day === today ? 'today' : undefined} aria-current={day === today ? 'date' : undefined}>
                              <th scope="row">{DAYS_AR[day]}{day === today && <span className="s-today">اليوم</span>}</th>
                              <td>{slots.length
                                ? <span className="s-slots">{slots.map((h) => <bdi key={h.opens_at} dir="ltr">{hhmm(h.opens_at)}–{hhmm(h.closes_at)}</bdi>)}</span>
                                : <span className="s-closed">مغلق</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {branchTel && <a className="s-btn s-btn-soft" href={branchTel}><Phone /><bdi dir="ltr">{branchPhone}</bdi></a>}
                  </article>
                );
              })}
            </div>
          </Section>
        )}

        {tel && (
          <section className="s-wrap">
            <div className="s-band">
              <div>
                <h2>جاهز لزيارتك القادمة؟</h2>
                <p>اتصل بنا الآن واحجز موعدك في دقيقة.</p>
              </div>
              <a className="s-btn s-btn-light" href={tel}><Phone /><bdi dir="ltr">{phone}</bdi></a>
            </div>
          </section>
        )}
      </main>

      <footer className="s-foot">
        <div className="s-wrap s-foot-in">
          <span>© {new Date().getFullYear()} <bdi>{name}</bdi></span>
          {site.showPoweredBy && <span className="s-muted">Powered by Dental SaaS</span>}
        </div>
      </footer>
    </div>
  );
}
