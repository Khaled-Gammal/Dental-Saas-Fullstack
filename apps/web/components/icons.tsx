import { SPARKLE_PATH } from '@dental/ui/arch';
import { ICON_PATHS, type IconName } from '@dental/ui/icons';

/** Server-rendered stroke icons from the shared path data (no JavaScript is shipped for them). */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...stroke}>
      {ICON_PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

export const Tooth = ({ size = 20 }: { size?: number }) => <Icon name="tooth" size={size} />;
export const Phone = ({ size = 18 }: { size?: number }) => <Icon name="phone" size={size} />;
export const Pin = ({ size = 20 }: { size?: number }) => <Icon name="pin" size={size} />;
export const Clock = ({ size = 16 }: { size?: number }) => <Icon name="clock" size={size} />;
export const Chat = ({ size = 18 }: { size?: number }) => <Icon name="whatsapp" size={size} />;
export const Sparkle = () => <svg width={10} height={10} viewBox="-1 -1 2 2" aria-hidden><path d={SPARKLE_PATH} fill="currentColor" /></svg>;
