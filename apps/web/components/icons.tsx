import { SPARKLE_PATH } from '@dental/ui/arch';
import { ICON_PATHS } from '@dental/ui/icons';

/**
 * Website-only stroke icons on the shared 24×24 grid. Arrows point left: "forward" on a right-to-left page.
 */
const SITE_PATHS = {
  arrow: ['M19 12H5', 'M11 6l-6 6 6 6'],
  arrowUpLeft: ['M17 17 7 7', 'M7 16V7h9'],
  plus: ['M12 5v14', 'M5 12h14'],
  tag: ['M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l7.9 7.9a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0l-7.9-7.9Z', 'M8.5 8.5h.01'],
  compare: ['M9 7l-5 5 5 5', 'M15 7l5 5-5 5'],
  pulse: ['M3 12h4l2-5 4 10 2-5h6'],
  mail: ['M4 6h16v12H4Z', 'M4 7l8 6 8-6'],
} as const;

export type IconName = keyof typeof ICON_PATHS | keyof typeof SITE_PATHS;
const PATHS: Record<IconName, readonly string[]> = { ...ICON_PATHS, ...SITE_PATHS };

/** Server-rendered stroke icons from the shared path data (no JavaScript is shipped for them). */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export function Icon({ name, size = 20, className, strokeWidth }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...stroke} {...(strokeWidth && { strokeWidth })}>
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

export const Tooth = ({ size = 20 }: { size?: number }) => <Icon name="tooth" size={size} />;
export const Phone = ({ size = 18 }: { size?: number }) => <Icon name="phone" size={size} />;
export const Pin = ({ size = 20 }: { size?: number }) => <Icon name="pin" size={size} />;
export const Clock = ({ size = 16 }: { size?: number }) => <Icon name="clock" size={size} />;
export const Chat = ({ size = 18 }: { size?: number }) => <Icon name="whatsapp" size={size} />;
/** A filled four-point sparkle. */
export const Sparkle = ({ size = 10, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="-1 -1 2 2" className={className} aria-hidden><path d={SPARKLE_PATH} fill="currentColor" /></svg>
);
