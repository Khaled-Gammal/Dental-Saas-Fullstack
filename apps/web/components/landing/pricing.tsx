'use client';
import { useState } from 'react';
import { Icon } from '../icons';
import { bestSaving, limitLines, planPrice, yearlySaving, type Cycle, type PublicPlan } from '../../lib/landing';

/** Asks the contact form (lead-form.tsx) to preselect a plan: the two are separate islands on a server-rendered page. */
export const PICK_PLAN_EVENT = 'landing:plan';

/**
 * LND-02: the plans from the API with a monthly/yearly switch. With three plans or more the middle one is highlighted
 * (the usual choice); with fewer, none is.
 */
export function Pricing({ plans, signupUrl }: { plans: PublicPlan[]; signupUrl: string }) {
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const saving = bestSaving(plans);
  const featured = plans.length >= 3 ? plans[1].id : null;
  const ask = (code: string) => window.dispatchEvent(new CustomEvent(PICK_PLAN_EVENT, { detail: code }));
  return (
    <>
      <div className="l-cycle" role="group" aria-label="مدة الاشتراك">
        <button type="button" aria-pressed={cycle === 'monthly'} onClick={() => setCycle('monthly')}>شهري</button>
        <button type="button" aria-pressed={cycle === 'yearly'} onClick={() => setCycle('yearly')}>
          سنوي{saving > 0 && <span className="l-save">وفّر حتى {saving}%</span>}
        </button>
      </div>
      <div className="s-grid l-plans">
        {plans.map((p) => {
          const price = planPrice(p, cycle);
          const save = cycle === 'yearly' ? yearlySaving(p) : 0;
          return (
            <article key={p.id} className={`s-card l-plan${p.id === featured ? ' is-featured' : ''}`} aria-labelledby={`plan-${p.code}`}>
              <h3 id={`plan-${p.code}`}><bdi>{p.name_ar}</bdi></h3>
              <p className="l-price"><strong>{price.amount}</strong> <span>{price.per}</span></p>
              <p className="l-price-note">{price.note ?? ' '}{save > 0 && <span className="l-save">وفّر {save}%</span>}</p>
              <ul className="l-limits">
                {limitLines(p.limits).map((line) => <li key={line}><Icon name="check" size={16} />{line}</li>)}
              </ul>
              <div className="l-plan-cta">
                <a className="s-btn" href={signupUrl}>ابدأ التجربة المجانية</a>
                <a className="s-btn s-btn-ghost" href="#contact" onClick={() => ask(p.code)}>اطلب اتصالًا</a>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
