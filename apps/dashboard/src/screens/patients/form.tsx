import { useState, type FormEvent } from 'react';
import { pickName } from '@dental/ui/text';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { useDebounced, useLeave, useUnsavedChanges } from '../../hooks';
import { t, type Lang } from '../../i18n';
import { EMPTY_PATIENT, isMinor, patientBody, patientProblems, toPatientForm, type PatientForm as Form, type PatientProblem } from '../../patient-model';
import { useBranches, usePatient, usePossibleDuplicates, useSavePatient } from '../../queries';
import { to } from '../../router';
import type { PatientDetail } from '../../types';
import { Badge, Card, Field, Input, Switch, TextArea } from '../../ui/components';
import { FormPage, ResourceState, RouteLink } from '../../ui/page';

const today = () => new Date().toLocaleDateString('en-CA');
const RELATIONS = ['father', 'mother', 'sibling', 'spouse', 'legal_guardian', 'other'] as const;

/** `#/patients/new` and `#/patients/:id/edit`. */
export function PatientForm({ lang, clinicId, id }: { lang: Lang; clinicId: string; id?: string }) {
  const one = usePatient(clinicId, id);
  if (id && !one.data) {
    return <ResourceState isLoading={one.isLoading} isError={one.isError} error={one.error} notFound={false} refetch={() => void one.refetch()} back={to.list('patients')} backLabel={t('navPatients', lang)} />;
  }
  return <PatientFormBody key={id ?? 'new'} lang={lang} clinicId={clinicId} patient={one.data} />;
}

