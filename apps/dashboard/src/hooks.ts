import { useCallback, useEffect, useState } from 'react';
import { href, parseRoute, type Route } from './router';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** True while the media query matches; follows window resizes. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/* ---------- navigation ---------- */

/** A form with unsaved changes registers a guard; `navigate` asks it before leaving. */
let guard: (() => boolean) | null = null;

/** Tiny hash router: the route survives a reload, deep links and Back/Forward work, no router dependency. */
export function navigate(route: Route | string): void {
  if (guard && !guard()) return;
  window.location.hash = typeof route === 'string' ? route : href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/**
 * Prevents losing a half-filled form: in-app navigation asks for confirmation, and closing or reloading
 * the tab shows the browser's own prompt. (Browser Back/Forward cannot be intercepted on a hash route.)
 */
export function useUnsavedChanges(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) return;
    guard = () => window.confirm(message);
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; // returnValue: Safari
    window.addEventListener('beforeunload', onUnload);
    return () => { guard = null; window.removeEventListener('beforeunload', onUnload); };
  }, [dirty, message]);
}

/* ---------- one-shot notice shown on the next screen ("Doctor saved") ---------- */

let flash: string | null = null;
/** Reads and clears the pending notice; the first screen to mount after a save shows it. */
export function useFlash(): string | null {
  const [msg] = useState(() => { const m = flash; flash = null; return m; });
  return msg;
}

/**
 * After a successful save: drop the guard (the form is clean), leave a notice, go back to the list — or to `target`
 * when the next screen is only known after the save (a new record's own page).
 */
export function useLeave(route: Route): (notice?: string, target?: Route) => void {
  return useCallback((notice?: string, target?: Route) => { guard = null; flash = notice ?? null; window.location.hash = href(target ?? route); }, [route]);
}
