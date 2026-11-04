'use client';
import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Icon, Tooth } from '../icons';
import { HeroArt } from '../site/decor';
import { SITE_COLOURS } from '../../lib/landing-content';
import { themeVars } from '../../lib/palette';

/**
 * A clinic website in miniature that takes the colour the visitor picks: the same colours a clinic chooses from in its
 * dashboard, and the same contrast rules as the real sites (lib/palette.ts). The swatches are a radio group (arrow keys
 * move the choice); the miniature is decoration.
 */
export function SiteDemo() {
  const [colour, setColour] = useState(SITE_COLOURS[0].hex);
  const group = useRef<HTMLDivElement>(null);
  const pick = (i: number) => {
    const c = SITE_COLOURS[(i + SITE_COLOURS.length) % SITE_COLOURS.length];
    setColour(c.hex);
    group.current?.querySelector<HTMLButtonElement>(`[data-hex="${c.hex}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const i = SITE_COLOURS.findIndex((c) => c.hex === colour);
    const step = { ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1 }[e.key]; // right to left: the next swatch is on the left
    if (step) { e.preventDefault(); pick(i + step); }
  };
  const name = SITE_COLOURS.find((c) => c.hex === colour)?.name;

  return (
    <div className="l-demo">
      <div className="l-demo-frame c-theme" style={themeVars(colour)} aria-hidden>
        <div className="l-win-bar"><i /><i /><i /><span className="l-win-url"><Icon name="pin" size={11} />موقع عيادتك</span></div>
        <div className="l-dm-page">
          <div className="l-dm-nav"><span className="l-dm-mark"><Tooth size={12} /></span><b>عيادتك</b><i /><i /><i /><span className="l-dm-cta">احجز موعدًا</span></div>
          <div className="l-dm-hero">
            <div className="l-dm-copy">
              <span className="l-dm-live"><i />مفتوح الآن</span>
              <strong className="l-dm-title">عيادتك لطب <span>الأسنان</span></strong>
              <i className="l-sk" /><i className="l-sk is-short" />
              <span className="l-dm-btns"><span className="l-dm-btn">احجز موعدك الآن</span><span className="l-dm-btn is-ghost">واتساب</span></span>
            </div>
            <HeroArt id="wd" className="l-dm-art" />
          </div>
          <div className="l-dm-cards">
            {(['toothSparkle', 'toothCheck', 'sparkles'] as const).map((ic) => (
              <span key={ic} className="l-dm-card"><span className="l-dm-icon"><Icon name={ic} size={14} /></span><i /><i className="is-short" /><b /></span>
            ))}
          </div>
        </div>
      </div>
      <div className="l-swatches">
        <span className="l-swatches-label" id="l-swatches-label">جرّب لونًا لموقعك:</span>
        <div ref={group} className="l-swatch-row" role="radiogroup" aria-labelledby="l-swatches-label" onKeyDown={onKey}>
          {SITE_COLOURS.map((c, i) => (
            <button key={c.hex} type="button" role="radio" aria-checked={colour === c.hex} aria-label={c.name} tabIndex={colour === c.hex ? 0 : -1}
              data-hex={c.hex} className="l-swatch" style={{ '--sw': c.hex } as CSSProperties} onClick={() => pick(i)} />
          ))}
        </div>
        <span className="l-swatches-name" aria-live="polite">{name}</span>
      </div>
    </div>
  );
}
