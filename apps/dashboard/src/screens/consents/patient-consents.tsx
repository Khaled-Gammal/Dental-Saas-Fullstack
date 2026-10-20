import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadFile } from '../../api';
import { Choice } from '../../components/choice';
import { FilePicker } from '../../components/file-picker';
import { consentState, defaultSigner, signable, SIGNER_RELATIONS, type PatientConsent, type SignerRelation } from '../../consents-model';
import { signerRelationLabel } from '../../labels';
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
        <h2>الموافقات</h2>
        {canSign && (
          <div className="row-end">
            <Button variant="ghost" onClick={() => setPaper(true)}>موافقة ورقية</Button>
            <RouteLink route={{ page: 'patients', id: patient.id, action: 'sign' }} className="btn btn-secondary">توقيع موافقة</RouteLink>
          </div>
        )}
      </div>
      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : !list.data ? <Skeleton h={40} count={2} />
        : !rows.length ? <EmptyState icon={<ShieldIcon size={24} />} title="لا توجد موافقات" text="يوقّع المريض على الشاشة، أو ترفع صورة من نموذج وقّعه على الورق." />
        : (
          <ul className="line-list mt-sm">
            {rows.map((c) => (
              <li key={c.id} className={c.revoked_at ? 'is-cancelled' : undefined}>
                <span>
                  <RouteLink route={{ page: 'patients', id: patient.id, action: 'consent', query: { c: c.id } }}><bdi>{c.title}</bdi></RouteLink>{' '}
                  {consentState(c) === 'revoked' ? <Badge tone="warning">مسحوبة</Badge> : <Badge tone="success">{c.method === 'paper' ? 'ورقية' : 'على الشاشة'}</Badge>}
                  <span className="muted small block">
                    {when(c.signed_at)} · <bdi>{c.signer_name}</bdi>{c.signer_relation !== 'self' && <> ({signerRelationLabel[c.signer_relation]})</>}
                    {c.revoked_at && <> · {'سُحبت في {date}'.replace('{date}', when(c.revoked_at))}: <bdi>{c.revoke_reason}</bdi></>}
                  </span>
                </span>
                {canSign && !c.revoked_at && <span className="line-end"><Button variant="ghost" onClick={() => setWithdrawing(c)}>سحب الموافقة</Button></span>}
              </li>
            ))}
          </ul>
        )}
      {paper && <PaperConsentDialog clinicId={clinicId} patient={patient} onClose={() => setPaper(false)} />}
      <ConfirmDialog open={!!withdrawing} title="سحب الموافقة" confirmLabel="سحب الموافقة" danger
        onConfirm={() => { if (withdrawing && reason.trim().length >= 3) withdraw.mutate(withdrawing); }} onCancel={() => { setWithdrawing(null); setReason(''); }}>
        <p>تبقى الموافقة في الملف كما وُقّعت، مع سبب سحبها وتاريخه.</p>
        <Field label="السبب" hint="3 أحرف على الأقل">{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
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
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: () => uploadFile<PatientConsent>(`/patients/${patient.id}/consents/paper`, file!, setProgress, undefined,
      { templateKey: key, signerName: name.trim(), signerRelation: relation }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: consentKeys.patient(clinicId, patient.id) }); onClose(); },
  });
  const tooBig = !!file && file.size > MAX_BYTES;
  const ready = !!key && name.trim().length >= 2 && !!file && !tooBig && !(start.minor && relation === 'self');

  return (
    <ConfirmDialog open title="موافقة ورقية" confirmLabel={send.isPending ? `${'جارٍ رفع'} ${Math.round(progress * 100)}%` : 'حفظ'}
      onConfirm={() => { if (ready && !send.isPending) send.mutate(); }} onCancel={onClose}>
      <p className="muted small">المريض وقّع النموذج على الورق: اختر النموذج، واكتب من وقّع، وارفع صورة أو ملف PDF للنموذج الموقّع.</p>
      {!texts.length && <Alert tone="info">لا توجد نماذج معتمدة. يراجع مالك العيادة النماذج ويعتمدها من «نماذج الموافقات».</Alert>}
      <Field label="النموذج">
        {(a) => <Choice id={a.id} value={key} onChange={setKey} placeholder="اختر النموذج" options={texts.map((x) => ({ value: x.key, label: x.title_ar }))} />}
      </Field>
      <div className="grid-2">
        <Field label="اسم من يوقّع">{(a) => <Input id={a.id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}</Field>
        <Field label="صفته" error={start.minor && relation === 'self' ? 'المريض قاصر: يوقّع ولي الأمر.' : undefined}>
          {(a) => <Choice id={a.id} value={relation} onChange={(v) => setRelation(v as SignerRelation)} options={SIGNER_RELATIONS.map((r) => ({ value: r, label: signerRelationLabel[r] }))} />}
        </Field>
      </div>
      <Field label="صورة النموذج الموقّع" error={tooBig ? 'الملف أكبر من 20 ميجابايت.' : undefined}>
        {(a) => <FilePicker id={a.id} describedBy={a.describedBy} accept={ACCEPT} file={file} onChange={setFile} disabled={send.isPending} />}
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
        <Breadcrumbs items={[{ label: 'المرضى', route: { page: 'patients' } }, { label: patient.data.full_name, route: { page: 'patients', id: patientId, action: 'view' } }, { label: d.title }]} />
        <div className="row-end mt-sm"><Button onClick={() => window.print()}>طباعة</Button></div>
      </div>
      <Card className="consent-sheet">
        <h1><bdi>{d.title}</bdi></h1>
        {d.revoked_at && <Alert tone="danger">{'سُحبت في {date}'.replace('{date}', when(d.revoked_at))}: <bdi>{d.revoke_reason}</bdi>{d.revoked_by_name && <> — {d.revoked_by_name}</>}</Alert>}
        <dl className="detail-list mt-sm">
          <div><dt>المريض</dt><dd><bdi>{patient.data.full_name}</bdi></dd></div>
          <div><dt>اسم من يوقّع</dt><dd><bdi>{d.signer_name}</bdi>{d.signer_relation !== 'self' && <> ({signerRelationLabel[d.signer_relation]})</>}</dd></div>
          <div><dt>وقت التوقيع</dt><dd>{when(d.signed_at)}</dd></div>
          {d.recorded_by_name && <div><dt>سجّلها</dt><dd>{d.recorded_by_name}</dd></div>}
          <div><dt>إصدار النص</dt><dd>{d.version}</dd></div>
        </dl>
        <div className="consent-text mt">{d.body_snapshot}</div>
        <div className="mt">
          <h2>{d.method === 'paper' ? 'صورة النموذج الموقّع' : 'التوقيع'}</h2>
          {d.method === 'screen'
            ? <img className="consent-signature" src={d.file_url} alt="التوقيع" />
            : <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary no-print">فتح صورة النموذج</a>}
        </div>
      </Card>
    </>
  );
}
