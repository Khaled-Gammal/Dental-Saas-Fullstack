/**
 * Icon path data (24×24, stroke icons) shared by both apps. Pure data: the website renders it on the server
 * with no JavaScript, the dashboard wraps it in its <Svg> component.
 */
export { TOOTH_PATH } from './arch';

export const ICON_PATHS = {
  phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z'],
  pin: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z', 'M12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7v5l3 2'],
} as const;
