import type { Instrumentation } from 'next';
import { SAFE_INTEGRATIONS, scrubServerEvent } from './lib/sentry-scrub';

/**
 * Phase 1B (monitoring): server-side errors of the clinic websites (rendering a page, route handlers, server actions)
 * go to Sentry when SENTRY_DSN is set; nothing otherwise. Server only, Node runtime only: the pages are rendered on the
 * server, and the browser bundle stays free of the SDK. Errors only: no tracing, none of the SDK's automatic request
 * instrumentation (it would attach the booking form's data), and every event scrubbed before it leaves.
 */
export async function register() {
  if (!process.env.SENTRY_DSN || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    integrations: (defaults) => defaults.filter((i) => SAFE_INTEGRATIONS.has(i.name)),
    beforeSend: (event) => scrubServerEvent(event),
    beforeBreadcrumb: () => null,
    initialScope: { tags: { service: 'web' } },
  });
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
