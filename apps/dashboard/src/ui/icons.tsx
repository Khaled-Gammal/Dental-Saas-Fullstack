import type { SVGProps } from 'react';
import { ICON_PATHS, TOOTH_PATH } from '@dental/ui/icons';

type P = SVGProps<SVGSVGElement> & { size?: number };

/** Stroke icons on a 24px grid. Decorative by default; pass aria-label + role="img" when one carries meaning alone. */
function Svg({ size = 20, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={rest['aria-label'] ? undefined : true} {...rest}>
      {children}
    </svg>
  );
}

/** Brand mark: a rounded tooth outline. */
/** Brand mark: a rounded tooth outline (same path as the website and the dental arch). */
export const ToothIcon = (p: P) => (<Svg {...p}><path d={TOOTH_PATH} /></Svg>);
export const HomeIcon = (p: P) => (<Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" /></Svg>);
export const PinIcon = (p: P) => (<Svg {...p}>{ICON_PATHS.pin.map((d) => <path key={d} d={d} />)}</Svg>);
export const CalendarIcon = (p: P) => (<Svg {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>);
export const UsersIcon = (p: P) => (<Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .6 3.2 2.3 3.5 5.2" /></Svg>);
export const StethoscopeIcon = (p: P) => (<Svg {...p}><path d="M5 3v6a5 5 0 0 0 10 0V3" /><path d="M10 14v2a5 5 0 0 0 10 0v-2" /><circle cx="20" cy="12" r="2" /></Svg>);
export const ReceiptIcon = (p: P) => (<Svg {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></Svg>);
export const GlobeIcon = (p: P) => (<Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" /></Svg>);
export const LogoutIcon = (p: P) => (<Svg {...p}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></Svg>);
export const MenuIcon = (p: P) => (<Svg {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>);
export const CloseIcon = (p: P) => (<Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>);
export const EyeIcon = (p: P) => (<Svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></Svg>);
export const EyeOffIcon = (p: P) => (<Svg {...p}><path d="M3 3l18 18" /><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 0 1-3 3.7M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.2" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Svg>);
export const CheckIcon = (p: P) => (<Svg {...p}><path d="M5 12.5 10 17 19 7" /></Svg>);
export const CopyIcon = (p: P) => (<Svg {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>);
export const ExternalIcon = (p: P) => (<Svg {...p}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></Svg>);
export const PlusIcon = (p: P) => (<Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>);
export const AlertIcon = (p: P) => (<Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></Svg>);
export const PhoneIcon = (p: P) => (<Svg {...p}>{ICON_PATHS.phone.map((d) => <path key={d} d={d} />)}</Svg>);
export const ShieldIcon = (p: P) => (<Svg {...p}><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></Svg>);
export const LangIcon = (p: P) => (<Svg {...p}><path d="M4 5h9M8.5 3v2M6 5c.6 3.6 2.8 6.4 6 8M11 5c-.6 3.6-2.8 6.4-6 8" /><path d="m13 21 4-9 4 9M14.5 18h5" /></Svg>);
