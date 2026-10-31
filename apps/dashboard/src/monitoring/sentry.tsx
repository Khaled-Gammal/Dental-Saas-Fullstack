import * as Sentry from '@sentry/react';
import type { ReactNode } from 'react';
import { scrubBreadcrumb, scrubBrowserEvent } from './scrub';

/**
 * Phase 1B (monitoring): browser errors to Sentry when VITE_SENTRY_DSN is set at build time (off in development by
 * default). Errors only: no tracing, no session replay (it would record patients' records on screen), no user.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    beforeSend: (event) => scrubBrowserEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
}

/** Shown instead of a blank page when a screen crashes while rendering. */
function CrashScreen() {
  return (
    <div role="alert" dir="rtl" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--surface, #f8fafc)' }}>
      <div style={{ maxWidth: 420, textAlign: 'center', fontFamily: 'var(--font, Cairo, system-ui, sans-serif)', color: 'var(--ink, #0f172a)' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>حصل خطأ غير متوقع</h1>
        <p style={{ margin: '0 0 20px', color: 'var(--muted, #64748b)', lineHeight: 1.7 }}>
          أعد تحميل الصفحة. لو المشكلة اتكررت، تواصل مع الدعم وقول لهم كنت بتعمل إيه وقتها.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ background: 'var(--primary-500, #0e7490)', color: '#fff', border: 0, borderRadius: 'var(--r-md, 8px)', padding: '10px 20px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          إعادة تحميل الصفحة
        </button>
      </div>
    </div>
  );
}

/** Catches render errors anywhere in the app (reported when Sentry is on; the fallback shows either way). */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return <Sentry.ErrorBoundary fallback={<CrashScreen />}>{children}</Sentry.ErrorBoundary>;
}
