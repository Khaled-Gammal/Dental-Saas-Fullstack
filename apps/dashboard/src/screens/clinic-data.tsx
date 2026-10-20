import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, logout, setLoginNotice, type Session } from '../api';
import { confirmsClinic, downloadable, EXPORT_TONE, exportBusy, sizeText, type ExportRow } from '../clinic-data-model';
import { t, type Key } from '../i18n';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, PasswordInput, Skeleton } from '../ui/components';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { AlertIcon, ShieldIcon } from '../ui/icons';

const KEY = ['clinic-data', 'exports'] as const;
const when = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'long' }).format(new Date(iso));

/**
 * `#/data` (H8, NFR-08; owner only): export all the clinic's data, and delete the clinic. Both ask for the owner's
 * password again; deleting also asks for the clinic's name typed out, then a last confirmation.
 */
export function ClinicData({ session }: { session: Session }) {
  return (
    <>
      <PageHeader title={t('navData')} sub={t('dataSub')} />
      <ExportCard />
      <DeleteCard session={session} />
    </>
  );
}

function ExportCard() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: KEY, queryFn: () => api<ExportRow[]>('/clinic/data/exports'),
    refetchInterval: (q) => (exportBusy(q.state.data ?? []) ? 5_000 : false), // until the worker has finished it
  });
  const [password, setPassword] = useState('');
  const request = useMutation({
    mutationFn: () => api<ExportRow[]>('/clinic/data/exports', { method: 'POST', body: JSON.stringify({ password }) }),
    onSuccess: (rows) => { qc.setQueryData(KEY, rows); setPassword(''); },
  });
  const link = useMutation({
    mutationFn: (id: string) => api<{ url: string }>(`/clinic/data/exports/${id}/link`, { method: 'POST' }),
    onSuccess: ({ url }) => { window.location.assign(url); }, // a ZIP: the browser downloads it and stays on this page
  });
  const rows = list.data ?? [];
  const busy = exportBusy(rows);

  return (
    <Card>
      <h2>{t('exportTitle')}</h2>
      <p className="muted">{t('exportText')}</p>
      <form className="row-form mt" onSubmit={(e) => { e.preventDefault(); if (password) request.mutate(); }}>
        <Field label={t('passwordAgain')} hint={t('exportPasswordHint')}>
          {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            showLabel={t('showPw')} hideLabel={t('hidePw')} required maxLength={128} disabled={busy} />}
        </Field>
        <Button type="submit" loading={request.isPending} disabled={busy || !password}>{busy ? t('exportPreparing') : t('exportRequest')}</Button>
      </form>
      <ErrorText error={request.error} />
      <ErrorText error={link.error} />
      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : !list.data ? <Skeleton h={48} count={2} />
        : !rows.length ? <EmptyState icon={<ShieldIcon size={28} />} title={t('noExports')} text={t('noExportsText')} />
        : (
          <ul className="line-list mt">
            {rows.map((r) => (
              <li key={r.id}>
                <span>
                  <Badge tone={EXPORT_TONE[r.status]}>{t(`export_${r.status}` as Key)}</Badge>{' '}
                  <span className="small">{when(r.created_at)}</span>
                  {r.status === 'ready' && (
                    <span className="muted small block">
                      {sizeText(r.size_bytes)} · {t('exportFiles').replace('{n}', String(r.files_count ?? 0))}
                      {r.expires_at && <> · {t('exportUntil').replace('{date}', day(r.expires_at))}</>}
                    </span>
                  )}
                  {r.status === 'failed' && <span className="muted small block">{t('exportFailedText')}</span>}
                </span>
                {downloadable(r) && (
                  <span className="line-end">
                    <Button variant="secondary" loading={link.isPending && link.variables === r.id} onClick={() => link.mutate(r.id)}>{t('download')}</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function DeleteCard({ session }: { session: Session }) {
  const clinic = { nameAr: session.clinic.nameAr, nameEn: session.clinic.nameEn, slug: session.clinic.slug };
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: () => api<{ deleteAfter: string }>('/clinic/data/delete', { method: 'POST', body: JSON.stringify({ password, confirmName: name }) }),
    onSuccess: async ({ deleteAfter }) => {
      setLoginNotice(t('clinicDeletedNotice').replace('{date}', day(deleteAfter)));
      await logout();
    },
  });
  const ready = confirmsClinic(name, clinic) && password.length > 0;

  return (
    <Card className="card-danger">
      <h2>{t('deleteClinicTitle')}</h2>
      <Alert tone="danger">
        <strong>{t('deleteClinicWarn')}</strong>
        <ul className="mt-sm">
          <li>{t('deleteClinicNow')}</li>
          <li>{t('deleteClinicKept')}</li>
          <li>{t('deleteClinicGone')}</li>
        </ul>
      </Alert>
      <p className="muted mt-sm">{t('deleteClinicExportFirst')}</p>
      <form className="stack mt" onSubmit={(e) => { e.preventDefault(); if (ready) setConfirming(true); }}>
        <Field label={t('deleteClinicTypeName').replace('{name}', clinic.nameAr || clinic.nameEn || clinic.slug)}>
          {(a) => <Input id={a.id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" dir="auto" maxLength={200} />}
        </Field>
        <Field label={t('passwordAgain')}>
          {(a) => <PasswordInput id={a.id} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            showLabel={t('showPw')} hideLabel={t('hidePw')} maxLength={128} />}
        </Field>
        <ErrorText error={del.error} />
        <div><Button type="submit" variant="danger" disabled={!ready} loading={del.isPending}><AlertIcon size={16} /> {t('deleteClinic')}</Button></div>
      </form>
      <ConfirmDialog open={confirming} title={t('deleteClinic')} confirmLabel={t('deleteClinicConfirm')} danger
        onConfirm={() => { setConfirming(false); del.mutate(); }} onCancel={() => setConfirming(false)}>
        <p>{t('deleteClinicLast')}</p>
      </ConfirmDialog>
    </Card>
  );
}
