import type { Metadata } from 'next';
import { Tooth } from '../../../components/icons';

export const metadata: Metadata = { title: 'لا توجد عيادة على هذا العنوان', robots: { index: false } };

/** An address that belongs to no live clinic (never registered, suspended, or a domain not yet verified). */
export default function ClinicNotFound() {
  return (
    <div className="site">
      <main className="s-wrap s-state">
        <span className="s-state-icon" aria-hidden><Tooth size={32} /></span>
        <h1>لا توجد عيادة على هذا العنوان</h1>
        <p>تأكد من كتابة العنوان بشكل صحيح، أو تواصل مع العيادة للحصول على رابط موقعها.</p>
        <p className="s-muted" lang="en" dir="ltr">There is no clinic website at this address.</p>
      </main>
    </div>
  );
}
