import { SPARKLE_PATH } from '@dental/ui/arch';
import { ICON_PATHS, TOOTH_PATH } from '@dental/ui/icons';

/** Server-rendered icons from the shared path data (no JavaScript is shipped for them). */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const paths = (ds: readonly string[]) => ds.map((d) => <path key={d} d={d} />);

export const Tooth = ({ size = 20 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}><path d={TOOTH_PATH} /></svg>;
export const Phone = () => <svg width={18} height={18} viewBox="0 0 24 24" {...stroke}>{paths(ICON_PATHS.phone)}</svg>;
export const Pin = () => <svg width={22} height={22} viewBox="0 0 24 24" {...stroke}>{paths(ICON_PATHS.pin)}</svg>;
export const Clock = () => <svg width={14} height={14} viewBox="0 0 24 24" {...stroke}>{paths(ICON_PATHS.clock)}</svg>;
export const Sparkle = () => <svg width={10} height={10} viewBox="-1 -1 2 2" aria-hidden><path d={SPARKLE_PATH} fill="currentColor" /></svg>;
