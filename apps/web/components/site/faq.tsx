import { Icon } from '../icons';
import { ar, type SiteFaq } from '../../lib/site';
import { Section } from './decor';

/** The clinic's questions in Arabic (English when only that was written); none without a question and an answer. */
export const faqItems = (faqs: SiteFaq[]) =>
  faqs.map((f) => ({ id: f.id, q: ar(f.question_ar, f.question_en), a: ar(f.answer_ar, f.answer_en) }))
    .filter((f): f is { id: string; q: string; a: string } => !!f.q && !!f.a);

/** Phase 2C-1: the clinic's questions and answers, closed until opened (native <details>: works without JavaScript). */
export function FaqSection({ faqs, tint }: { faqs: SiteFaq[]; tint?: boolean }) {
  const items = faqItems(faqs);
  if (!items.length) return null;
  return (
    <Section id="faq" kicker="الأسئلة الشائعة" title="إجابات قبل أن تسأل" sub="أكثر ما يسأل عنه المرضى قبل زيارتهم" tint={tint}>
      <div className="l-faq">
        {items.map((f) => (
          <details key={f.id} className="l-q" data-reveal>
            <summary><bdi>{f.q}</bdi><Icon name="chevronDown" size={18} /></summary>
            <p className="s-faq-a">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
