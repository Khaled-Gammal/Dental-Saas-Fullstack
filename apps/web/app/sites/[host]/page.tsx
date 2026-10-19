import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { onColor, readableOnWhite } from '@dental/ui/text';
import { BranchesSection } from '../../../components/site/branches';
import { contactFor } from '../../../components/site/contact';
import { AppointmentCTA, MobileBookingBar } from '../../../components/site/cta';
import { DoctorsSection } from '../../../components/site/doctors';
import { ClinicFooter } from '../../../components/site/footer';
import { ClinicHeader } from '../../../components/site/header';
import { HeroSection } from '../../../components/site/hero';
import type { NavLink } from '../../../components/site/mobile-nav';
import { ServicesSection } from '../../../components/site/services';
import { TrustIndicators } from '../../../components/site/trust';
import { hhmm } from '../../../lib/hours';
import { ar, DEFAULT_TZ, getSite, originOf, safeColor, type SiteData } from '../../../lib/site';

type Props = { params: Promise<{ host: string }> };

const hostOf = async (params: Props['params']) => decodeURIComponent((await params).host);
const clinicName = (site: SiteData) => ar(site.clinic.name_ar, site.clinic.name_en) ?? site.clinic.slug;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = await hostOf(params);
  const site = await getSite(host);
  if (!site) return {};
  const name = clinicName(site);
  const description = ar(site.clinic.about_ar, site.clinic.about_en) ?? `احجز موعدك في ${name}: خدمات أسنان بأسعار واضحة، أطباء متخصصون ومواعيد عمل محدّثة.`;
  return {
    metadataBase: new URL(originOf(host)),
    title: `${name} | عيادة أسنان`,
    description,
    alternates: { canonical: '/' },
    openGraph: { type: 'website', locale: 'ar_EG', siteName: name, title: name, description, url: '/' },
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
  const { clinic, services, doctors, branches, holidays } = site;
  const name = clinicName(site);
  const about = ar(clinic.about_ar, clinic.about_en);
  const contact = contactFor(clinic, name, site.onlineBooking);
  const links: NavLink[] = [
    services.length > 0 && { href: '#services', label: 'الخدمات' },
    doctors.length > 0 && { href: '#doctors', label: 'الأطباء' },
    branches.length > 0 && { href: '#branches', label: 'الفروع والمواعيد' },
  ].filter((l): l is NavLink => Boolean(l));
  const ld = JSON.stringify(structuredData(site, name, originOf(host))).replace(/</g, '\\u003c');

  return (
    <div className="site" id="top" style={brandStyle(site.theme.primary)}>
      <a className="s-skip" href="#main">تخطَّ إلى المحتوى</a>
      <ClinicHeader name={name} logo={clinic.logo} links={links} contact={contact} />
      <main id="main">
        <HeroSection site={site} name={name} about={about} contact={contact} />
        <TrustIndicators site={site} contact={contact} />
        <ServicesSection services={services} contact={contact} clinicName={name} currency={site.clinic.currency} />
        <DoctorsSection doctors={doctors} contact={contact} clinicName={name} />
        <BranchesSection branches={branches} holidays={holidays} clinicTz={clinic.timezone ?? DEFAULT_TZ} contact={contact} clinicName={name} />
        <AppointmentCTA contact={contact} />
      </main>
      <ClinicFooter site={site} name={name} about={about} links={links} contact={contact} />
      <MobileBookingBar contact={contact} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
    </div>
  );
}
