import type { Metadata } from 'next';
import { Icon, Phone, Sparkle, Tooth } from '../components/icons';
import { FeatureBento } from '../components/landing/features';
import { LandingHeader } from '../components/landing/header';
import { Journey } from '../components/landing/journey';
import { LeadFormCard } from '../components/landing/lead-form';
import { Pricing } from '../components/landing/pricing';
import { SiteDemo } from '../components/landing/site-demo';
import { ProductStage } from '../components/landing/stage';
import { ServicesBand } from '../components/site/band';
import { CtaArt, Section, SectionHead, Swash } from '../components/site/decor';
import { FaqLayout } from '../components/site/faq';
import type { NavLink } from '../components/site/menu';
import { BRAND, getPlans, trialDays } from '../lib/landing';
import { FEATURES, HERO, WEBSITE, facts, faqs, steps, subscribeSteps } from '../lib/landing-content';
import { DEFAULT_PRIMARY } from '../lib/site';
import { brandStyle } from '../lib/theme';
import './landing.css';

export const revalidate = 300; // the plans: an edit in the platform panel shows here within five minutes

export const metadata: Metadata = {
  title: `${BRAND} — نظام إدارة وموقع إلكتروني لعيادتك`,
  description: HERO.lead,
};

const LINKS: NavLink[] = [
  { href: '#how', label: 'كيف يعمل' },
  { href: '#features', label: 'المزايا' },
  { href: '#pricing', label: 'الأسعار' },
  { href: '#faq', label: 'الأسئلة الشائعة' },
  { href: '#contact', label: 'تواصل معنا' },
];

/**
 * The platform's landing page (H7; LND-01, LND-02, LND-04), on the root domain (middleware.ts), in the clinic sites'
 * design (app/site.css + app/landing.css). Arabic only (L10N-001). Sign-up and sign-in happen in the dashboard; the legal
 * documents are read there too (#/legal/<kind>). The wording lives in lib/landing-content.ts.
 */
