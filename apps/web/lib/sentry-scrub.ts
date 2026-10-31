/**
 * Phase 1B (monitoring): what the clinic websites' server may send to the error tracker. Visitors type their name and
 * phone into the booking form, so no request body, query string, header or cookie goes out, and free text has emails,
 * phone-like numbers and tokens masked. Same rules as the API's (apps/api/src/shared/observability/scrub.ts).
 */

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const TOKEN = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]+/g;
// Phase 2E: the patient's own booking link carries its key in the path (/appointment/<token>)
const MANAGE_PATH = /(\/appointment\/)[A-Za-z0-9_-]{20,}/g;
// phone and id numbers: 7+ digits, possibly split by single spaces or dashes; not glued to letters or digits (UUIDs)
const NUMBER_RUN = /(?<![\p{L}\p{N}_-])\+?[0-9٠-٩](?:[ -]?[0-9٠-٩]){6,}(?![\p{L}\p{N}_])/gu;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;

export function redact(text: string): string {
  return text.replace(MANAGE_PATH, '$1[token]').replace(EMAIL, '[email]').replace(TOKEN, '[token]').replace(NUMBER_RUN, (m) => (DATE_LIKE.test(m) ? m : '[number]'));
}

const stripQuery = (url: string): string => redact(url.split(/[?#]/)[0]);

/** The SDK integrations kept: they read the error itself, never the request (no Http / RequestData / Console). */
export const SAFE_INTEGRATIONS = new Set(['InboundFilters', 'EventFilters', 'FunctionToString', 'LinkedErrors', 'Dedupe', 'Context', 'ContextLines', 'OnUncaughtException', 'OnUnhandledRejection']);

export interface ServerEvent {
  request?: { method?: string; url?: string; data?: unknown; query_string?: unknown; cookies?: unknown; headers?: unknown; env?: unknown };
  user?: unknown;
  breadcrumbs?: unknown;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  extra?: unknown;
  contexts?: Record<string, unknown>;
}

export function scrubServerEvent<E extends ServerEvent>(event: E): E {
  const e = event as ServerEvent;
  if (e.request) {
    const url = e.request.url ? stripQuery(e.request.url) : undefined;
    e.request = { ...(e.request.method && { method: e.request.method }), ...(url && { url }) };
  }
  delete e.user;
  delete e.breadcrumbs;
  delete e.extra;
  if (e.message) e.message = redact(e.message);
  for (const v of e.exception?.values ?? []) if (v.value) v.value = redact(v.value);
  // captureRequestError puts the request path, query string included, in contexts.nextjs.request_path
  if (e.contexts) e.contexts = walk(e.contexts, '', 0) as Record<string, unknown>;
  return event;
}

function walk(v: unknown, key: string, depth: number): unknown {
  if (typeof v === 'string') return /(path|url)$/i.test(key) ? stripQuery(v) : redact(v);
  if (depth >= 4 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => walk(x, key, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k, depth + 1)]));
}
