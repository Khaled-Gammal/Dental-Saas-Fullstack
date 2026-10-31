/**
 * Phase 1B (monitoring): what the dashboard may send to the error tracker. The dashboard shows patients' records, so
 * nothing typed or shown on screen goes out: no console lines, no query strings (a patient search is "?q=<name>"), no
 * request bodies or headers, no user. Errors keep their type, stack and the page path. Pure functions (unit-tested).
 */

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const TOKEN = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]+/g;
// phone and id numbers: 7+ digits, possibly split by single spaces or dashes; not glued to letters or digits (UUIDs)
const NUMBER_RUN = /(?<![\p{L}\p{N}_-])\+?[0-9٠-٩](?:[ -]?[0-9٠-٩]){6,}(?![\p{L}\p{N}_])/gu;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;

export function redact(text: string): string {
  return text.replace(EMAIL, '[email]').replace(TOKEN, '[token]').replace(NUMBER_RUN, (m) => (DATE_LIKE.test(m) ? m : '[number]'));
}

/**
 * Drops query strings, including the one inside the hash route the dashboard uses:
 * "https://app.example/?x=1#/patients?q=Ahmed" -> "https://app.example/#/patients" (and masked).
 */
export function stripQuery(url: string): string {
  const hashAt = url.indexOf('#');
  const base = (hashAt < 0 ? url : url.slice(0, hashAt)).split('?')[0];
  const route = hashAt < 0 ? '' : `#${url.slice(hashAt + 1).split('?')[0]}`;
  return redact(base + route);
}

export interface BrowserEvent {
  request?: { url?: string; headers?: unknown; cookies?: unknown; query_string?: unknown; data?: unknown };
  user?: unknown;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  extra?: unknown;
}

export function scrubBrowserEvent<E extends BrowserEvent>(event: E): E {
  const e = event as BrowserEvent;
  if (e.request) e.request = e.request.url ? { url: stripQuery(e.request.url) } : {};
  delete e.user;
  delete e.extra;
  if (e.message) e.message = redact(e.message);
  for (const v of e.exception?.values ?? []) if (v.value) v.value = redact(v.value);
  return event;
}

export interface Crumb { category?: string; message?: string; data?: Record<string, unknown> }

/**
 * Keeps what helps to reproduce an error (which page, which API call failed, that a click happened) without content:
 * console lines and typing are dropped (they can print a patient), clicks lose their selector, URLs their query
 * strings, other messages are masked.
 */
export function scrubBreadcrumb<C extends Crumb>(crumb: C): C | null {
  if (crumb.category === 'console' || crumb.category === 'ui.input') return null;
  const c = crumb as Crumb;
  // a click's message is the element's CSS selector, which carries aria-label / title / alt: "إزالة <a condition>",
  // a patient's name. The breadcrumb keeps only that a click happened.
  if (c.category?.startsWith('ui.')) delete c.message;
  if (c.message) c.message = redact(c.message);
  if (c.data) {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c.data)) {
      if (['url', 'from', 'to'].includes(k) && typeof v === 'string') data[k] = stripQuery(v);
      else if (['method', 'status_code'].includes(k)) data[k] = v;
      // everything else (request/response bodies, sizes, arguments) is left out
    }
    c.data = data;
  }
  return crumb;
}
