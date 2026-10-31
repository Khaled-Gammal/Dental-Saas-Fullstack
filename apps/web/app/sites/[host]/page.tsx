import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { onColor, readableOnWhite } from '@dental/ui/text';
import { BranchesSection } from '../../../components/site/branches';
import { contactFor } from '../../../components/site/contact';
import { AppointmentCTA, MobileBookingBar } from '../../../components/site/cta';
import { DoctorsSection } from '../../../components/site/doctors';
import { FaqSection, faqItems } from '../../../components/site/faq';
import { GallerySection } from '../../../components/site/gallery';
import { ClinicFooter } from '../../../components/site/footer';
import { ClinicHeader } from '../../../components/site/header';
import { HeroSection } from '../../../components/site/hero';
import type { NavLink } from '../../../components/site/mobile-nav';
import { ServicesSection } from '../../../components/site/services';
import { TrustIndicators } from '../../../components/site/trust';
import { hhmm } from '../../../lib/hours';
import { faqStructuredData, visibleSections, type SectionKey } from '../../../lib/sections';
import { homeDescription, homeTitle, jsonLd, shareImagePath } from '../../../lib/seo';
import { ar, DEFAULT_TZ, getSite, originOf, safeColor, type SiteData } from '../../../lib/site';

type Props = { params: Promise<{ host: string }> };

const hostOf = async (params: Props['params']) => decodeURIComponent((await params).host);
const clinicName = (site: SiteData) => ar(site.clinic.name_ar, site.clinic.name_en) ?? site.clinic.slug;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = await hostOf(params);
  const site = await getSite(host);
  if (!site) return {};
  const name = clinicName(site);
  // Phase 2C-3: the clinic's own search title and description when it wrote them; the share image made by the API
  const title = homeTitle(site);
  const description = homeDescription(site);
  const image = { url: shareImagePath(site), width: 1200, height: 630, alt: name };
  return {
    metadataBase: new URL(originOf(host)),
    title,
    description,
    alternates: { canonical: '/' },
    openGraph: { type: 'website', locale: 'ar_EG', siteName: name, title, description, url: '/', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
    robots: { index: true, follow: true },
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const site = await getSite(await hostOf(params));
  return { themeColor: safeColor(site?.theme.primary), width: 'device-width', initialScale: 1 };
}

/** Brand colour plus the two derived colours that keep text readable on any colour the clinic picks. */
function brandStyle(primary?: string): CSSProperties {
  const brand = safeColor(primary);
  return { '--brand': brand, '--on-brand': onColor(brand), '--brand-text': readableOnWhite(brand) } as CSSProperties;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** schema.org Dentist from published business facts only (name, phone, main branch address and hours). No medical claims. */
function structuredData(site: SiteData, name: string, url: string) {
  const main = site.branches[0];
  const address = main ? ar(main.address_ar, main.address_en) : null;
  const hours = main?.hours.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_NAMES[h.weekday], opens: hhmm(h.opens_at), closes: hhmm(h.closes_at) }));
  return {
    '@context': 'https://schema.org',
    '@type': 'Dentist',
    name,
    url,
    description: ar(site.clinic.about_ar, site.clinic.about_en) ?? undefined,
    telephone: site.clinic.primary_phone ?? undefined,
    address: main && (address || main.city) ? { '@type': 'PostalAddress', streetAddress: address ?? undefined, addressLocality: main.city ?? undefined } : undefined,
    geo: main && main.latitude != null && main.longitude != null ? { '@type': 'GeoCoordinates', latitude: main.latitude, longitude: main.longitude } : undefined,
    openingHoursSpecification: hours?.length ? hours : undefined,
  };
}

export default async function ClinicSite({ params }: Props) {
  const host = await hostOf(params);
  const site = await getSite(host);
  if (!site) notFound();
  const { clinic, services, doctors, branches, holidays, photos } = site;
  const cases = site.cases.filter((c) => c.on_home !== false); // the first 12; the rest are for the service pages (Phase 2C-3)
  const name = clinicName(site);
  const about = ar(clinic.about_ar, clinic.about_en);
  const contact = contactFor(clinic, name, site.onlineBooking);
  const faqs = faqItems(site.faqs);
  // Phase 2C-1: the sections the clinic shows, in its order, each only when it has something to show; the tinted
  // background alternates down the page whatever the order
  const has: Record<SectionKey, boolean> = {
    services: services.length > 0, doctors: doctors.length > 0, gallery: photos.length > 0 || cases.length > 0, faq: faqs.length > 0, branches: branches.length > 0,
  };
  const shown = visibleSections(site.sections).filter((k) => has[k]);
  const LABEL: Record<SectionKey, string> = { services: 'الخدمات', doctors: 'الأطباء', gallery: 'المعرض', faq: 'الأسئلة الشائعة', branches: 'الفروع والمواعيد' };
  const links: NavLink[] = shown.map((k) => ({ href: `#${k}`, label: LABEL[k] }));
  const section = (k: SectionKey, i: number) => {
    const tint = i % 2 === 1;
    switch (k) {
      case 'services': return <ServicesSection key={k} services={services} contact={contact} clinicName={name} currency={site.clinic.currency} tint={tint} />;
      case 'doctors': return <DoctorsSection key={k} doctors={doctors} contact={contact} clinicName={name} tint={tint} />;
      case 'gallery': return <GallerySection key={k} photos={photos} cases={cases} clinicName={name} tint={tint} />;
      case 'faq': return <FaqSection key={k} faqs={site.faqs} tint={tint} />;
      case 'branches': return <BranchesSection key={k} branches={branches} holidays={holidays} clinicTz={clinic.timezone ?? DEFAULT_TZ} contact={contact} clinicName={name} tint={tint} />;
    }
  };
  const ld = jsonLd(structuredData(site, name, originOf(host)));
  // a question about one service is marked up on that service's page, not twice (Phase 2C-3)
  const generalFaqs = faqItems(site.faqs.filter((f) => !f.service_id || !shown.includes('services')));
  const faqLd = shown.includes('faq') && generalFaqs.length ? jsonLd(faqStructuredData(generalFaqs)) : null;

  return (
    <div className="site" id="top" style={brandStyle(site.theme.primary)}>
      <a className="s-skip" href="#main">تخطَّ إلى المحتوى</a>
      <ClinicHeader name={name} logo={clinic.logo} links={links} contact={contact} />
      <main id="main">
        <HeroSection site={site} name={name} about={about} contact={contact} servicesShown={shown.includes('services')} />
        <TrustIndicators site={site} contact={contact} />
        {shown.map(section)}
        <AppointmentCTA contact={contact} />
      </main>
      <ClinicFooter site={site} name={name} about={about} links={links} contact={contact} />
      <MobileBookingBar contact={contact} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      {faqLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqLd }} />}
    </div>
  );
}
