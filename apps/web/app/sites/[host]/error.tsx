'use client';
import { useEffect } from 'react';

/**
 * Shown when the clinic's data could not be loaded (the API is down or timed out). The visitor can retry; nothing
 * about the failure is shown to them. The error is logged in the browser console for support.
 */
export default function ClinicSiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('clinic site failed to load', error.digest ?? error.message); }, [error]);
  return (
    <div className="site">
      <main className="s-wrap s-state" role="alert">
        <h1>تعذّر تحميل موقع العيادة الآن</h1>
        <p>حدث خلل مؤقت. حاول مرة أخرى بعد لحظات.</p>
        <button type="button" className="s-btn s-btn-lg" onClick={reset}>إعادة المحاولة</button>
      </main>
    </div>
  );
}
