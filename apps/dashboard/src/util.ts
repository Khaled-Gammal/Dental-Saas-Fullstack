import { useEffect, useState } from 'react';
export { toAsciiDigits } from '@dental/ui/text';

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

export type Page = 'overview' | 'profile' | 'branches';
const PAGES: readonly Page[] = ['overview', 'profile', 'branches'];
/** The page named in the URL hash, or null for any other hash (e.g. the #main skip-link target). */
const readHash = (): Page | null => {
  const p = window.location.hash.replace(/^#\/?/, '');
  return (PAGES as readonly string[]).includes(p) ? (p as Page) : null;
};

/** Tiny hash router: the page survives a reload and Back/Forward work, without a router dependency. */
export function useHashPage(): [Page, (p: Page) => void] {
  const [page, setPage] = useState<Page>(() => readHash() ?? 'overview');
  useEffect(() => {
    const on = () => { const p = readHash(); if (p) setPage(p); }; // unknown hashes (anchors) keep the current page
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [page, (p) => { window.location.hash = `/${p}`; }];
}

/**
 * Password rules shown live under the field; the API enforces the same ones (identity/crypto.ts).
 * \p{L} counts letters of any script but not Arabic-Indic digits; \p{Nd} counts digits of any script.
 */
export function passwordChecks(pw: string) {
  return { length: pw.length >= 8 && pw.length <= 128, letter: /\p{L}/u.test(pw), digit: /\p{Nd}/u.test(pw) };
}
