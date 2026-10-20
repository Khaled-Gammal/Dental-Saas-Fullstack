import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadFile } from '../../api';
import { Choice } from '../../components/choice';
import { consentState, defaultSigner, signable, SIGNER_RELATIONS, type PatientConsent, type SignerRelation } from '../../consents-model';
import { t, type Key } from '../../i18n';
import { usePatient } from '../../queries';
import type { PatientDetail } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, Skeleton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { ShieldIcon } from '../../ui/icons';
import { Breadcrumbs, RouteLink } from '../../ui/page';
import { consentKeys, useConsentTexts } from './templates';

const when = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(iso));
const today = () => new Date().toLocaleDateString('en-CA');
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const MAX_BYTES = 20 * 1024 * 1024; // the API's CONSENT_POLICY.maxPaperBytes

export const usePatientConsents = (clinicId: string, patientId: string) =>
  useQuery({ queryKey: consentKeys.patient(clinicId, patientId), queryFn: () => api<PatientConsent[]>(`/patients/${patientId}/consents`) });

/**
 * The consents a patient signed (H9, DSH-16), on their profile: sign on screen (the signing page), record a paper form
 * (a photo or scan), open one to read or print it, withdraw one with a reason. Nothing signed is edited or deleted.
 */
export function PatientConsentsCard({ clinicId, patient, canSign }: { clinicId: string; patient: PatientDetail; canSign: boolean }) {
  const list = usePatientConsents(clinicId, patient.id);
  const [paper, setPaper] = useState(false);
  const [withdrawing, setWithdrawing] = useState<PatientConsent | null>(null);
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const withdraw = useMutation({
    mutationFn: (c: PatientConsent) => api(`/patients/${patient.id}/consents/${c.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }),
    onSuccess: () => { setWithdrawing(null); setReason(''); void qc.invalidateQueries({ queryKey: consentKeys.patient(clinicId, patient.id) }); },
  });
  const rows = list.data ?? [];

  return (
    <Card>
      <div className="row-between">
        <h2>{t('consentsTitle')}</h2>
        {canSign && (
          <div className="row-end">
            <Button variant="ghost" onClick={() => setPaper(true)}>{t('consentPaper')}</Button>
            <RouteLink route={{ page: 'patients', id: patient.id, action: 'sign' }} className="btn btn-secondary">{t('consentSign')}</RouteLink>
          </div>
        )}
      </div>
      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : !list.data ? <Skeleton h={40} count={2} />
        : !rows.length ? <EmptyState icon={<ShieldIcon size={24} />} title={t('noConsents')} text={t('noConsentsText')} />
        : (
          <ul className="line-list mt-sm">
            {rows.map((c) => (
              <li key={c.id} className={c.revoked_at ? 'is-cancelled' : undefined}>
                <span>
                  <RouteLink route={{ page: 'patients', id: patient.id, action: 'consent', query: { c: c.id } }}><bdi>{c.title}</bdi></RouteLink>{' '}
                  {consentState(c) === 'revoked' ? <Badge tone="warning">{t('consentWithdrawn')}</Badge> : <Badge tone="success">{t(c.method === 'paper' ? 'consentOnPaper' : 'consentOnScreen')}</Badge>}
                  <span className="muted small block">
                    {when(c.signed_at)} · <bdi>{c.signer_name}</bdi>{c.signer_relation !== 'self' && <> ({t(`rel_${c.signer_relation}` as Key)})</>}
                    {c.revoked_at && <> · {t('consentWithdrawnOn').replace('{date}', when(c.revoked_at))}: <bdi>{c.revoke_reason}</bdi></>}
                  </span>
                </span>
                {canSign && !c.revoked_at && <span className="line-end"><Button variant="ghost" onClick={() => setWithdrawing(c)}>{t('consentWithdraw')}</Button></span>}
              </li>
            ))}
          </ul>
        )}
      {paper && <PaperConsentDialog clinicId={clinicId} patient={patient} onClose={() => setPaper(false)} />}
      <ConfirmDialog open={!!withdrawing} title={t('consentWithdraw')} confirmLabel={t('consentWithdraw')} danger
        onConfirm={() => { if (withdrawing && reason.trim().length >= 3) withdraw.mutate(withdrawing); }} onCancel={() => { setWithdrawing(null); setReason(''); }}>
        <p>{t('consentWithdrawText')}</p>
        <Field label={t('reason')} hint={t('reasonHint')}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
        <ErrorText error={withdraw.error} />
      </ConfirmDialog>
    </Card>
  );
}

/** A form signed on paper: which text, who signed, and a photo or scan of it. */
function PaperConsentDialog({ clinicId, patient, onClose }: { clinicId: string; patient: PatientDetail; onClose: () => void }) {
  const texts = signable(useConsentTexts(clinicId).data ?? []);
  const start = defaultSigner(patient, today());
  const [key, setKey] = useState('');
  const [name, setName] = useState(start.name);
  const [relation, setRelation] = useState<SignerRelation>(start.relation);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: () => uploadFile<PatientConsent>(`/patients/${patient.id}/consents/paper`, file!, setProgress, undefined,
      { templateKey: key, signerName: name.trim(), signerRelation: relation }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: consentKeys.patient(clinicId, patient.id) }); onClose(); },
  });
  const tooBig = !!file && file.size > MAX_BYTES;
  const ready = !!key && name.trim().length >= 2 && !!file && !tooBig && !(start.minor && relation === 'self');

  return (
    <ConfirmDialog open title={t('consentPaper')} confirmLabel={send.isPending ? `${t('uploading')} ${Math.round(progress * 100)}%` : t('save')}
      onConfirm={() => { if (ready && !send.isPending) send.mutate(); }} onCancel={onClose}>
      <p className="muted small">{t('consentPaperText')}</p>
      {!texts.length && <Alert tone="info">{t('consentNoneSignable')}</Alert>}
      <Field label={t('consentWhich')}>
        {(a) => <Choice id={a.id} value={key} onChange={setKey} placeholder={t('consentPick')} options={texts.map((x) => ({ value: x.key, label: x.title_ar }))} />}
      </Field>
      <div className="grid-2">
        <Field label={t('consentSignerName')}>{(a) => <Input id={a.id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}</Field>
        <Field label={t('consentSignerRelation')} error={start.minor && relation === 'self' ? t('consentMinorNeedsGuardian') : undefined}>
          {(a) => <Choice id={a.id} value={relation} onChange={(v) => setRelation(v as SignerRelation)} options={SIGNER_RELATIONS.map((r) => ({ value: r, label: t(`rel_${r}` as Key) }))} />}
        </Field>
      </div>
      <Field label={t('consentScan')} error={tooBig ? t('fileTooBig') : undefined}>
        {(a) => <input id={a.id} ref={input} type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
      </Field>
      <ErrorText error={send.error} />
    </ConfirmDialog>
  );
}

/** `#/patients/<id>/consent?c=<consentId>`: one consent, as signed, ready to print. */
export function ConsentView({ clinicId, patientId, consentId }: { clinicId: string; patientId: string; consentId: string }) {
  const patient = usePatient(clinicId, patientId);
  const c = useQuery({ queryKey: [...consentKeys.patient(clinicId, patientId), consentId], queryFn: () => api<PatientConsent>(`/patients/${patientId}/consents/${consentId}`) });
  if (c.isError) return <Card><ErrorText error={c.error} onRetry={() => void c.refetch()} /></Card>;
  if (!c.data || !patient.data) return <Skeleton h={120} count={2} />;
  const d = c.data;
  return (
    <>
      <div className="no-print">
        <Breadcrumbs items={[{ label: t('navPatients'), route: { page: 'patients' } }, { label: patient.data.full_name, route: { page: 'patients', id: patientId, action: 'view' } }, { label: d.title }]} />
        <div className="row-end mt-sm"><Button onClick={() => window.print()}>{t('print')}</Button></div>
      </div>
      <Card className="consent-sheet">
        <h1><bdi>{d.title}</bdi></h1>
        {d.revoked_at && <Alert tone="danger">{t('consentWithdrawnOn').replace('{date}', when(d.revoked_at))}: <bdi>{d.revoke_reason}</bdi>{d.revoked_by_name && <> — {d.revoked_by_name}</>}</Alert>}
        <dl className="detail-list mt-sm">
          <div><dt>{t('consentPatient')}</dt><dd><bdi>{patient.data.full_name}</bdi></dd></div>
          <div><dt>{t('consentSignerName')}</dt><dd><bdi>{d.signer_name}</bdi>{d.signer_relation !== 'self' && <> ({t(`rel_${d.signer_relation}` as Key)})</>}</dd></div>
          <div><dt>{t('consentSignedAt')}</dt><dd>{when(d.signed_at)}</dd></div>
          {d.recorded_by_name && <div><dt>{t('consentRecordedBy')}</dt><dd>{d.recorded_by_name}</dd></div>}
          <div><dt>{t('consentVersionLabel')}</dt><dd>{d.version}</dd></div>
        </dl>
        <div className="consent-text mt">{d.body_snapshot}</div>
        <div className="mt">
          <h2>{t(d.method === 'paper' ? 'consentScan' : 'consentSignature')}</h2>
          {d.method === 'screen'
            ? <img className="consent-signature" src={d.file_url} alt={t('consentSignature')} />
            : <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary no-print">{t('consentOpenScan')}</a>}
        </div>
      </Card>
    </>
  );
}
