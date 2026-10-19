import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { onColor, readableOnWhite } from '@dental/ui/text';
import { BookingWizard } from '../../../../components/site/booking/wizard';
import { contactFor } from '../../../../components/site/contact';
import { ClinicHeader } from '../../../../components/site/header';
import { getBookingOptions } from '../../../../lib/booking';
import { ar, getSite, safeColor } from '../../../../lib/site';

type Props = { params: Promise<{ host: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const hostOf = async (params: Props['params']) => decodeURIComponent((await params).host);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await getSite(await hostOf(params));
  if (!site) return {};
  const name = ar(site.clinic.name_ar, site.clinic.name_en) ?? site.clinic.slug;
  return { title: `احجز موعدك | ${name}`, description: `اختر الخدمة والطبيب والوقت المناسب واحجز موعدك في ${name} خلال دقيقة.`, robots: { index: false } };
}

function brandStyle(primary?: string): CSSProperties {
  const brand = safeColor(primary);
  return { '--brand': brand, '--on-brand': onColor(brand), '--brand-text': readableOnWhite(brand) } as CSSProperties;
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
    <div className="site" id="top" style={brandStyle(site.theme.primary)}>
      <ClinicHeader name={name} links={[{ href: '/', label: 'الرئيسية' }]} contact={contact} />
      <main id="main" className="s-wrap bk-page">
        <header className="bk-head">
          <h1>احجز موعدك</h1>
          <p>اختر الخدمة والوقت المناسب، وسيصلك رمز حضور تُظهره في الاستقبال.</p>
        </header>
        <BookingWizard options={options} clinicName={name} currency={site.clinic.currency} preset={{ service: one(sp.service), doctor: one(sp.doctor) }} />
      </main>
    </div>
  );
}
