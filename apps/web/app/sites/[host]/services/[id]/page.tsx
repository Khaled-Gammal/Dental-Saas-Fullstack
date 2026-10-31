import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { onColor, readableOnWhite } from '@dental/ui/text';
import { Chat, Clock, Icon, Phone } from '../../../../../components/icons';
import { bookingLink, contactFor } from '../../../../../components/site/contact';
import { AppointmentCTA, MobileBookingBar } from '../../../../../components/site/cta';
import { Section } from '../../../../../components/site/decor';
import { DoctorCard } from '../../../../../components/site/doctors';
import { FaqSection, faqItems } from '../../../../../components/site/faq';
import { ClinicFooter } from '../../../../../components/site/footer';
import { GallerySection } from '../../../../../components/site/gallery';
import { ClinicHeader } from '../../../../../components/site/header';
import type { NavLink } from '../../../../../components/site/mobile-nav';
import { imageProps } from '../../../../../lib/media';
import { faqStructuredData, visibleSections } from '../../../../../lib/sections';
import { breadcrumbData, clinicName, jsonLd, serviceDescription, serviceStructuredData, serviceTitle, shareImagePath } from '../../../../../lib/seo';
import { ar, arNoun, getSite, NOUNS, originOf, priceText, safeColor, type SiteData } from '../../../../../lib/site';

