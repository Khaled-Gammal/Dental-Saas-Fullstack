import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HelpCard } from '../../../../components/site/aside';
import { BookingWizard } from '../../../../components/site/booking/wizard';
import { contactFor } from '../../../../components/site/contact';
import { ClinicHeader } from '../../../../components/site/header';
import { Sparkle } from '../../../../components/icons';
import { getBookingOptions } from '../../../../lib/booking';
import { ar, getSite } from '../../../../lib/site';
import { brandStyle } from '../../../../lib/theme';

type Props = { params: Promise<{ host: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const hostOf = async (params: Props['params']) => decodeURIComponent((await params).host);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await getSite(await hostOf(params));
  if (!site) return {};
  const name = ar(site.clinic.name_ar, site.clinic.name_en) ?? site.clinic.slug;
  return { title: `احجز موعدك | ${name}`, description: `اختر الخدمة والطبيب والوقت المناسب واحجز موعدك في ${name} خلال دقيقة.`, robots: { index: false } };
}

/** The booking wizard page. Options are fetched on the server (never cached: holds change availability by the minute). */
export default async function BookPage({ params, searchParams }: Props) {
  const host = await hostOf(params);
  const [site, options, sp] = await Promise.all([getSite(host), getBookingOptions(host), searchParams]);
  const one = (v: string | string[] | undefined) => (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);
  if (!site || !options) notFound();
  const name = ar(site.clinic.name_ar, site.clinic.name_en) ?? site.clinic.slug;
  const contact = contactFor(site.clinic, name, site.onlineBooking);
  return (
    <div className="c-site" id="top" style={brandStyle(site.theme.primary)}>
      <a className="c-skip" href="#main">تخطَّ إلى المحتوى</a>
      <ClinicHeader name={name} logo={site.clinic.logo} links={[{ href: '/', label: 'الرئيسية' }]} contact={contact} home="/" book={false} />
      <main id="main" className="c-page">
        <div className="c-wrap c-page-grid">
          <div className="c-page-main">
            <header className="c-page-head">
              <span className="c-kicker"><Sparkle size={11} />حجز أونلاين</span>
              <h1>احجز موعدك</h1>
              <p>اختر الخدمة والوقت المناسب، وسيصلك رمز حضور تُظهره في الاستقبال.</p>
            </header>
            <BookingWizard options={options} clinicName={name} currency={site.clinic.currency} preset={{ service: one(sp.service), doctor: one(sp.doctor) }} />
          </div>
          <HelpCard site={site} contact={contact} />
        </div>
      </main>
    </div>
  );
}
