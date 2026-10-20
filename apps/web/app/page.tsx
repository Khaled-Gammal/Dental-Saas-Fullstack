import type { Metadata } from 'next';
import { Icon, Tooth } from '../components/icons';
import { LeadFormCard } from '../components/landing/lead-form';
import { Pricing } from '../components/landing/pricing';
import { ToothArt, Section } from '../components/site/decor';
import { MobileNav, type NavLink } from '../components/site/mobile-nav';
import { BRAND, getPlans, trialDays } from '../lib/landing';
import { FEATURES, HERO, WEBSITE, faqs } from '../lib/landing-content';

export const revalidate = 300; // the plans: an edit in the platform panel shows here within five minutes

export const metadata: Metadata = {
  title: `${BRAND} — نظام إدارة وموقع إلكتروني لعيادتك`,
  description: HERO.lead,
};

const LINKS: NavLink[] = [
  { href: '#features', label: 'المزايا' },
  { href: '#pricing', label: 'الأسعار' },
  { href: '#faq', label: 'الأسئلة الشائعة' },
  { href: '#contact', label: 'تواصل معنا' },
];

/**
 * The platform's landing page (H7; LND-01, LND-02, LND-04), on the root domain (middleware.ts). Arabic only (L10N-001).
 * Sign-up and sign-in happen in the dashboard; the legal documents are read there too (#/legal/<kind>).
 */
export default async function Landing() {
  const dashboard = process.env.DASHBOARD_URL ?? '';
  const signupUrl = `${dashboard}/#/signup`;
  const loginUrl = `${dashboard}/`;
  const legal = (kind: string) => `${dashboard}/#/legal/${kind}`;
  const demoSite = process.env.DEMO_SITE_URL || null;
  const plans = await getPlans();
  const trial = trialDays(plans);
  const questions = faqs(trial);

  return (
    <div className="site" id="top">
      <a className="s-skip" href="#main">تخطَّ إلى المحتوى</a>
      <header className="s-nav">
        <div className="s-wrap s-nav-in">
          <a href="#top" className="s-brand"><span className="s-mark"><Tooth /></span><bdi>{BRAND}</bdi></a>
          <nav className="s-links" aria-label="أقسام الصفحة">
            {LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
          </nav>
          <a className="s-btn s-btn-sm s-btn-ghost s-nav-cta" href={loginUrl}>دخول</a>
          <a className="s-btn s-btn-sm s-nav-cta" href={signupUrl}>ابدأ مجانًا</a>
          <MobileNav links={LINKS} actions={[{ href: signupUrl, label: 'ابدأ التجربة المجانية' }, { href: loginUrl, label: 'دخول' }]} />
        </div>
      </header>

      <main id="main">
        <section className="s-hero" aria-labelledby="hero-t">
          <div className="s-hero-bg" aria-hidden><span /><span /><span /></div>
          <div className="s-wrap s-hero-in">
            <div className="s-hero-text">
              <span className="s-eyebrow"><Tooth size={16} />{HERO.eyebrow}</span>
              <h1 id="hero-t">{HERO.title}</h1>
              <p className="s-lead">{HERO.lead}</p>
              <div className="s-cta">
                <a className="s-btn s-btn-lg" href={signupUrl}>{trial > 0 ? `جرّبه مجانًا ${trial} يومًا` : 'أنشئ حساب عيادتك'}</a>
                <a className="s-btn s-btn-lg s-btn-ghost" href="#contact">اطلب اتصالًا</a>
              </div>
              <ul className="s-chips" aria-label="باختصار">
                {HERO.points.map((p) => <li key={p} className="s-chip"><Icon name="check" size={14} />{p}</li>)}
              </ul>
            </div>
            <div className="s-hero-art" data-reveal>
              <div className="s-art">
                <ToothArt />
                <span className="s-float s-float-a"><Icon name="calendar" size={16} />حجز أونلاين من موقع العيادة</span>
                <span className="s-float s-float-b"><Icon name="shield" size={16} />صلاحيات لكل موظف</span>
                <span className="s-float s-float-c"><Icon name="user" size={16} />ملف كامل لكل مريض</span>
              </div>
            </div>
          </div>
        </section>

        <Section id="features" kicker="المزايا" title="كل ما تحتاجه العيادة يوميًا" sub="من استقبال المريض حتى تقرير آخر الشهر، بنظام واحد يعمل عليه فريقك كله.">
          <div className="s-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="s-card" data-reveal>
                <span className="s-service-icon"><Icon name={f.icon} size={26} /></span>
                <h3>{f.title}</h3>
                <p className="s-muted">{f.text}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id="website" kicker="موقع العيادة" title={WEBSITE.title} tint>
          <div className="l-website" data-reveal>
            <p className="s-lead">{WEBSITE.text}</p>
            <ul className="l-limits">{WEBSITE.points.map((p) => <li key={p}><Icon name="check" size={16} />{p}</li>)}</ul>
            {demoSite && <a className="s-btn s-btn-ghost" href={demoSite} target="_blank" rel="noopener">شاهد موقعًا تجريبيًا</a>}
          </div>
        </Section>

        <Section id="pricing" kicker="الأسعار" title="باقات واضحة، بلا رسوم مخفية" sub={trial > 0 ? `كل الباقات تبدأ بتجربة مجانية لمدة ${trial} يومًا.` : undefined}>
          {plans.length > 0
            ? <Pricing plans={plans} signupUrl={signupUrl} />
            : <p className="bk-empty">الأسعار غير متاحة الآن. <a href="#contact">اطلب اتصالًا</a> وسنرسلها لك.</p>}
        </Section>

        <Section id="faq" kicker="الأسئلة الشائعة" title="أسئلة تصلنا كثيرًا" tint>
          <div className="l-faq">
            {questions.map((q) => (
              <details key={q.q} className="l-q">
                <summary>{q.q}<Icon name="chevronDown" size={18} /></summary>
                <p>{q.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <Section id="contact" kicker="تواصل معنا" title="تحب نتصل بك؟" sub="اترك اسمك ورقمك، ونتواصل معك لنعرض عليك النظام ونجيب عن أسئلتك.">
          <div className="l-contact"><LeadFormCard plans={plans} privacyUrl={legal('privacy')} /></div>
        </Section>
      </main>

      <footer className="s-foot">
        <div className="s-wrap s-foot-grid">
          <div className="s-foot-col s-foot-brand">
            <span className="s-brand"><span className="s-mark"><Tooth /></span><bdi>{BRAND}</bdi></span>
            <p className="s-muted">{HERO.lead}</p>
          </div>
          <nav className="s-foot-col" aria-label="روابط سريعة">
            <h3>الصفحة</h3>
            <ul className="s-foot-links">{LINKS.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
          </nav>
          <nav className="s-foot-col" aria-label="الحساب والمستندات">
            <h3>الحساب</h3>
            <ul className="s-foot-links">
              <li><a href={signupUrl}>إنشاء حساب عيادة</a></li>
              <li><a href={loginUrl}>دخول</a></li>
              <li><a href={legal('terms')}>شروط الاستخدام</a></li>
              <li><a href={legal('privacy')}>سياسة الخصوصية</a></li>
            </ul>
          </nav>
        </div>
        <div className="s-wrap s-foot-bottom">
          <span>© {new Date().getFullYear()} <bdi>{BRAND}</bdi>. جميع الحقوق محفوظة.</span>
        </div>
      </footer>
    </div>
  );
}
