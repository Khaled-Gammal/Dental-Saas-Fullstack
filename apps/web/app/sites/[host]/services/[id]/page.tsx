import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Chat, Clock, Icon } from '../../../../../components/icons';
import { contactFor } from '../../../../../components/site/contact';
import { AppointmentCTA, MobileBookingBar } from '../../../../../components/site/cta';
import { ArchVisual, Section } from '../../../../../components/site/decor';
import { DoctorsSection } from '../../../../../components/site/doctors';
import { FaqSection, faqItems } from '../../../../../components/site/faq';
import { ClinicFooter } from '../../../../../components/site/footer';
import { GallerySection } from '../../../../../components/site/gallery';
import { ClinicHeader } from '../../../../../components/site/header';
import type { NavLink } from '../../../../../components/site/menu';
import { ServiceCard, serviceBooking, serviceIcon, viaIcon } from '../../../../../components/site/services';
import { bentoCells } from '../../../../../lib/display';
import { imageProps } from '../../../../../lib/media';
import { faqStructuredData, visibleSections } from '../../../../../lib/sections';
import { breadcrumbData, clinicName, jsonLd, serviceDescription, serviceStructuredData, serviceTitle, shareImagePath } from '../../../../../lib/seo';
import { ar, arNoun, getSite, NOUNS, originOf, priceText } from '../../../../../lib/site';
import { brandStyle } from '../../../../../lib/theme';

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
  // the wizard with this service chosen when it offers it; otherwise WhatsApp or a call
  const book = serviceBooking(service, contact, name);
  // only what the clinic shows on its site (its sections)
  const doctors = shown.includes('doctors') ? site.doctors.filter((d) => service.doctor_ids?.includes(d.id)) : [];
  const cases = shown.includes('gallery') ? site.cases.filter((c) => c.service_id === service.id) : [];
  const faqs = shown.includes('faq') ? site.faqs.filter((f) => f.service_id === service.id) : [];
  const others = site.services.filter((s) => s.id !== service.id).slice(0, 6);
  const links: NavLink[] = [{ href: '/', label: 'الرئيسية' }, { href: '/#services', label: 'كل الخدمات' }];
  const crumbs = [{ name, url: `${origin}/` }, { name: title, url: `${origin}/services/${service.id}` }];
  const faqList = faqItems(faqs);
  // the tinted panel alternates over the sections this page has
  const parts = [doctors.length > 0 && 'doctors', cases.length > 0 && 'cases', faqList.length > 0 && 'faq', others.length > 0 && 'others'].filter(Boolean);
  const tint = (k: string) => parts.indexOf(k) % 2 === 0;
  const secondary = contact.whatsapp && book?.via !== 'whatsapp' ? contact.whatsapp : null;
  const cells = bentoCells(others.length);

  return (
    <div className="c-site" id="top" style={brandStyle(site.theme.primary)}>
      <a className="c-skip" href="#main">تخطَّ إلى المحتوى</a>
      <ClinicHeader name={name} logo={site.clinic.logo} links={links} contact={contact} home="/" />
      <main id="main">
        <section className="c-hero c-svc-hero" aria-labelledby="svc-t">
          <div className="c-wrap">
            <nav className="c-crumbs" aria-label="مسار الصفحة">
              <a href="/">الرئيسية</a><Icon name="chevronDown" size={14} className="c-crumb-sep" /><a href="/#services">الخدمات</a>
              <Icon name="chevronDown" size={14} className="c-crumb-sep" /><span aria-current="page"><bdi>{title}</bdi></span>
            </nav>
            <div className="c-hero-grid">
              <div className="c-hero-copy">
                <span className="c-kicker c-hero-in"><Icon name={serviceIcon(service.category)} size={16} />خدمة في <bdi>{name}</bdi></span>
                <h1 id="svc-t" className="c-display c-svc-title c-hero-in"><bdi>{title}</bdi></h1>
                {desc && <p className="c-lead c-svc-desc c-hero-in">{desc}</p>}
                <dl className="c-svc-facts c-hero-in">
                  <div><dt><Icon name="tag" size={16} />السعر</dt><dd>{priceText(service.price_minor, service.price_max_minor, site.clinic.currency)}</dd></div>
                  <div><dt><Clock size={16} />المدة المتوقعة</dt><dd>{service.duration_minutes} {arNoun(service.duration_minutes, NOUNS.minute)}</dd></div>
                  {doctors.length > 0 && <div><dt><Icon name="user" size={16} />يقدمها</dt><dd>{doctors.length} {arNoun(doctors.length, NOUNS.doctor)}</dd></div>}
                </dl>
                {(book || secondary) && (
                  <div className="c-hero-cta c-hero-in">
                    {book && <a className="c-btn c-btn-lg c-btn-arrow" href={book.href}>{viaIcon(book.via, 20)}احجز هذه الخدمة<span className="c-btn-bubble" aria-hidden><Icon name="arrow" size={18} /></span></a>}
                    {secondary && <a className="c-btn c-btn-lg c-btn-ghost" href={secondary}><Chat size={20} />اسأل عبر واتساب</a>}
                  </div>
                )}
                <p className="c-svc-note c-hero-in">الأسعار تقديرية وقد تختلف حسب الفحص وخطة العلاج.</p>
              </div>
              <ArchVisual plain={!service.image}>
                {service.image
                  ? <img {...imageProps(service.image, 960)} sizes="(max-width: 900px) 90vw, 440px" alt="" fetchPriority="high" />
                  : <Icon name={serviceIcon(service.category)} size={132} strokeWidth={1.1} />}
              </ArchVisual>
            </div>
          </div>
        </section>

        <DoctorsSection doctors={doctors} contact={contact} clinicName={name} tint={tint('doctors')} title="أطباء يقدمون هذه الخدمة" sub="احجز مع الطبيب الذي تفضّله مباشرة." />
        <GallerySection photos={[]} cases={cases} clinicName={name} tint={tint('cases')} />
        <FaqSection faqs={faqs} contact={contact} tint={tint('faq')} />
        {others.length > 0 && (
          <Section id="others" kicker="خدمات أخرى" title="قد يهمك أيضًا" tint={tint('others')}
            action={<a className="c-btn c-btn-sm c-btn-ghost" href="/#services">كل الخدمات<Icon name="arrow" size={16} /></a>}>
            <div className="c-bento">
              {others.map((s, i) => <ServiceCard key={s.id} service={s} contact={contact} clinicName={name} currency={site.clinic.currency} cell={cells[i]} />)}
            </div>
          </Section>
        )}
        <AppointmentCTA contact={contact} />
      </main>
      <ClinicFooter site={site} name={name} about={about} links={links} contact={contact} />
      <MobileBookingBar contact={contact} book={book ? { href: book.href, label: 'احجز هذه الخدمة', icon: viaIcon(book.via, 18) } : null} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(serviceStructuredData(service, site, origin)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData(crumbs)) }} />
      {faqList.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqStructuredData(faqList)) }} />}
    </div>
  );
}
