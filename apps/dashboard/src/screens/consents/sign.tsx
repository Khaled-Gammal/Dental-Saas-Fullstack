import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Choice } from '../../components/choice';
import { SignaturePad } from '../../components/signature-pad';
import { defaultSigner, signable, signProblems, SIGNER_RELATIONS, type PatientConsent, type SignerRelation } from '../../consents-model';
import { useLeave } from '../../hooks';
import { t, type Key } from '../../i18n';
import { usePatient } from '../../queries';
import { to } from '../../router';
import type { PatientDetail } from '../../types';
import { Alert, Button, Card, ErrorText, Field, Input, Skeleton } from '../../ui/components';
import { Breadcrumbs } from '../../ui/page';
import { consentKeys, useConsentTexts } from './templates';

const today = () => new Date().toLocaleDateString('en-CA');

/**
 * `#/patients/<id>/sign` (H9, DSH-16): the patient — or a child's guardian — reads the consent on the clinic's tablet
 * or phone and signs with a finger. `?consent=<key>` picks the text and `?visit=<id>` links it to a visit (from the
 * visit's warning). What is stored is the text as the database holds it, not what this page shows.
 */
export function SignConsent({ clinicId, patientId, query }: { clinicId: string; patientId: string; query?: Record<string, string> }) {
  const patient = usePatient(clinicId, patientId);
  const texts = useConsentTexts(clinicId);
  if (!patient.data || !texts.data) {
    const err = patient.error ?? texts.error;
    return err ? <Card><ErrorText error={err} /></Card> : <Skeleton h={120} count={3} />;
  }
  return <SignForm clinicId={clinicId} patient={patient.data} texts={signable(texts.data)} query={query ?? {}} />;
}

function SignForm({ clinicId, patient, texts, query }: {
  clinicId: string; patient: PatientDetail; texts: ReturnType<typeof signable>; query: Record<string, string>;
}) {
  const start = defaultSigner(patient, today());
  const [key, setKey] = useState(texts.some((x) => x.key === query.consent) ? query.consent : texts.length === 1 ? texts[0].key : '');
  const [name, setName] = useState(start.name);
  const [relation, setRelation] = useState<SignerRelation>(start.relation);
  const [read, setRead] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const back = query.visit ? to.visit(query.visit) : to.view('patients', patient.id);
  const leave = useLeave(back);
  const qc = useQueryClient();
  const text = texts.find((x) => x.key === key);
  const problems = signProblems({ name, relation, read, signed: !!signature, minor: start.minor });
  const sign = useMutation({
    mutationFn: () => api<PatientConsent>(`/patients/${patient.id}/consents`, {
      method: 'POST',
      body: JSON.stringify({ templateKey: key, signerName: name.trim(), signerRelation: relation, visitId: query.visit ?? null, signature }),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: consentKeys.patient(clinicId, patient.id) });
      if (query.visit) void qc.invalidateQueries({ queryKey: ['clinical', clinicId, 'visit', query.visit] });
      leave(t('consentSignedNotice'));
    },
  });
  const submit = () => { setTried(true); if (text && !problems.length) sign.mutate(); };

  return (
    <>
      <Breadcrumbs items={[{ label: t('navPatients'), route: to.list('patients') }, { label: patient.full_name, route: to.view('patients', patient.id) }, { label: t('consentSign') }]} />
      <div className="sign-page">
        <h1>{t('consentSign')} — <bdi>{patient.full_name}</bdi></h1>
        {!texts.length && <Alert tone="info">{t('consentNoneSignable')}</Alert>}
        <Field label={t('consentWhich')}>
          {(a) => <Choice id={a.id} value={key} onChange={(v) => { setKey(v); setRead(false); }} placeholder={t('consentPick')} options={texts.map((x) => ({ value: x.key, label: x.title_ar }))} />}
        </Field>
        {text && (
          <Card className="consent-sheet">
            <h2><bdi>{text.title_ar}</bdi></h2>
            <div className="consent-text consent-text-large">{text.body_ar}</div>
          </Card>
        )}
        {start.minor && <Alert tone="info">{t('consentMinorNote')}</Alert>}
        <div className="grid-2">
          <Field label={t('consentSignerName')} error={tried && problems.includes('name') ? t('consentSignerNeeded') : undefined}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />}
          </Field>
          <Field label={t('consentSignerRelation')} error={problems.includes('relation') ? t('consentMinorNeedsGuardian') : undefined}>
            {(a) => <Choice id={a.id} value={relation} onChange={(v) => setRelation(v as SignerRelation)} options={SIGNER_RELATIONS.map((r) => ({ value: r, label: t(`rel_${r}` as Key) }))} />}
          </Field>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} disabled={!text} />
          <span>{t('consentReadCheck')}</span>
        </label>
        {tried && problems.includes('read') && <p className="field-error">{t('consentReadNeeded')}</p>}
        <SignaturePad onChange={setSignature} label={t('consentSignature')} />
        {tried && problems.includes('signature') && <p className="field-error">{t('consentSignatureNeeded')}</p>}
        <ErrorText error={sign.error} />
        <div className="row-end">
          <Button variant="ghost" onClick={() => leave()}>{t('cancel')}</Button>
          <Button onClick={submit} loading={sign.isPending} disabled={!text}>{t('consentSubmit')}</Button>
        </div>
      </div>
    </>
  );
}
