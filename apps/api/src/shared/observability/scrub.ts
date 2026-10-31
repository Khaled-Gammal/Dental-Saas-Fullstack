/**
 * Phase 1B (monitoring): what may leave this server for the error tracker. Pure functions, no SDK import, so they are
 * unit-tested on their own and reused by the worker's log alerts.
 *
 * The rule: a clinic's data never goes to a third party. Sentry gets the error type, its stack, the route pattern and our
 * own tags (request id, job name). It never gets request bodies, query strings, headers, cookies, the user, or
 * breadcrumbs, and the free text it does get (error messages, log fields) has emails, phone-like numbers and tokens
 * masked first — a database error can quote the value that broke it ("Key (phone)=(+2010...)").
 */

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
// JWTs and other bearer tokens that may sneak into a message
const TOKEN = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]+/g;
// phone and id numbers: 7+ digits (Latin or Arabic-Indic), optionally after "+", possibly split by single spaces or
// dashes ("010-1234-5678", "+20 100 123 4567"); not when glued to letters or digits, so UUIDs and hex ids stay readable
const NUMBER_RUN = /(?<![\p{L}\p{N}_-])\+?[0-9٠-٩](?:[ -]?[0-9٠-٩]){6,}(?![\p{L}\p{N}_])/gu;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/; // "2026-10-31 10" is a date and an hour, not a phone

export function redact(text: string): string {
  return text.replace(EMAIL, '[email]').replace(TOKEN, '[token]').replace(NUMBER_RUN, (m) => (DATE_LIKE.test(m) ? m : '[number]'));
}

/** "https://x/patients?q=Ahmed" -> "https://x/patients" (masked) */
export const stripQuery = (url: string): string => redact(url.split(/[?#]/)[0]);

/** Masks every string inside a log object / extra data (depth-limited: these are small, flat objects). */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redact(value);
  if (depth >= 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, depth + 1)]));
}

/** The fields of a Sentry event this file touches (structural, so it fits every SDK version's event type). */
export interface ScrubbableEvent {
  request?: { method?: string; url?: string; data?: unknown; query_string?: unknown; cookies?: unknown; headers?: unknown; env?: unknown };
  user?: unknown;
  breadcrumbs?: unknown;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
}

/**
 * A PostgreSQL error's message quotes the value that broke it (`invalid input syntax for type uuid: "<what was typed>"`,
 * `Key (phone)=(...)`): for those, only the code and the schema names it carries are sent, never the message or detail.
 */
export function databaseErrorText(original: unknown): string | undefined {
  const e = original as { code?: unknown; severity?: unknown; routine?: unknown; table?: unknown; column?: unknown; constraint?: unknown } | null;
  if (!e || typeof e !== 'object' || typeof e.code !== 'string' || !/^[0-9A-Z]{5}$/.test(e.code) || typeof e.severity !== 'string') return undefined;
  const parts = [`PostgreSQL error ${e.code}`];
  for (const k of ['routine', 'table', 'column', 'constraint'] as const) if (typeof e[k] === 'string') parts.push(`${k}=${e[k] as string}`);
  return parts.join(' ');
}

/** Applied to every event right before it is sent (beforeSend). Mutates and returns the event. */
export function scrubEvent<E extends ScrubbableEvent>(event: E, original?: unknown): E {
  const e = event as ScrubbableEvent;
  if (e.request) {
    // only the method and the path: no body, query string, headers, cookies or environment
    const url = e.request.url ? stripQuery(e.request.url) : undefined;
    e.request = { ...(e.request.method && { method: e.request.method }), ...(url && { url }) };
  }
  delete e.user;
  delete e.breadcrumbs;
  if (e.message) e.message = redact(e.message);
  const dbText = databaseErrorText(original);
  for (const v of e.exception?.values ?? []) if (v.value) v.value = dbText ?? redact(v.value);
  if (e.extra) e.extra = redactDeep(e.extra) as Record<string, unknown>;
  if (e.contexts) e.contexts = scrubContexts(e.contexts);
  return event;
}

// SDK contexts (runtime, os, a framework's request_path ...): strings masked, anything that looks like a path or URL
// loses its query string
function scrubContexts(contexts: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown, key: string, depth: number): unknown => {
    if (typeof v === 'string') return /(path|url)$/i.test(key) ? stripQuery(v) : redact(v);
    if (depth >= 4 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, key, depth + 1));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k, depth + 1)]));
  };
  return walk(contexts, '', 0) as Record<string, unknown>;
}

/** true the first time a key is seen in a window, false for repeats inside it (in-process). */
export function throttle(windowMs: number, now: () => number = Date.now): (key: string) => boolean {
  const last = new Map<string, number>();
  return (key) => {
    const t = now();
    const prev = last.get(key);
    if (prev !== undefined && t - prev < windowMs) return false;
    if (last.size > 1_000) last.clear(); // bounded: keys are route / job / error kinds, a few dozen in practice
    last.set(key, t);
    return true;
  };
}

/**
 * The worker logs a structured line at `level: 'error'` for what needs a human (an outbox event out of retries, an email
 * that finally failed, a stuck notification). This turns those lines into alerts without flooding: one per kind of line
 * per window. The kind is the line's field names plus its `type`, never its values (ids and messages vary).
 */
export function logAlerts(send: (key: string, line: Record<string, unknown>) => void, windowMs = 15 * 60_000, now: () => number = Date.now) {
  const first = throttle(windowMs, now);
  return (line: Record<string, unknown>): boolean => {
    if (line.level !== 'error') return false;
    const key = logKey(line);
    if (!first(key)) return false;
    send(key, line);
    return true;
  };
}

export const logKey = (line: Record<string, unknown>): string =>
  Object.keys(line).filter((k) => k !== 'level').sort().join(',') + (typeof line.type === 'string' ? `:${line.type}` : '');
