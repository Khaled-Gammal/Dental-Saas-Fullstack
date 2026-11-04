import { Tooth } from '../icons';
import { MobileMenu, type NavLink } from '../site/menu';

/** The landing page's floating header bar (the clinic sites' design): sections, sign-in, and the free start. */
export function LandingHeader({ brand, links, signupUrl, loginUrl, trial }: { brand: string; links: NavLink[]; signupUrl: string; loginUrl: string; trial: number }) {
  return (
    <header className="c-nav">
      <div className="c-nav-bar">
        <a href="#top" className="c-brand"><span className="c-mark" aria-hidden><Tooth size={22} /></span><bdi>{brand}</bdi></a>
        <nav className="c-links" aria-label="أقسام الصفحة">
          {links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        </nav>
        <div className="c-nav-actions">
          <a className="c-btn c-btn-sm c-btn-ghost l-nav-login" href={loginUrl}>دخول</a>
          <a className="c-btn c-btn-sm c-nav-cta" href={signupUrl}>ابدأ مجانًا</a>
          <MobileMenu links={links} actions={[{ href: signupUrl, label: trial > 0 ? `ابدأ تجربتك المجانية (${trial} يومًا)` : 'أنشئ حساب عيادتك' }, { href: loginUrl, label: 'دخول' }]} />
        </div>
      </div>
    </header>
  );
}