function PatientFormBody({ lang, clinicId, patient }: { lang: Lang; clinicId: string; patient?: PatientDetail }) {
  const [orig] = useState(() => (patient ? toPatientForm(patient) : null)); // frozen baseline: a background refetch cannot make the form dirty
  const [form, setForm] = useState<Form>(orig ?? EMPTY_PATIENT);
  const [touched, setTouched] = useState(false);
  const [showGuardian, setShowGuardian] = useState(() => !!(orig?.guardianName || orig?.guardianPhone || orig?.guardianRelation));
  const branches = useBranches(clinicId);
  const save = useSavePatient(clinicId, patient?.id);
  const leave = useLeave(patient ? to.view('patients', patient.id) : to.list('patients'));
  const body = patientBody(form, orig);
  const problems = patientProblems(form);
  const dirty = Object.keys(body).length > 0;
  const canSave = dirty && problems.length === 0;
  useUnsavedChanges(dirty, t('leaveUnsaved', lang));

  // registering someone new: show records with the same mobile, or the same name (أحمد = احمد) — a warning, never a block
  // debounced as a string: an object literal is a new value every render and would never settle
  const dupKey = useDebounced(JSON.stringify({
    phone: !patient && form.phone.replace(/\D/g, '').length >= 10 ? form.phone.trim() : '',
    fullName: !patient && form.fullName.trim().length >= 5 ? form.fullName.trim() : '',
    dateOfBirth: !patient ? form.dateOfBirth : '',
  }), 400);
  const dupQuery = JSON.parse(dupKey) as { phone: string; fullName: string; dateOfBirth: string };
  const duplicates = usePossibleDuplicates(clinicId, dupQuery).data ?? [];

  const minor = isMinor(form.dateOfBirth, today());
  const guardianOpen = showGuardian || minor;
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof Form) => (e: { target: { value: string } }) => set(k)(e.target.value as never);
  const err = (p: PatientProblem, key: Parameters<typeof t>[0]) => (touched && problems.includes(p) ? t(key, lang) : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!canSave) return;
    save.mutate(body, { onSuccess: (p) => leave(t('patientSaved', lang), to.view('patients', p.id)) });
  };

  const crumbs = [{ label: t('navPatients', lang), route: to.list('patients') }, ...(patient ? [{ label: patient.full_name, route: to.view('patients', patient.id) }] : []), { label: t(patient ? 'editPatient' : 'addPatient', lang) }];
  const branchOptions = (branches.data ?? []).filter((b) => b.is_active).map((b) => ({ value: b.id, label: pickName(lang, b.name_ar, b.name_en, b.slug) }));

  return (
    <FormPage title={t(patient ? 'editPatient' : 'addPatient', lang)} crumbs={crumbs} back={patient ? to.view('patients', patient.id) : to.list('patients')}
      onSubmit={submit} saving={save.isPending} canSave={dirty} error={save.error}
      notice={touched && problems.length > 0 && <p className="field-error">{t('fixErrors', lang)}</p>}>
      <Card>
        <h2>{t('secBasics', lang)}</h2>
        <div className="grid-2 mt">
          <Field label={t('patientFullName', lang)} error={err('name', 'needName')}>{(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.fullName} onChange={text('fullName')} maxLength={120} autoFocus={!patient} autoComplete="off" />}</Field>
          <Field label={t('gender', lang)} optional={t('optional', lang)}>
            {(a) => <Choice id={a.id} lang={lang} value={form.gender} onChange={(v) => set('gender')(v as Form['gender'])} noneLabel={t('notSet', lang)}
              options={[{ value: 'male', label: t('male', lang) }, { value: 'female', label: t('female', lang) }]} />}
          </Field>
          <Field label={t('dateOfBirth', lang)} optional={t('optional', lang)} hint={form.dateOfBirth && minor ? t('minorHint', lang) : undefined}>
            {(a) => <DatePicker id={a.id} lang={lang} value={form.dateOfBirth} onChange={set('dateOfBirth')} placeholder={t('pickDate', lang)} max={today()} min="1920-01-01" years />}
          </Field>
          <Field label={t('preferredBranch', lang)} optional={t('optional', lang)}>
            {(a) => <Choice id={a.id} lang={lang} value={form.preferredBranchId} onChange={set('preferredBranchId')} options={branchOptions} noneLabel={t('notSet', lang)} />}
          </Field>
        </div>
      </Card>

      <Card>
        <h2>{t('secContact', lang)}</h2>
        <div className="grid-2 mt">
          <Field label={t('phone', lang)} error={err('phone', 'err_invalid_phone')} hint={t('phoneHint', lang)}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} type="tel" dir="ltr" inputMode="tel" value={form.phone} onChange={text('phone')} placeholder="01012345678" />}
          </Field>
          <Field label={t('phoneAlt', lang)} optional={t('optional', lang)} error={err('phoneAlt', 'err_invalid_phone')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} type="tel" dir="ltr" inputMode="tel" value={form.phoneAlt} onChange={text('phoneAlt')} />}
          </Field>
          <Field label={t('email', lang)} optional={t('optional', lang)} error={err('email', 'invalidEmail')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} type="email" dir="ltr" value={form.email} onChange={text('email')} />}
          </Field>
          <Field label={t('city', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.city} onChange={text('city')} maxLength={80} />}</Field>
        </div>
        <div className="stack mt">
          <Field label={t('address', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.address} onChange={text('address')} maxLength={300} />}</Field>
        </div>
        {duplicates.length > 0 && (
          <div className="dup-box mt" role="status">
            <strong>{t('samePhoneTitle', lang)}</strong>
            <ul>{duplicates.slice(0, 5).map((d) => <li key={d.id}><RouteLink route={to.view('patients', d.id)}><bdi>{d.full_name}</bdi></RouteLink> <span className="muted small">#{d.file_no}</span></li>)}</ul>
            <p className="muted small">{t('samePhoneHint', lang)}</p>
          </div>
        )}
      </Card>

      <Card>
        <div className="row-between">
          <h2>{t('secGuardian', lang)}</h2>
          {minor ? <Badge tone="warning">{t('minor', lang)}</Badge> : !guardianOpen && <button type="button" className="link-btn" onClick={() => setShowGuardian(true)}>{t('addGuardian', lang)}</button>}
        </div>
        {guardianOpen ? (
          <div className="grid-2 mt">
            <Field label={t('guardianName', lang)} error={err('guardianName', 'needName')}>{(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.guardianName} onChange={text('guardianName')} maxLength={120} />}</Field>
            <Field label={t('guardianRelation', lang)}>
              {(a) => <Choice id={a.id} lang={lang} value={form.guardianRelation} onChange={(v) => set('guardianRelation')(v as Form['guardianRelation'])} noneLabel={t('notSet', lang)}
                options={RELATIONS.map((r) => ({ value: r, label: t(`rel_${r}`, lang) }))} />}
            </Field>
            <Field label={t('guardianPhone', lang)} optional={t('optional', lang)} error={err('guardianPhone', 'err_invalid_phone')}>
              {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} type="tel" dir="ltr" value={form.guardianPhone} onChange={text('guardianPhone')} />}
            </Field>
          </div>
        ) : <p className="muted small mt-sm">{t('guardianHint', lang)}</p>}
      </Card>

      <Card>
        <h2>{t('secMore', lang)}</h2>
        <div className="grid-2 mt">
          <Field label={t('occupation', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={form.occupation} onChange={text('occupation')} maxLength={80} />}</Field>
          <Field label={t('referralSource', lang)} optional={t('optional', lang)} hint={t('referralHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.referralSource} onChange={text('referralSource')} maxLength={60} />}</Field>
          <Field label={t('tags', lang)} optional={t('optional', lang)} hint={t('tagsHint', lang)}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.tags} onChange={text('tags')} maxLength={300} />}</Field>
        </div>
        <div className="stack mt">
          <Field label={t('notes', lang)} optional={t('optional', lang)}>{(a) => <TextArea id={a.id} value={form.notes} onChange={text('notes')} maxLength={2000} />}</Field>
          <Switch checked={form.marketingOptIn} onChange={set('marketingOptIn')} label={t('marketingOptIn', lang)} />
          <p className="muted small">{t('marketingHint', lang)}</p>
          {patient && <Switch checked={form.isBlocked} onChange={set('isBlocked')} label={t('blockBooking', lang)} />}
          {patient && <p className="muted small">{t('blockBookingHint', lang)}</p>}
        </div>
      </Card>
    </FormPage>
  );
}