type Props = { params: Promise<{ host: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The service if the clinic shows it on its site (the payload holds only those) and shows its services section (a
 * clinic that hides it has no service pages).
 */
async function load(params: Props['params']) {
  const { host: raw, id } = await params;
  const host = decodeURIComponent(raw);
  const site = UUID.test(id) ? await getSite(host) : null;
  const shown = site ? visibleSections(site.sections) : [];
  const service = shown.includes('services') ? site?.services.find((s) => s.id === id) : undefined;
  return site && service ? { host, site, service, shown } : null;
}

function brandStyle(site: SiteData): CSSProperties {
  const brand = safeColor(site.theme.primary);
  return { '--brand': brand, '--on-brand': onColor(brand), '--brand-text': readableOnWhite(brand) } as CSSProperties;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await load(params);
  if (!r) return { robots: { index: false } };
  const { host, site, service } = r;
  const title = serviceTitle(service, site);
  const description = serviceDescription(service, site);
  const path = `/services/${service.id}`;
  // the clinic's share image (a JPEG every network reads; the service's own image is WebP)
  const image = { url: shareImagePath(site), width: 1200, height: 630 };
  return {
    metadataBase: new URL(originOf(host)),
    title, description,
    alternates: { canonical: path },
    openGraph: { type: 'website', locale: 'ar_EG', siteName: clinicName(site), title, description, url: path, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
    robots: { index: true, follow: true },
  };
}

/**
 * Phase 2C-3: a service's own page on the clinic's site — what it is, its price and length, the doctors who provide
 * it, its before/after cases and questions, and the booking action. Search engines index it (sitemap, schema.org).
 */
export default async function ServicePage({ params }: Props) {
  const r = await load(params);
  if (!r) notFound();
  const { host, site, service, shown } = r;
  const origin = originOf(host);
  const name = clinicName(site);
  const title = ar(service.name_ar, service.name_en) ?? '';
  const desc = ar(service.description_ar, service.description_en);
  const about = ar(site.clinic.about_ar, site.clinic.about_en);
  const contact = contactFor(site.clinic, name, site.onlineBooking);
  const link = bookingLink(contact, `مرحبًا، أود حجز موعد لـ${title} في ${name}.`);
  // the wizard with this service chosen when it offers it; otherwise WhatsApp or a call
  const book = service.bookable_online === false ? bookingLink({ ...contact, bookUrl: null }, `مرحبًا، أود حجز موعد لـ${title} في ${name}.`)
    : link?.via === 'online' ? { ...link, href: `${link.href}?service=${service.id}` } : link;
  // only what the clinic shows on its site (its sections)
  const doctors = shown.includes('doctors') ? site.doctors.filter((d) => service.doctor_ids?.includes(d.id)) : [];
  const cases = shown.includes('gallery') ? site.cases.filter((c) => c.service_id === service.id) : [];
  const faqs = shown.includes('faq') ? site.faqs.filter((f) => f.service_id === service.id) : [];
  const others = site.services.filter((s) => s.id !== service.id).slice(0, 6);
  const links: NavLink[] = [{ href: '/', label: 'الرئيسية' }, { href: '/#services', label: 'كل الخدمات' }];
  const crumbs = [{ name, url: `${origin}/` }, { name: title, url: `${origin}/services/${service.id}` }];
  const faqList = faqItems(faqs);
  // the tinted background alternates over the sections this page has
  const parts = [doctors.length > 0 && 'doctors', cases.length > 0 && 'cases', faqList.length > 0 && 'faq'].filter(Boolean);
  const tint = (k: string) => parts.indexOf(k) % 2 === 0;

  return (
    <div className="site" id="top" style={brandStyle(site)}>
      <a className="s-skip" href="#main">تخطَّ إلى المحتوى</a>
      <ClinicHeader name={name} logo={site.clinic.logo} links={links} contact={contact} />
      <main id="main">
        <section className="s-section s-svc-page" aria-labelledby="svc-t">
          <div className="s-wrap">
            <nav className="s-crumbs" aria-label="مسار الصفحة">
              <a href="/">الرئيسية</a><span aria-hidden>›</span><a href="/#services">الخدمات</a><span aria-hidden>›</span><span aria-current="page"><bdi>{title}</bdi></span>
            </nav>
            <div className={`s-svc-hero${service.image ? ' has-media' : ''}`}>
              <div>
                <h1 id="svc-t"><bdi>{title}</bdi></h1>
                {desc && <p className="s-lead s-svc-desc">{desc}</p>}
                <dl className="s-svc-facts">
                  <div><dt>السعر</dt><dd>{priceText(service.price_minor, service.price_max_minor, site.clinic.currency)}</dd></div>
                  <div><dt>المدة المتوقعة</dt><dd><Clock size={16} /> {service.duration_minutes} {arNoun(service.duration_minutes, NOUNS.minute)}</dd></div>
                </dl>
                {book && (
                  <a className="s-btn s-btn-lg" href={book.href}>
                    {book.via === 'online' ? <Icon name="calendar" size={18} /> : book.via === 'whatsapp' ? <Chat size={18} /> : <Phone />}احجز هذه الخدمة
                  </a>
                )}
                <p className="s-svc-note">الأسعار تقديرية وقد تختلف حسب الفحص وخطة العلاج.</p>
              </div>
              {service.image && <img className="s-svc-img" {...imageProps(service.image, 960)} sizes="(max-width: 900px) 100vw, 480px" alt="" />}
            </div>
          </div>
        </section>

        {doctors.length > 0 && (
          <Section id="doctors" kicker="فريقنا" title="أطباء يقدمون هذه الخدمة" tint={tint('doctors')}>
            <div className="s-grid s-grid-doctors">
              {doctors.map((d) => <DoctorCard key={d.id} doctor={d} contact={contact} clinicName={name} />)}
            </div>
          </Section>
        )}
        <GallerySection photos={[]} cases={cases} clinicName={name} tint={tint('cases')} />
        <FaqSection faqs={faqs} tint={tint('faq')} />
        {others.length > 0 && (
          <section className="s-section s-svc-others" aria-labelledby="others-t">
            <div className="s-wrap">
              <h2 id="others-t">خدمات أخرى</h2>
              <ul>{others.map((s) => <li key={s.id}><a href={`/services/${s.id}`}><bdi>{ar(s.name_ar, s.name_en)}</bdi></a></li>)}</ul>
            </div>
          </section>
        )}
        <AppointmentCTA contact={contact} />
      </main>
      <ClinicFooter site={site} name={name} about={about} links={links} contact={contact} />
      <MobileBookingBar contact={contact} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(serviceStructuredData(service, site, origin)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData(crumbs)) }} />
      {faqList.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqStructuredData(faqList)) }} />}
    </div>
  );
}
