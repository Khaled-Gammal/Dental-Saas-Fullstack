import type { ReactNode } from 'react';
import { Chat, Icon, Phone } from '../icons';
import { ar, type SiteFaq } from '../../lib/site';
import type { Contact } from './contact';
import { SectionHead } from './decor';

export interface FaqItem { id: string; q: string; a: string }

/** The clinic's questions in Arabic (English when only that was written); none without a question and an answer. */
export const faqItems = (faqs: SiteFaq[]): FaqItem[] =>
  faqs.map((f) => ({ id: f.id, q: ar(f.question_ar, f.question_en), a: ar(f.answer_ar, f.answer_en) }))
    .filter((f): f is FaqItem => !!f.q && !!f.a);

/**
 * Questions and answers, closed until opened (native <details>: works without JavaScript). The heading sits beside the
 * list on wide screens, with `aside` under it (a card with the ways to ask). Shared by the clinic sites and the landing page.
 */
export function FaqLayout({ items, kicker, title, sub, aside, tint, id = 'faq' }: { items: FaqItem[]; kicker: string; title: string; sub?: string; aside?: ReactNode; tint?: boolean; id?: string }) {
  if (!items.length) return null;
  return (
    <section id={id} className={`c-section${tint ? ' is-tint' : ''}`} aria-labelledby={`${id}-t`}>
      <div className="c-wrap c-faq">
        <div className="c-faq-aside">
          <SectionHead id={id} kicker={kicker} title={title} sub={sub} stacked />
          {aside}
        </div>
        <div className="c-faq-list">
          {items.map((f, i) => (
            <details key={f.id} className="c-q" data-reveal>
              <summary>
                <span className="c-q-num" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                <bdi className="c-q-text">{f.q}</bdi>
                <span className="c-q-icon" aria-hidden><Icon name="plus" size={18} /></span>
              </summary>
              <p className="c-q-a">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Phase 2C-1: a clinic's questions, with its own channels for a question not answered here. */
export function FaqSection({ faqs, tint, contact }: { faqs: SiteFaq[]; tint?: boolean; contact?: Contact }) {
  const ask = contact && (contact.whatsapp || contact.tel) ? (
    <div className="c-help" data-reveal>
      <strong>لم تجد إجابة سؤالك؟</strong>
      <p>اسألنا مباشرة عبر القناة التي تناسبك.</p>
      <div className="c-help-actions">
        {contact.whatsapp && <a className="c-btn c-btn-sm c-btn-light" href={contact.whatsapp}><Chat size={18} />واتساب</a>}
        {contact.tel && <a className="c-btn c-btn-sm c-btn-glass" href={contact.tel}><Phone size={18} />اتصل بنا</a>}
      </div>
    </div>
  ) : null;
  return <FaqLayout items={faqItems(faqs)} kicker="الأسئلة الشائعة" title="إجابات قبل أن تسأل" sub="أكثر ما يسأل عنه المرضى قبل زيارتهم." aside={ask} tint={tint} />;
}
