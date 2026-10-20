import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, refreshSession, type Session } from '../api';
import { t } from '../i18n';
import { legalHref, type LegalDoc, type LegalKind } from '../legal-model';
import { Alert, Button, ErrorText, Skeleton } from '../ui/components';
import { ShieldIcon } from '../ui/icons';

/** The current version of each published document (empty until the platform publishes them). */
export const useLegalDocs = () =>
  useQuery({ queryKey: ['legal'], queryFn: () => api<LegalDoc[]>('/public/legal'), staleTime: 5 * 60_000 });

const date = (iso?: string) => (iso ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'long' }).format(new Date(iso)) : '');

/** "I accept the Terms, the Privacy Policy and the agreement" with each title linking to its text (a new tab). */
export function LegalConsent({ docs, checked, onChange }: { docs: readonly LegalDoc[]; checked: boolean; onChange: (v: boolean) => void }) {
  if (!docs.length) return null;
  return (
    <label className="check-row legal-consent">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} required />
      <span>
        {t('legalAccept')}{' '}
        {docs.map((d, i) => (
          <span key={d.id}>
            {i > 0 && (i === docs.length - 1 ? ` ${t('and')} ` : '، ')}
            <a href={legalHref(d.kind)} target="_blank" rel="noopener noreferrer">{d.title_ar}</a>
          </span>
        ))}
      </span>
    </label>
  );
}

/**
 * After sign-in, when a new version asks to be accepted again (or a document was never accepted): nothing else opens
 * until the member accepts (the API refuses every other clinic request too).
 */
export function LegalGate({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const docs = session.legalPending ?? [];
  const accept = useMutation({
    mutationFn: () => api('/legal/accept', { method: 'POST', body: JSON.stringify({ documentIds: docs.map((d) => d.id) }) }),
    onSuccess: () => refreshSession(), // a new session without the pending documents
  });
  return (
    <>
      <header className="form-head">
        <div className="form-icon"><ShieldIcon size={22} /></div>
        <h2>{t('legalGateTitle')}</h2>
        <p>{t('legalGateSub')}</p>
      </header>
      <ul className="line-list">
        {docs.map((d) => (
          <li key={d.id}>
            <span><strong>{d.title_ar}</strong> <span className="muted small">({t('legalVersion').replace('{n}', String(d.version))})</span></span>
            <span className="line-end"><a href={legalHref(d.kind as LegalKind)} target="_blank" rel="noopener noreferrer">{t('legalRead')}</a></span>
          </li>
        ))}
      </ul>
      <form className="stack mt" onSubmit={(e) => { e.preventDefault(); if (agreed) accept.mutate(); }}>
        <LegalConsent docs={docs as LegalDoc[]} checked={agreed} onChange={setAgreed} />
        <ErrorText error={accept.error} />
        <Button type="submit" block loading={accept.isPending} disabled={!agreed}>{t('legalAcceptBtn')}</Button>
        <Button variant="ghost" block onClick={onSignOut}>{t('signOut')}</Button>
      </form>
    </>
  );
}

/** `#/legal/<kind>`: a document's current text, for anyone (no session needed). Plain text, paragraphs kept. */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const doc = useQuery({
    queryKey: ['legal', kind],
    queryFn: () => api<LegalDoc & { body_ar: string }>(`/public/legal/${kind}`),
    retry: false,
  });
  return (
    <main className="legal-page">
      {doc.isLoading ? <Skeleton h={48} count={4} />
        : doc.isError ? <Alert tone="info">{t('legalMissing')}</Alert>
        : (
          <article className="legal-doc">
            <h1>{doc.data!.title_ar}</h1>
            <p className="muted small">{t('legalVersion').replace('{n}', String(doc.data!.version))} · {t('legalPublished')} {date(doc.data!.published_at)}</p>
            <div className="legal-body">{doc.data!.body_ar}</div>
          </article>
        )}
      <p className="muted small mt"><a href="#/">{t('legalBack')}</a></p>
    </main>
  );
}
