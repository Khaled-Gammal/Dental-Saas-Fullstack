import { archGumPath, dentalArch, TOOTH_PATH } from '@dental/ui/arch';
import { Icon } from '../icons';
import type { Feature, FeatureKey } from '../../lib/landing-content';

const TEETH = dentalArch(16, 320, 220);
const GUM = archGumPath(18, 320, 220);
const TREATED = new Set([3, 4, 11]);

/** A small drawing of each module inside its card: shapes and generic labels, no figures (decoration only). */
function FeatureArt({ k }: { k: FeatureKey }) {
  switch (k) {
    case 'calendar':
      return (
        <div className="l-art l-art-cal">
          <div className="l-art-days">{['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'].map((d, i) => <span key={d} className={i === 3 ? 'is-on' : undefined}><b>{d}</b><i /></span>)}</div>
          {[['9:00', 'كشف', 'is-done', 'منتهي'], ['10:30', 'تنظيف', 'is-here', 'وصل'], ['12:00', 'حشو', 'is-next', 'مؤكد']].map(([t, s, c, label]) => (
            <div key={t} className={`l-art-row ${c}`}><b>{t}</b><span>{s}</span><i /><em>{label}</em></div>
          ))}
        </div>
      );
    case 'patient':
      return (
        <div className="l-art l-art-chart">
          <svg viewBox="0 0 320 220" focusable="false">
            <path d={GUM} className="l-gum" />
            {TEETH.map((t, i) => <path key={i} d={TOOTH_PATH} transform={t.transform} className={TREATED.has(i) ? 'is-on' : undefined} />)}
          </svg>
          <div className="l-art-legend"><span><i className="is-on" />علاج</span><span><i />سليم</span></div>
        </div>
      );
    case 'plans':
      return (
        <div className="l-art l-art-plan">
          {[['المرحلة الأولى', 'is-done'], ['المرحلة الثانية', 'is-now'], ['المرحلة الثالثة', '']].map(([s, c]) => (
            <div key={s} className={`l-art-stage ${c}`}><i>{c === 'is-done' && <Icon name="check" size={12} strokeWidth={3} />}</i><span>{s}</span></div>
          ))}
          <div className="l-art-bar"><i style={{ width: '45%' }} /></div>
        </div>
      );
    case 'billing':
      return (
        <div className="l-art l-art-bill">
          <div className="l-art-inv"><b>فاتورة</b><i /><i className="is-short" /></div>
          <div className="l-art-split"><i className="is-paid" /><i className="is-paid" /><i /></div>
          <div className="l-art-split-labels"><span>مدفوع</span><span>القسط التالي</span></div>
        </div>
      );
    case 'reports':
      return (
        <div className="l-art l-art-chart-bars">
          {[38, 52, 46, 64, 58, 76, 70, 88].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
        </div>
      );
    case 'team':
      return (
        <div className="l-art l-art-team">
          {[['مالك العيادة', true], ['طبيب', true], ['الاستقبال', true], ['المحاسب', false]].map(([r, on]) => (
            <div key={r as string} className="l-art-role"><span>{r}</span><i className={on ? 'is-on' : undefined} /></div>
          ))}
        </div>
      );
  }
}

/** The modules as a bento grid (areas set in app/landing.css), each with its drawing. */
export function FeatureBento({ items }: { items: Feature[] }) {
  return (
    <div className="l-bento">
      {items.map((f) => (
        <article key={f.key} className={`c-card l-feat l-feat-${f.key}`} data-reveal>
          <div className="l-feat-head">
            <span className="l-feat-icon" aria-hidden><Icon name={f.icon} size={24} /></span>
            <h3>{f.title}</h3>
          </div>
          <p>{f.text}</p>
          <div className="l-feat-art" aria-hidden><FeatureArt k={f.key} /></div>
        </article>
      ))}
    </div>
  );
}
