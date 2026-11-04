import { useLayoutEffect } from 'react';
import { brandVars } from '../theme-model';

const CACHE = 'brand-colour:';
const read = (key: string) => { try { return localStorage.getItem(CACHE + key); } catch { return null; } };
const write = (key: string, colour: string | null) => {
  try { if (colour) localStorage.setItem(CACHE + key, colour); else localStorage.removeItem(CACHE + key); } catch { /* a convenience only */ }
};

/**
 * Puts the clinic's colour on <html>, so every part of the dashboard follows it, the dialogs and menus too (they open
 * outside the app's tree). `colour` is undefined while the clinic profile loads: the colour this browser last saw for
 * the clinic is used meanwhile, so the page does not flash from the platform colour. Phones colour their browser bar
 * with it too (meta theme-color). Unmounting (signing out) takes it off: the platform colour again.
 */
export function useBrandTheme(colour: string | null | undefined, clinicId: string) {
  const shown = colour === undefined ? read(clinicId) : colour;
  useLayoutEffect(() => {
    if (colour !== undefined) write(clinicId, colour);
    const style = document.documentElement.style;
    const vars = brandVars(shown);
    for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const before = meta?.content;
    if (meta) meta.content = vars['--brand'];
    return () => {
      for (const name of Object.keys(vars)) style.removeProperty(name);
      if (meta && before) meta.content = before;
    };
  }, [shown, colour, clinicId]);
}
