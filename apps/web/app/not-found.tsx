import type { Metadata } from 'next';
import { ToothBadge } from '../components/site/decor';

export const metadata: Metadata = { title: 'الصفحة غير موجودة', robots: { index: false } };

/** Any address with no page (L10N-001: in Arabic, instead of the framework's English default). */
export default function PageNotFound() {
  return (
    <div className="c-site">
      <main className="c-wrap c-state">
        <ToothBadge />
        <h1>الصفحة غير موجودة</h1>
        <p>ربما تغيّر الرابط أو كُتب بشكل خاطئ.</p>
        <a className="c-btn" href="/">العودة إلى الصفحة الرئيسية</a>
      </main>
    </div>
  );
}
