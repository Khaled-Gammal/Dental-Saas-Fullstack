import { useState, type FormEvent } from 'react';
import { arName } from '@dental/ui/text';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { useDebounced, useLeave, useUnsavedChanges } from '../../hooks';
import { signerRelationLabel } from '../../labels';
import { EMPTY_PATIENT, isMinor, patientBody, patientProblems, toPatientForm, type PatientForm as Form, type PatientProblem } from '../../patient-model';
import { useBranches, usePatient, usePossibleDuplicates, useSavePatient } from '../../queries';
import { to } from '../../router';
import type { PatientDetail } from '../../types';
import { Badge, Card, Field, Input, Switch, TextArea } from '../../ui/components';
import { FormPage, ResourceState, RouteLink } from '../../ui/page';
import { useCan } from '../../can';
import { clinicToday } from '../../util';

const RELATIONS = ['father', 'mother', 'sibling', 'spouse', 'legal_guardian', 'other'] as const;

/** `#/patients/new` and `#/patients/:id/edit`. */
export function PatientForm({ clinicId, id }: { clinicId: string; id?: string }) {
  const one = usePatient(clinicId, id);
  if (id && !one.data) {
    return <ResourceState isLoading={one.isLoading} isError={one.isError} error={one.error} notFound={false} refetch={() => void one.refetch()} back={to.list('patients')} backLabel="المرضى" />;
  }
  return <PatientFormBody key={id ?? 'new'} clinicId={clinicId} patient={one.data} />;
}