export default async function Landing() {
  const dashboard = process.env.DASHBOARD_URL ?? '';
  const signupUrl = `${dashboard}/#/signup`;
  const loginUrl = `${dashboard}/`;
  const legal = (kind: string) => `${dashboard}/#/legal/${kind}`;
  const demoSite = process.env.DEMO_SITE_URL || null;
  const plans = await getPlans();
  const trial = trialDays(plans);
  const questions = faqs(trial).map((q, i) => ({ id: `q${i}`, ...q }));
  const strip = facts(trial);
  const start = trial > 0 ? `جرّبه مجانًا ${trial} يومًا` : 'أنشئ حساب عيادتك';

  return (
    <div className="c-site l-site" id="top" style={brandStyle(DEFAULT_PRIMARY)}>
      <a className="c-skip" href="#main">تخطَّ إلى المحتوى</a>
      <LandingHeader brand={BRAND} links={LINKS} signupUrl={signupUrl} loginUrl={loginUrl} trial={trial} />

      <main id="main">
        <section className="c-hero l-hero" aria-labelledby="hero-t">
          <div className="c-wrap c-hero-grid">
            <div className="c-hero-copy">
              <span className="c-live c-hero-in"><Tooth size={16} /><strong>{HERO.eyebrow}</strong></span>
              <h1 id="hero-t" className="c-display l-display c-hero-in">{HERO.title} <span className="c-swash">{HERO.mark}<Swash /></span></h1>
              <p className="c-lead c-hero-in">{HERO.lead}</p>
              <div className="c-hero-cta c-hero-in">
                <a className="c-btn c-btn-lg c-btn-arrow" href={signupUrl}>{start}<span className="c-btn-bubble" aria-hidden><Icon name="arrow" size={18} /></span></a>
                <a className="c-btn c-btn-lg c-btn-ghost" href="#contact"><Phone size={20} />اطلب اتصالًا</a>
              </div>
              {trial > 0 && <p className="l-hero-note c-hero-in"><Icon name="check" size={16} strokeWidth={2.6} />دون بطاقة دفع، وتبدأ مباشرة بعد التسجيل</p>}
            </div>
            <ProductStage />
          </div>
        </section>

        <section className="c-facts" aria-label="باختصار">
          <div className="c-wrap">
            <ul className="c-facts-list" data-count={strip.length}>
              {strip.map((f) => (
                <li key={f.value} className="c-fact is-text">
                  <span className="c-fact-icon"><Icon name={f.icon} size={22} /></span>
                  <span className="c-fact-text"><strong>{f.value}</strong><span>{f.label}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <ServicesBand names={[...FEATURES.map((f) => f.title), 'موقع العيادة', 'حجز أونلاين']} />

        <Section id="how" kicker="كيف يعمل" title="من التسجيل حتى أول حجز" sub="أربع خطوات، وتعمل عيادتك على النظام وموقعها معًا." tint>
          <Journey items={steps(trial)} />
        </Section>

        <Section id="features" kicker="المزايا" title="كل ما تحتاجه العيادة يوميًا" sub="من استقبال المريض حتى تقرير آخر الشهر، بنظام واحد يعمل عليه فريقك كله.">
          <FeatureBento items={FEATURES} />
        </Section>

        <section id="website" className="c-section is-tint" aria-labelledby="website-t">
          <div className="c-wrap l-website">
            <div className="l-website-copy">
              <SectionHead id="website" kicker="موقع العيادة" title={WEBSITE.title} stacked />
              <p className="c-lead">{WEBSITE.text}</p>
              <ul className="l-checks">
                {WEBSITE.points.map((p) => <li key={p}><span aria-hidden><Icon name="check" size={14} strokeWidth={3} /></span>{p}</li>)}
              </ul>
              {demoSite && <a className="c-btn c-btn-ghost" href={demoSite} target="_blank" rel="noopener">شاهد موقعًا تجريبيًا<Icon name="arrowUpLeft" size={18} /></a>}
            </div>
            <SiteDemo />
          </div>
        </section>

        <Section id="pricing" kicker="الأسعار" title="باقات واضحة، بلا رسوم مخفية" sub={trial > 0 ? `كل الباقات تبدأ بتجربة مجانية لمدة ${trial} يومًا.` : undefined}>
          {plans.length > 0
            ? <Pricing plans={plans} signupUrl={signupUrl} />
            : <p className="l-empty">الأسعار غير متاحة الآن. <a href="#contact">اطلب اتصالًا</a> وسنرسلها لك.</p>}
          <div className="l-subflow" data-reveal>
            <h3>كيف يعمل الاشتراك؟</h3>
            <ol>
              {subscribeSteps(trial).map((s, i) => (
                <li key={s.title}><span className="l-subflow-num" aria-hidden>{i + 1}</span><div><strong>{s.title}</strong><p>{s.text}</p></div></li>
              ))}
            </ol>
          </div>
        </Section>

        <FaqLayout items={questions} kicker="الأسئلة الشائعة" title="أسئلة تصلنا كثيرًا" tint aside={(
          <div className="c-help" data-reveal>
            <strong>لم تجد إجابة سؤالك؟</strong>
            <p>اترك رقمك ونتصل بك لنجيب عن أسئلتك.</p>
            <div className="c-help-actions"><a className="c-btn c-btn-sm c-btn-light" href="#contact"><Phone size={18} />اطلب اتصالًا</a></div>
          </div>
        )} />

        <section id="contact" className="c-section" aria-labelledby="contact-t">
          <div className="c-wrap">
            <div className="l-contact" data-reveal>
              <div className="l-contact-aside">
                <span className="c-kicker"><Sparkle size={11} />تواصل معنا</span>
                <h2 id="contact-t">تحب نتصل بك؟</h2>
                <p>اترك اسمك ورقمك، ونتواصل معك لنعرض عليك النظام ونجيب عن أسئلتك.</p>
                <ul className="l-checks is-light">
                  {['نعرض عليك النظام', 'نجيب عن أسئلتك', 'نحدثك عن الباقة التي تهمك'].map((p) => <li key={p}><span aria-hidden><Icon name="check" size={14} strokeWidth={3} /></span>{p}</li>)}
                </ul>
                <CtaArt />
              </div>
              <LeadFormCard plans={plans} privacyUrl={legal('privacy')} />
            </div>
          </div>
        </section>

        <section className="c-cta" aria-labelledby="cta-t">
          <div className="c-wrap">
            <div className="c-cta-panel" data-reveal>
              <div className="c-cta-copy">
                <h2 id="cta-t">{trial > 0 ? 'جاهز تجرّبه على عيادتك؟' : 'جاهز تبدأ مع عيادتك؟'}</h2>
                <p>{trial > 0 ? `${trial} يومًا مجانًا دون بطاقة دفع، ونظام عيادتك وموقعها جاهزان من أول يوم.` : 'نظام عيادتك وموقعها جاهزان من أول يوم.'}</p>
                <div className="c-cta-actions">
                  <a className="c-btn c-btn-lg c-btn-light c-btn-arrow" href={signupUrl}>{start}<span className="c-btn-bubble" aria-hidden><Icon name="arrow" size={18} /></span></a>
                  <a className="c-btn c-btn-lg c-btn-glass" href="#contact"><Phone size={20} />اطلب اتصالًا</a>
                </div>
              </div>
              <CtaArt />
            </div>
          </div>
        </section>
      </main>

      <footer className="c-foot">
        <div className="c-wrap">
          <div className="c-foot-grid">
            <div className="c-foot-brand">
              <span className="c-brand"><span className="c-mark" aria-hidden><Tooth size={22} /></span><bdi>{BRAND}</bdi></span>
              <p>{HERO.lead}</p>
            </div>
            <nav aria-label="روابط سريعة">
              <h3>الصفحة</h3>
              <ul className="c-foot-links">{LINKS.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
            </nav>
            <nav aria-label="الحساب">
              <h3>الحساب</h3>
              <ul className="c-foot-links">
                <li><a href={signupUrl}>إنشاء حساب عيادة</a></li>
                <li><a href={loginUrl}>دخول</a></li>
              </ul>
            </nav>
            <nav aria-label="المستندات">
              <h3>المستندات</h3>
              <ul className="c-foot-links">
                <li><a href={legal('terms')}>شروط الاستخدام</a></li>
                <li><a href={legal('privacy')}>سياسة الخصوصية</a></li>
              </ul>
            </nav>
          </div>
          <p className="c-wordmark" aria-hidden><bdi>{BRAND}</bdi></p>
          <div className="c-foot-bottom"><span>© {new Date().getFullYear()} <bdi>{BRAND}</bdi>. جميع الحقوق محفوظة.</span></div>
        </div>
      </footer>

      <div className="c-mbar" role="group" aria-label="ابدأ الآن">
        <a className="c-btn" href={signupUrl}>{trial > 0 ? 'ابدأ مجانًا' : 'أنشئ حسابك'}</a>
        <a className="c-icon-btn c-icon-btn-lg" href="#contact" aria-label="اطلب اتصالًا"><Phone size={20} /></a>
      </div>
    </div>
  );
}
