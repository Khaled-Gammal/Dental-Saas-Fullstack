'use client';
import { useState } from 'react';
import { Icon, type IconName } from '../icons';
import { bestSaving, limitLines, planPrice, subscribeUrl, yearlySaving, type Cycle, type PublicPlan } from '../../lib/landing';

/** Asks the contact form (lead-form.tsx) to preselect a plan: the two are separate islands on a server-rendered page. */
export const PICK_PLAN_EVENT = 'landing:plan';

/** One icon per line of limitLines(), in its fixed order: branches, doctors, users, patient files, storage. */
const LIMIT_ICONS: IconName[] = ['pin', 'stethoscope', 'user', 'toothSparkle', 'sparkles'];

/**
 * LND-02: the plans from the API with a monthly/yearly switch, drawn as passes: an arched top with the price, a tear
 * line, then what the plan includes. «اشترك الآن» opens sign-up with the plan and the chosen cycle (the admin activates it
 * after payment); the free trial and a call request stay one click away. With three plans or more the middle one is
 * highlighted (the usual choice); with fewer, none is.
 */
export function Pricing({ plans, signupUrl }: { plans: PublicPlan[]; signupUrl: string }) {
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const saving = bestSaving(plans);
  const featured = plans.length >= 3 ? plans[1].id : null;
  const ask = (code: string) => window.dispatchEvent(new CustomEvent(PICK_PLAN_EVENT, { detail: code }));
  return (
    <>
      <div className="l-cycle" data-cycle={cycle} role="group" aria-label="مدة الاشتراك">
        <span className="l-cycle-thumb" aria-hidden />
        <button type="button" aria-pressed={cycle === 'monthly'} onClick={() => setCycle('monthly')}>شهري</button>
        <button type="button" aria-pressed={cycle === 'yearly'} onClick={() => setCycle('yearly')}>
          سنوي{saving > 0 && <span className="l-save">وفّر حتى {saving}%</span>}
        </button>
      </div>
      <div className="l-plans" data-count={Math.min(plans.length, 3)}>
        {plans.map((p) => {
          const price = planPrice(p, cycle);
          const save = cycle === 'yearly' ? yearlySaving(p) : 0;
          return (
            <article key={p.id} className={`l-pass${p.id === featured ? ' is-featured' : ''}`} aria-labelledby={`plan-${p.code}`} data-reveal>
              <div className="l-pass-top">
                <span className="l-pass-icon" aria-hidden><Icon name="tooth" size={22} /></span>
                <h3 id={`plan-${p.code}`}><bdi>{p.name_ar}</bdi></h3>
                {/* keyed by the cycle: the price plays its entrance again when the switch changes it */}
                <p key={cycle} className="l-pass-price"><strong>{price.amount}</strong><span>{price.per}</span></p>
                <p className="l-pass-note">{price.note ?? ' '}{save > 0 && <span className="l-save">وفّر {save}%</span>}</p>
              </div>
              <div className="l-pass-cut" aria-hidden />
              <ul className="l-pass-list">
                {limitLines(p.limits).map((line, i) => (
                  <li key={line}><span className="l-pass-li-icon" aria-hidden><Icon name={LIMIT_ICONS[i] ?? 'check'} size={16} /></span>{line}</li>
                ))}
              </ul>
              <div className="l-pass-cta">
                <a className="c-btn c-btn-arrow" href={subscribeUrl(signupUrl, p.code, cycle)}>اشترك الآن<span className="c-btn-bubble" aria-hidden><Icon name="arrow" size={18} /></span></a>
                <a className="c-btn c-btn-ghost" href={signupUrl}>{p.trial_days > 0 ? `جرّبها مجانًا ${p.trial_days} يومًا` : 'ابدأ التجربة المجانية'}</a>
                <a className="l-pass-link" href="#contact" onClick={() => ask(p.code)}>أو اطلب اتصالًا</a>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
