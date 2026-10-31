import * as Sentry from '@sentry/node';
import type { AppConfig } from '../../config';
import { logAlerts, scrubEvent, throttle } from './scrub';

/**
 * Phase 1B (monitoring): error tracking for the API and the worker. Off unless SENTRY_DSN is set (development and tests
 * send nothing).
 *
 * Errors only, no tracing or performance data, and none of the SDK's automatic HTTP / Express / database
 * instrumentation: those attach request bodies, URLs with query strings and SQL to events, and this system holds medical
 * records. What is reported is decided by our own code (the exception filter, the worker), and scrubEvent() strips each
 * event before it leaves. Because nothing is auto-instrumented, init does not have to run before the other imports.
 */

// the default integrations kept: they read the error itself, never the request or the process's I/O
// ('InboundFilters' was renamed 'EventFilters'; the Node context integration is 'Context')
const SAFE_INTEGRATIONS = new Set(['InboundFilters', 'EventFilters', 'FunctionToString', 'LinkedErrors', 'Dedupe', 'Context', 'ContextLines', 'OnUncaughtException']);

let enabled = false;

type SentryConfig = Pick<AppConfig, 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT' | 'SENTRY_RELEASE' | 'NODE_ENV'>;

export function initSentry(service: 'api' | 'worker', cfg: SentryConfig): boolean {
  if (!cfg.SENTRY_DSN || enabled) return enabled;
  Sentry.init({
    dsn: cfg.SENTRY_DSN,
    environment: cfg.SENTRY_ENVIRONMENT ?? cfg.NODE_ENV,
    release: cfg.SENTRY_RELEASE,
    sendDefaultPii: false,
    // no tracesSampleRate: tracing stays off entirely
    integrations: (defaults) => [
      ...defaults.filter((i) => SAFE_INTEGRATIONS.has(i.name)),
      // Node's own behaviour (crash on an unhandled rejection), reported first; the SDK's default would only warn
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
    beforeSend: (event, hint) => scrubEvent(event, hint?.originalException),
    beforeBreadcrumb: () => null, // breadcrumbs would carry console lines and URLs
    initialScope: { tags: { service } },
  });
  enabled = true;
  return true;
}

type Tags = Record<string, string | number | undefined>;

// One report per kind of error per place every 5 minutes: when something everything depends on breaks, every request
// and every job would otherwise send the same event, use up the quota and bury the rest.
const firstInWindow = throttle(5 * 60_000);
const errorKind = (err: unknown): string => {
  const e = err as { name?: unknown; code?: unknown; message?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : typeof err;
  const detail = typeof e?.code === 'string' ? e.code : typeof e?.message === 'string' ? e.message.slice(0, 80) : '';
  return `${name}:${detail}`;
};

/** Reports an unexpected error with our own tags (request id, route pattern, job). A no-op when Sentry is off. */
export function reportError(err: unknown, tags: Tags = {}, extra?: Record<string, unknown>): void {
  if (!enabled) return;
  if (!firstInWindow(`${tags.route ?? tags.job ?? tags.phase ?? ''}|${errorKind(err)}`)) return;
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) if (v !== undefined) scope.setTag(k, String(v));
    if (extra) scope.setExtras(extra);
    Sentry.captureException(err);
  });
}

/**
 * The worker's `log` sink: every line still goes to stdout; lines at `level: 'error'` also become a Sentry message,
 * at most one per kind every 15 minutes (outbox_dead is logged on every pass while dead events remain).
 */
export function workerLogSink(): (line: object) => void {
  const alert = logAlerts((key, line) => {
    if (!enabled) return;
    Sentry.withScope((scope) => {
      scope.setFingerprint(['worker-log', key]);
      if (typeof line.job === 'string') scope.setTag('job', line.job);
      scope.setExtras(line); // masked by scrubEvent
      Sentry.captureMessage(`worker: ${key}`, 'error');
    });
  });
  return (line) => {
    console.log(JSON.stringify(line));
    alert(line as Record<string, unknown>);
  };
}

/** Sends what is queued before the process exits (worker shutdown). */
export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (enabled) await Sentry.close(timeoutMs);
}
