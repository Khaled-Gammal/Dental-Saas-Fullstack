import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { CSSProperties } from 'react';
import { onColor, readableOnWhite } from '@dental/ui/text';
import { Tooth } from '../../../../../components/icons';
import { contactFor } from '../../../../../components/site/contact';
import { ClinicHeader } from '../../../../../components/site/header';
import { ManageAppointment } from '../../../../../components/site/manage/manage';
import { clientIp } from '../../../../../lib/client-ip';
import { getManageView } from '../../../../../lib/manage';
import { ar, getSite, safeColor } from '../../../../../lib/site';

type Props = { params: Promise<{ host: string; token: string }> };

/** The link is the patient's key: never indexed, never sent on as a referrer, never cached. */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'موعدك', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Phase 2E: the patient's own page for their booking, from the link in the confirmation and reminder emails: see it,
 * cancel it, or pick another time with the same doctor — up to the clinic's deadline before the visit.
 */
export default async function ManagePage({ params }: Props) {
  const { host: raw, token } = await params;
  const host = decodeURIComponent(raw);
  const [view, site] = await Promise.all([getManageView(host, token, clientIp(await headers())), getSite(host)]);
  const name = (site && (ar(site.clinic.name_ar, site.clinic.name_en) ?? site.clinic.slug)) || (view && view !== 'busy' ? view.clinic.name : null) || '';
  const brand = safeColor(site?.theme.primary);
  const style = { '--brand': brand, '--on-brand': onColor(brand), '--brand-text': readableOnWhite(brand) } as CSSProperties;
  const contact = site ? contactFor(site.clinic, name, site.onlineBooking) : null;

  return (
    <div className="site" id="top" style={style}>
      {contact && <ClinicHeader name={name} logo={site?.clinic.logo} links={[{ href: '/', label: 'الرئيسية' }]} contact={contact} />}
      <main id="main" className="s-wrap bk-page">
        {view === 'busy' ? (
          <div className="s-state">
            <span className="s-state-icon" aria-hidden><Tooth size={32} /></span>
            <h1>لحظة من فضلك</h1>
            <p>طلبات كثيرة من نفس الشبكة. انتظر دقيقة ثم أعد فتح الرابط.</p>
          </div>
        ) : view ? (
          <>
            <header className="bk-head">
              <h1>موعدك{name && <> في <bdi>{name}</bdi></>}</h1>
              <p>يمكنك من هنا إلغاء الموعد أو اختيار وقت آخر مع نفس الطبيب.</p>
            </header>
            <ManageAppointment token={token} initial={view} bookUrl={contact?.bookUrl} />
          </>
        ) : (
          <div className="s-state">
            <span className="s-state-icon" aria-hidden><Tooth size={32} /></span>
            <h1>هذا الرابط غير صالح</h1>
            <p>تأكد من فتح الرابط كما وصلك في البريد الإلكتروني، أو تواصل مع العيادة.</p>
            {site && <a className="s-btn s-btn-ghost" href="/">العودة إلى الموقع</a>}
          </div>
        )}
      </main>
    </div>
  );
}
