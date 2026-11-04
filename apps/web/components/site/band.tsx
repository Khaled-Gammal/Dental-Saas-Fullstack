import { Sparkle } from '../icons';
import { repeatToFill } from '../../lib/display';

/**
 * Two crossed "tapes" naming the clinic's services, under the hero. They slide as the page scrolls (CSS scroll-driven
 * animation: they move only while the visitor scrolls, and stay still for reduced motion or without support).
 * Decoration only: the services section lists the same names, so the band is hidden from screen readers.
 */
export function ServicesBand({ names }: { names: string[] }) {
  if (names.length < 3) return null;
  const front = repeatToFill(names, 18);
  const back = repeatToFill([...names].reverse(), 18);
  const tape = (items: string[], cls: string) => (
    <div className={`c-tape ${cls}`}>
      <div className="c-tape-track">
        {items.map((n, i) => <span key={i} className="c-tape-item"><Sparkle size={14} /><bdi>{n}</bdi></span>)}
      </div>
    </div>
  );
  return (
    <div className="c-band" aria-hidden="true">
      {tape(back, 'c-tape-back')}
      {tape(front, 'c-tape-front')}
    </div>
  );
}
