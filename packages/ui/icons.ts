/**
 * Icon path data (24×24, stroke icons) shared by both apps. Pure data: the website renders it on the server
 * with no JavaScript, the dashboard wraps it in its <Svg> component.
 */
import { TOOTH_PATH } from './arch';
export { TOOTH_PATH } from './arch';

/** A smaller tooth (the 24-grid outline scaled to ~70%) used as the base of the service-category icons. */
const SMALL_TOOTH = 'M8.6 5.2c-1.7 0-2.8 1.3-2.8 3.2 0 1.4.6 2.4 1 3.4.5.9.7 2 .8 3.2.2 1.7.7 2.5 1.5 2.5.9 0 1.1-1.1 1.4-2.5.2-1 .6-1.7 1.5-1.7s1.3.7 1.5 1.7c.3 1.4.5 2.5 1.4 2.5.8 0 1.3-.8 1.5-2.5.1-1.3.3-2.3.8-3.2.5-1 1-2 1-3.4 0-1.9-1.1-3.2-2.8-3.2-1.1 0-1.8.6-3.4.6s-2.3-.6-3.4-.6Z';

export const ICON_PATHS = {
  phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z'],
  pin: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z', 'M12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7v5l3 2'],
  // chat bubble with a handset: reads as "message us" without using a trademarked logo
  whatsapp: ['M21 12a8.5 8.5 0 0 1-12.6 7.5L3 21l1.5-5.4A8.5 8.5 0 1 1 21 12Z', 'M9 9.5c.5 2.6 2.4 4.5 5 5l1.2-1.2-1.6-1-.9.7c-.9-.4-1.6-1.1-2-2l.7-.9-1-1.6L9 9.5Z'],
  directions: ['M3 11l18-8-8 18-2-8-8-2Z'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  chevronDown: ['M6 9l6 6 6-6'],
  check: ['M5 12l4 4L19 7'],
  shield: ['M12 3l8 3v6c0 4.6-3.3 8.1-8 9-4.7-.9-8-4.4-8-9V6l8-3Z', 'M9 12l2 2 4-4'],
  calendar: ['M4 5h16v15H4Z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21a8 8 0 0 1 16 0'],
  star: ['M12 3l2.7 5.6 6.2.9-4.5 4.3 1.1 6.2L12 17l-5.5 3 1.1-6.2L3 9.5l6.2-.9L12 3Z'],
  // service categories (service_catalog.category)
  stethoscope: ['M6 3v5a6 6 0 0 0 12 0V3', 'M12 14v2a4 4 0 0 0 8 0v-3', 'M20 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  toothSparkle: [SMALL_TOOTH, 'M18 2l.7 1.8 1.8.7-1.8.7L18 7l-.7-1.8-1.8-.7 1.8-.7L18 2Z'],
  toothCheck: [SMALL_TOOTH, 'M9.5 11.5l1.8 1.8 3.2-3.5'],
  toothRoot: [SMALL_TOOTH, 'M12 10v6', 'M10 16l2 3 2-3'],
  sparkles: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z'],
  toothSurgery: [SMALL_TOOTH, 'M15 4l5 5', 'M20 4l-5 5'],
  crown: ['M4 18h16', 'M5 18L3 8l5 4 4-7 4 7 5-4-2 10Z'],
  toothBrace: [SMALL_TOOTH, 'M7 12h10'],
  smile: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'],
  toothGum: [SMALL_TOOTH, 'M4 18q8 6 16 0'],
  tooth: [TOOTH_PATH],
} as const;

export type IconName = keyof typeof ICON_PATHS;
