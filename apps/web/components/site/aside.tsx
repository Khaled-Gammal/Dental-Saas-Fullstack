import { Chat, Phone, Pin } from '../icons';
import { ar, DEFAULT_TZ, type SiteData } from '../../lib/site';
import type { Contact } from './contact';
import { ToothBadge } from './decor';
import { LiveStatus } from './live-status';

/**
 * The booking pages' side card: the clinic's main branch (address and its status now) and its own channels, for a
 * visitor who would rather ask than pick a time online. Nothing when the clinic publishes neither.
 */
export function HelpCard({ site, contact }: { site: SiteData; contact: Contact }) {
  const main = site.branches[0];
  const address = main ? ar(main.address_ar, main.address_en) : null;
  if (!contact.tel && !contact.whatsapp && !address) return null;
  return (
    <aside className="c-help-card" aria-label="مساعدة في الحجز">
      <ToothBadge />
      <strong>تحتاج مساعدة في الحجز؟</strong>
      <p>اتصل بنا أو راسلنا على واتساب لاختيار الوقت المناسب لك.</p>
      {main && main.hours.length > 0 && (
        <LiveStatus hours={main.hours} holidays={site.holidays} branchId={main.id} tz={main.timezone ?? site.clinic.timezone ?? DEFAULT_TZ} renderedAt={Date.now()} />
      )}
      {address && <p className="c-help-addr"><Pin size={18} /><span><bdi>{address}</bdi>{main?.city && <>، <bdi>{main.city}</bdi></>}</span></p>}
      {(contact.whatsapp || contact.tel) && (
        <div className="c-help-actions">
          {contact.whatsapp && <a className="c-btn c-btn-sm c-btn-soft" href={contact.whatsapp}><Chat size={18} />واتساب</a>}
          {contact.tel && <a className="c-btn c-btn-sm c-btn-ghost" href={contact.tel}><Phone size={18} /><bdi dir="ltr">{contact.phone}</bdi></a>}
        </div>
      )}
    </aside>
  );
}
