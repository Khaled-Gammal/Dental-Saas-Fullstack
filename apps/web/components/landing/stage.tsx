import type { CSSProperties } from 'react';
import { Icon, Tooth } from '../icons';
import { HeroArt } from '../site/decor';
import { themeVars } from '../../lib/palette';

/** A day in the drawn calendar: [column, top %, height %, tone, time, service]. Generic sample entries, no people. */
const DAY: [number, number, number, 'a' | 'b' | 'c' | 'new', string, string][] = [
  [0, 3, 17, 'c', '9:00', 'كشف'], [0, 25, 24, 'a', '10:00', 'علاج عصب'], [0, 58, 17, 'b', '1:00', 'تنظيف'],
  [1, 8, 26, 'b', '9:30', 'تقويم'], [1, 41, 16, 'a', '11:30', 'كشف'], [1, 70, 22, 'new', '5:30', 'تنظيف'],
  [2, 0, 18, 'a', '9:00', 'حشو'], [2, 27, 25, 'c', '10:30', 'تبييض'], [2, 62, 15, 'b', '1:30', 'متابعة'],
];

/**
 * The landing page's main drawing: the clinic's day in the dashboard, a patient's phone on the clinic's own website (in
 * its own colour), and the booking travelling from one to the other. HTML and SVG sized in container units, so it scales
 * like a picture; decoration only (the text beside it says the same).
 */
export function ProductStage() {
  return (
    <div className="l-stage" aria-hidden>
      <span className="l-stage-arch" />
      <span className="l-stage-dots" />
      <div className="l-win">
        <div className="l-win-bar"><i /><i /><i /><span className="l-win-url"><Tooth size={11} />لوحة العيادة</span></div>
        <div className="l-win-body">
          <div className="l-win-side">
            <span className="l-win-logo"><Tooth size={14} /></span>
            {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i === 1 ? 'is-on' : undefined} />)}
          </div>
          <div className="l-win-main">
            <div className="l-win-head"><strong>مواعيد اليوم</strong><span className="l-win-chip"><Icon name="calendar" size={11} />اليوم</span></div>
            <div className="l-cal">
              {[0, 1, 2].map((col) => (
                <div key={col} className="l-cal-col">
                  <span className="l-cal-doc"><i /><b /></span>
                  <div className="l-cal-track">
                    {DAY.filter((a) => a[0] === col).map(([, top, h, tone, time, label]) => (
                      <span key={time} className={`l-appt is-${tone}`} style={{ '--top': `${top}%`, '--h': `${h}%` } as CSSProperties}>
                        <b>{time}</b><em>{label}</em>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="l-phone c-theme" style={themeVars('#0e9aa7')}>
        <div className="l-phone-in">
          <div className="l-ph-nav"><span className="l-ph-mark"><Tooth size={9} /></span><b /><i /></div>
          <HeroArt id="lp" className="l-ph-art" />
          <strong className="l-ph-title">عيادتك</strong>
          <i className="l-sk" /><i className="l-sk is-short" />
          <span className="l-ph-btn">احجز موعدك</span>
        </div>
      </div>
      <svg className="l-flow" viewBox="0 0 100 86" focusable="false">
        <defs>
          <marker id="l-flow-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10Z" className="l-flow-tip" />
          </marker>
        </defs>
        <path className="l-flow-path" d="M71 79C59 85 42 78 37.5 61" markerEnd="url(#l-flow-head)" />
      </svg>
      <div className="l-toast">
        <span className="l-toast-icon"><Icon name="calendar" size={18} /></span>
        <span><small>حجز جديد من موقع العيادة</small><strong>تنظيف الأسنان · 5:30 م</strong></span>
      </div>
    </div>
  );
}
