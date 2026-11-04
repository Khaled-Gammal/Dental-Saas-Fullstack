import type { Metadata } from 'next';
import { ToothBadge } from '../../../components/site/decor';

export const metadata: Metadata = { title: 'لا توجد عيادة على هذا العنوان', robots: { index: false } };

/** An address that belongs to no live clinic (never registered, suspended, or a domain not yet verified). */
export default function ClinicNotFound() {
  return (
    <div className="c-site">
      <main className="c-wrap c-state">
        <ToothBadge />
        <h1>لا توجد عيادة على هذا العنوان</h1>
        <p>تأكد من كتابة العنوان بشكل صحيح، أو تواصل مع العيادة للحصول على رابط موقعها.</p>
      </main>
    </div>
  );
}
