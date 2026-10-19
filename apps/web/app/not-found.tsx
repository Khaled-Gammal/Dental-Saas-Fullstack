import type { Metadata } from 'next';
import { Tooth } from '../components/icons';

export const metadata: Metadata = { title: 'الصفحة غير موجودة', robots: { index: false } };

/** Any address with no page (L10N-001: in Arabic, instead of the framework's English default). */
export default function PageNotFound() {
  return (
    <div className="site">
      <main className="s-wrap s-state">
        <span className="s-state-icon" aria-hidden><Tooth size={32} /></span>
        <h1>الصفحة غير موجودة</h1>
        <p>ربما تغيّر الرابط أو كُتب بشكل خاطئ.</p>
        <a className="s-btn" href="/">العودة إلى الصفحة الرئيسية</a>
      </main>
    </div>
  );
}