function PatientFormBody({ clinicId, patient }: { clinicId: string; patient?: PatientDetail }) {
  const [orig] = useState(() => (patient ? toPatientForm(patient) : null)); // frozen baseline: a background refetch cannot make the form dirty
  const canBlock = useCan()('patients:block');
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
  useUnsavedChanges(dirty, 'لديك تغييرات غير محفوظة. هل تريد المغادرة بدون حفظ؟');

  // registering someone new: show records with the same mobile, or the same name (أحمد = احمد) — a warning, never a block
  // debounced as a string: an object literal is a new value every render and would never settle
  const dupKey = useDebounced(JSON.stringify({
    phone: !patient && form.phone.replace(/\D/g, '').length >= 10 ? form.phone.trim() : '',
    fullName: !patient && form.fullName.trim().length >= 5 ? form.fullName.trim() : '',
    dateOfBirth: !patient ? form.dateOfBirth : '',
  }), 400);
  const dupQuery = JSON.parse(dupKey) as { phone: string; fullName: string; dateOfBirth: string };
  const duplicates = usePossibleDuplicates(clinicId, dupQuery).data ?? [];

  const minor = isMinor(form.dateOfBirth, clinicToday());
  const guardianOpen = showGuardian || minor;
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof Form) => (e: { target: { value: string } }) => set(k)(e.target.value as never);
  const err = (p: PatientProblem, key: string) => (touched && problems.includes(p) ? key : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!canSave) return;
    save.mutate(body, { onSuccess: (p) => leave('تم حفظ بيانات المريض', to.view('patients', p.id)) });
  };

  const crumbs = [{ label: 'المرضى', route: to.list('patients') }, ...(patient ? [{ label: patient.full_name, route: to.view('patients', patient.id) }] : []), { label: patient ? 'تعديل بيانات المريض' : 'مريض جديد' }];
  const branchOptions = (branches.data ?? []).filter((b) => b.is_active).map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en, b.slug) }));

  return (
    <FormPage title={patient ? 'تعديل بيانات المريض' : 'مريض جديد'} crumbs={crumbs} back={patient ? to.view('patients', patient.id) : to.list('patients')}
      onSubmit={submit} saving={save.isPending} canSave={dirty} error={save.error}
      notice={touched && problems.length > 0 && <p className="field-error">صحّح الأخطاء المظللة ثم احفظ</p>}>
      <Card>
        <h2>البيانات الأساسية</h2>
        <div className="grid-2 mt">
          <Field label="الاسم الكامل" error={err('name', 'أدخل الاسم بالعربية أو الإنجليزية')}>{(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.fullName} onChange={text('fullName')} maxLength={120} autoFocus={!patient} autoComplete="off" />}</Field>
          <Field label="النوع" optional="اختياري">
            {(a) => <Choice id={a.id} value={form.gender} onChange={(v) => set('gender')(v as Form['gender'])} noneLabel="غير محدد"
              options={[{ value: 'male', label: 'ذكر' }, { value: 'female', label: 'أنثى' }]} />}
          </Field>
          <Field label="تاريخ الميلاد" optional="اختياري" hint={form.dateOfBirth && minor ? 'أقل من 18 سنة: أضف ولي الأمر لتوقيع الموافقات.' : undefined}>
            {(a) => <DatePicker id={a.id} value={form.dateOfBirth} onChange={set('dateOfBirth')} placeholder="اختر التاريخ" max={clinicToday()} min="1920-01-01" years />}
          </Field>
          <Field label="الفرع المفضّل" optional="اختياري">
            {(a) => <Choice id={a.id} value={form.preferredBranchId} onChange={set('preferredBranchId')} options={branchOptions} noneLabel="غير محدد" />}
          </Field>
        </div>
      </Card>

      <Card>
        <h2>التواصل</h2>
        <div className="grid-2 mt">
          <Field label="رقم الموبايل" error={err('phone', 'رقم الموبايل غير صحيح.')} hint="يكفي الرقم المحلي مثل 01012345678">
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} type="tel" dir="ltr" inputMode="tel" value={form.phone} onChange={text('phone')} placeholder="01012345678" />}
          </Field>
          <Field label="موبايل آخر" optional="اختياري" error={err('phoneAlt', 'رقم الموبايل غير صحيح.')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} type="tel" dir="ltr" inputMode="tel" value={form.phoneAlt} onChange={text('phoneAlt')} />}
          </Field>
          <Field label="البريد الإلكتروني" optional="اختياري" error={err('email', 'البريد الإلكتروني غير صحيح.')}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} type="email" dir="ltr" value={form.email} onChange={text('email')} />}
          </Field>
          <Field label="المدينة" optional="اختياري">{(a) => <Input id={a.id} value={form.city} onChange={text('city')} maxLength={80} />}</Field>
        </div>
        <div className="stack mt">
          <Field label="العنوان" optional="اختياري">{(a) => <Input id={a.id} value={form.address} onChange={text('address')} maxLength={300} />}</Field>
        </div>
        {duplicates.length > 0 && (
          <div className="dup-box mt" role="status">
            <strong>ملفات قد تكون لنفس الشخص (نفس الرقم أو الاسم)</strong>
            <ul>{duplicates.slice(0, 5).map((d) => <li key={d.id}><RouteLink route={to.view('patients', d.id)}><bdi>{d.full_name}</bdi></RouteLink> <span className="muted small">#{d.file_no}</span></li>)}</ul>
            <p className="muted small">أفراد الأسرة قد يشتركون في رقم واحد؛ افتح الملف إن كان نفس الشخص بدل إنشاء ملف مكرر.</p>
          </div>
        )}
      </Card>

      <Card>
        <div className="row-between">
          <h2>ولي الأمر</h2>
          {minor ? <Badge tone="warning">قاصر</Badge> : !guardianOpen && <button type="button" className="link-btn" onClick={() => setShowGuardian(true)}>إضافة ولي أمر</button>}
        </div>
        {guardianOpen ? (
          <div className="grid-2 mt">
            <Field label="اسم ولي الأمر" error={err('guardianName', 'أدخل الاسم بالعربية أو الإنجليزية')}>{(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.guardianName} onChange={text('guardianName')} maxLength={120} />}</Field>
            <Field label="صلة القرابة">
              {(a) => <Choice id={a.id} value={form.guardianRelation} onChange={(v) => set('guardianRelation')(v as Form['guardianRelation'])} noneLabel="غير محدد"
                options={RELATIONS.map((r) => ({ value: r, label: signerRelationLabel[r] }))} />}
            </Field>
            <Field label="موبايل ولي الأمر" optional="اختياري" error={err('guardianPhone', 'رقم الموبايل غير صحيح.')}>
              {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} type="tel" dir="ltr" value={form.guardianPhone} onChange={text('guardianPhone')} />}
            </Field>
          </div>
        ) : <p className="muted small mt-sm">للأطفال ومن لا يستطيع التوقيع بنفسه.</p>}
      </Card>

      <Card>
        <h2>معلومات إضافية</h2>
        <div className="grid-2 mt">
          <Field label="المهنة" optional="اختياري">{(a) => <Input id={a.id} value={form.occupation} onChange={text('occupation')} maxLength={80} />}</Field>
          <Field label="كيف عرف العيادة" optional="اختياري" hint="مثل: فيسبوك، صديق، الموقع">{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.referralSource} onChange={text('referralSource')} maxLength={60} />}</Field>
          <Field label="وسوم" optional="اختياري" hint="افصل بينها بفاصلة">{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.tags} onChange={text('tags')} maxLength={300} />}</Field>
        </div>
        <div className="stack mt">
          <Field label="ملاحظات" optional="اختياري">{(a) => <TextArea id={a.id} value={form.notes} onChange={text('notes')} maxLength={2000} />}</Field>
          <Switch checked={form.marketingOptIn} onChange={set('marketingOptIn')} label="يوافق على تلقي العروض والرسائل التسويقية" />
          <p className="muted small">بموافقة صريحة من المريض فقط (قانون حماية البيانات الشخصية 151/2020). تُسجَّل لحظة الموافقة أو سحبها.</p>
          {patient && canBlock && <Switch checked={form.isBlocked} onChange={set('isBlocked')} label="منع هذا المريض من الحجز" />}
          {patient && canBlock && <p className="muted small">بعد تكرار عدم الحضور أو الحجوزات الوهمية. يُرفض الحجز عبر الموقع ومن الاستقبال حتى إلغاء المنع.</p>}
        </div>
      </Card>
    </FormPage>
  );
}
