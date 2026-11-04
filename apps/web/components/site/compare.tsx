'use client';
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '../icons';

interface Img { src: string; srcSet: string; width: number; height: number }

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/**
 * A before/after case as one picture with a divider the visitor drags (or moves with the arrow keys). "Before" is on
 * the right, where a right-to-left reader starts; `pos` is how far the divider sits from the right edge, in percent.
 * Without JavaScript the picture shows half and half. Vertical swipes still scroll the page (touch-action: pan-y).
 */
export function CaseCompare({ before, after, alt, sizes }: { before: Img; after: Img; alt: { before: string; after: string }; sizes: string }) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  const fromPointer = (x: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r && r.width > 0) setPos(clamp(((r.right - x) / r.width) * 100));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromPointer(e.clientX);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: 5, ArrowRight: -5, PageUp: 10, PageDown: -10 }[e.key];
    if (step !== undefined) { e.preventDefault(); setPos((p) => clamp(p + step)); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setPos(e.key === 'Home' ? 0 : 100); }
  };

  return (
    <div ref={box} className="c-compare" style={{ '--pos': `${pos}%` } as CSSProperties}
      onPointerDown={onDown} onPointerMove={(e) => { if (drag.current) fromPointer(e.clientX); }}
      onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}>
      <img className="c-compare-img" {...before} sizes={sizes} alt={alt.before} loading="lazy" decoding="async" draggable={false} />
      <img className="c-compare-img c-compare-after" {...after} sizes={sizes} alt={alt.after} loading="lazy" decoding="async" draggable={false} />
      <span className="c-compare-tag" aria-hidden>قبل</span>
      <span className="c-compare-tag is-after" aria-hidden>بعد</span>
      <div className="c-compare-handle" role="slider" tabIndex={0} aria-label="اسحب للمقارنة بين الصورة قبل العلاج وبعده"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} aria-valuetext={`صورة ما قبل العلاج ظاهرة بنسبة ${Math.round(pos)}%`} onKeyDown={onKey}>
        <span className="c-compare-knob"><Icon name="compare" size={20} /></span>
      </div>
    </div>
  );
}
