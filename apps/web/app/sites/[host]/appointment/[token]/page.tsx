import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Sparkle } from '../../../../../components/icons';
import { HelpCard } from '../../../../../components/site/aside';
import { contactFor } from '../../../../../components/site/contact';
import { ToothBadge } from '../../../../../components/site/decor';
import { ClinicHeader } from '../../../../../components/site/header';
import { ManageAppointment } from '../../../../../components/site/manage/manage';
import { clientIp } from '../../../../../lib/client-ip';
import { getManageView } from '../../../../../lib/manage';
import { ar, getSite } from '../../../../../lib/site';
import { brandStyle } from '../../../../../lib/theme';

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
  const contact = site ? contactFor(site.clinic, name, site.onlineBooking) : null;

  return (
    <div className="c-site" id="top" style={brandStyle(site?.theme.primary)}>
      {contact && <ClinicHeader name={name} logo={site?.clinic.logo} links={[{ href: '/', label: 'الرئيسية' }]} contact={contact} home="/" />}
      <main id="main" className="c-page">
        {view === 'busy' ? (
          <div className="c-wrap c-state">
            <ToothBadge />
            <h1>لحظة من فضلك</h1>
            <p>طلبات كثيرة من نفس الشبكة. انتظر دقيقة ثم أعد فتح الرابط.</p>
          </div>
        ) : view ? (
          <div className="c-wrap c-page-grid">
            <div className="c-page-main">
              <header className="c-page-head">
                <span className="c-kicker"><Sparkle size={11} />موعدك</span>
                <h1>موعدك{name && <> في <bdi>{name}</bdi></>}</h1>
                <p>يمكنك من هنا إلغاء الموعد أو اختيار وقت آخر مع نفس الطبيب.</p>
              </header>
              <ManageAppointment token={token} initial={view} bookUrl={contact?.bookUrl} />
            </div>
            {site && contact && <HelpCard site={site} contact={contact} />}
          </div>
        ) : (
          <div className="c-wrap c-state">
            <ToothBadge />
            <h1>هذا الرابط غير صالح</h1>
            <p>تأكد من فتح الرابط كما وصلك في البريد الإلكتروني، أو تواصل مع العيادة.</p>
            {site && <a className="c-btn c-btn-ghost" href="/">العودة إلى الموقع</a>}
          </div>
        )}
      </main>
    </div>
  );
}
