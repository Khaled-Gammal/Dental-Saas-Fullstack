import { useState, type FormEvent } from 'react';
import { arName } from '@dental/ui/text';
import { addMonths, nextBookingQuery, planOpen, SURFACES, toMinor } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { navigate } from '../../hooks';
import { inMonthsLabel, recallReasonLabel, toothSurfaceLabel } from '../../labels';
import { ageOn } from '../../patient-model';
import { send, useClinicalMutation, usePatientPlans, usePlan, useServices, useVisit } from '../../queries';
import { to } from '../../router';
import type { NoteField, PlanItem, Prescription, RecallReason, Surface, Visit } from '../../types';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, LinkButton, PageHeader, TextArea } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { AlertIcon, CalendarIcon, PlusIcon } from '../../ui/icons';
import { Breadcrumbs, ResourceState, RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { ChartCard } from './chart';
import { money } from './money';
import { currencyLabel } from '../../money';
import { useCan } from '../../can';

const FIELDS: { f: NoteField; key: string; rows: number }[] = [
  { f: 'chief_complaint', key: 'الشكوى الرئيسية', rows: 2 }, { f: 'diagnosis', key: 'التشخيص', rows: 2 },
  { f: 'clinical_notes', key: 'الملاحظات السريرية', rows: 5 }, { f: 'next_visit_note', key: 'ملاحظة للزيارة القادمة', rows: 2 },
];
const CAMEL: Record<NoteField, string> = { chief_complaint: 'chiefComplaint', diagnosis: 'diagnosis', clinical_notes: 'clinicalNotes', next_visit_note: 'nextVisitNote' };
const REASONS: RecallReason[] = ['checkup', 'cleaning', 'ortho_adjustment', 'post_op', 'implant_followup', 'other'];
const loc = () => ('ar-EG-u-nu-latn');
const todayIso = () => new Date().toLocaleDateString('en-CA');

/**
 * `#/visits/<id>/view`: the doctor's workspace for one visit (SRS VISIT-001…004, CHART-001). The patient's allergies
 * and conditions stay on top (PATIENT-005). What the member may do comes from the API (`can`), which checks again.
 */
export function VisitPage({ clinicId, id, canInvoice = false }: { clinicId: string; id?: string; canInvoice?: boolean }) {
  const visit = useVisit(clinicId, id);
  if (!visit.data) {
    return <ResourceState isLoading={visit.isLoading} isError={visit.isError} error={visit.error} notFound={false} refetch={() => void visit.refetch()} back={to.list('appointments')} backLabel="المواعيد" />;
  }
  const v = visit.data;
  const p = v.patient;
  const age = p?.date_of_birth ? ageOn(p.date_of_birth, todayIso()) : null;
  const h = p?.medicalHistory;
  const when = new Intl.DateTimeFormat(loc(), { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(v.visit_at));
  return (
    <>
      <Breadcrumbs items={[{ label: 'المرضى', route: to.list('patients') }, ...(p ? [{ label: p.full_name, route: to.view('patients', p.id) }] : []), { label: 'الزيارة' }]} />
      <PageHeader
        title={p ? p.full_name : 'الزيارة'}
        sub={[p && `${'ملف رقم'} ${fmtNumber(p.file_no)}`, age !== null && `${fmtNumber(age)} ${'سنة'}`, arName(v.doctor.name_ar, v.doctor.name_en), arName(v.branch.name_ar, v.branch.name_en), when].filter(Boolean).join(' · ')}
        action={<Badge tone={v.status === 'final' ? 'neutral' : 'warning'}>{v.status === 'final' ? 'نهائية' : 'مسودة'}</Badge>}
      />
      {h && (h.allergies.length > 0 || h.is_pregnant || h.conditions.length > 0) && (
        <Alert tone="danger">
          <AlertIcon size={16} /> <strong>تنبيهات:</strong>{' '}
          {[...h.allergies.map((a) => `${'حساسية من'} ${a}`), ...(h.is_pregnant ? ['حامل'] : []), ...h.conditions].join(' · ')}
          {h.medications.length > 0 && <div className="small mt-sm">الأدوية الحالية: <bdi>{h.medications.join('، ')}</bdi></div>}
        </Alert>
      )}
      <div className="profile-grid">
        <div className="stack">
          <NotesCard clinicId={clinicId} v={v} />
          <ProceduresCard clinicId={clinicId} v={v} canInvoice={canInvoice} />
          <PrescriptionsCard clinicId={clinicId} v={v} />
        </div>
        <div className="stack">
          <NextVisitCard clinicId={clinicId} v={v} />
          {p && <ChartCard clinicId={clinicId} patientId={p.id} canWrite={v.can.chart} age={age} visitId={v.id} />}
        </div>
      </div>
    </>
  );
}

/** VISIT-002: a draft is edited; a final note is amended with a reason, the original kept and shown with every amendment. */
function NotesCard({ clinicId, v }: { clinicId: string; v: Visit }) {
  const [form, setForm] = useState<Record<NoteField, string>>(() => ({
    chief_complaint: v.chief_complaint ?? '', diagnosis: v.diagnosis ?? '', clinical_notes: v.clinical_notes ?? '', next_visit_note: v.next_visit_note ?? '',
  }));
  const [finalizing, setFinalizing] = useState(false);
  const [amending, setAmending] = useState<NoteField | null>(null);
  const save = useClinicalMutation(clinicId, () => send(`/visits/${v.id}`, 'PATCH',
    Object.fromEntries(FIELDS.filter(({ f }) => form[f] !== (v[f] ?? '')).map(({ f }) => [CAMEL[f], form[f].trim() || null]))));
  const finalize = useClinicalMutation(clinicId, async () => {
    if (FIELDS.some(({ f }) => form[f] !== (v[f] ?? ''))) await save.mutateAsync(undefined);
    return send(`/visits/${v.id}/finalize`, 'POST');
  });
  const dirty = FIELDS.some(({ f }) => form[f] !== (v[f] ?? ''));
  const fmt = new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' });

  if (v.status === 'draft' && v.can.writeNotes) {
    return (
      <Card>
        <h2>ملاحظات الزيارة</h2>
        <form className="stack mt" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          {FIELDS.map(({ f, key, rows }) => (
            <Field key={f} label={key} optional="اختياري">
              {(a) => <TextArea id={a.id} rows={rows} value={form[f]} onChange={(e) => setForm((x) => ({ ...x, [f]: e.target.value }))} maxLength={f === 'clinical_notes' ? 10000 : 2000} />}
            </Field>
          ))}
          <ErrorText error={save.error ?? finalize.error} />
          <div className="row-end">
            <Button variant="secondary" onClick={() => setFinalizing(true)}>اعتماد الملاحظات</Button>
            <Button type="submit" loading={save.isPending} disabled={!dirty}>حفظ</Button>
          </div>
        </form>
        <ConfirmDialog open={finalizing} title="اعتماد الملاحظات" confirmLabel="اعتماد الملاحظات"
          onConfirm={() => finalize.mutate(undefined, { onSettled: () => setFinalizing(false) })} onCancel={() => setFinalizing(false)}>
          <p>بعد الاعتماد لا تُعدَّل الملاحظات؛ أي تغيير يُضاف كتعديل له سبب ويبقى الأصل ظاهرًا.</p>
        </ConfirmDialog>
      </Card>
    );
  }
  return (
    <Card>
      <div className="row-between">
        <h2>ملاحظات الزيارة</h2>
        {v.finalized_at && <span className="muted small">اعتُمدت {fmt.format(new Date(v.finalized_at))}{v.finalized_by_name && <> · <bdi>{v.finalized_by_name}</bdi></>}</span>}
      </div>
      <dl className="detail-list mt">
        {FIELDS.map(({ f, key }) => {
          const changes = v.amendments.filter((a) => a.field === f);
          if (!v[f] && !changes.length && !(v.can.amend)) return null;
          return (
            <div key={f}>
              <dt>{key}</dt>
              <dd>
                {v[f] ? <p className="note-text">{v[f]}</p> : <span className="muted">—</span>}
                {changes.map((a) => (
                  <div key={a.id} className="amendment">
                    <span className="muted small">تعديل {fmt.format(new Date(a.created_at))}{a.author_name && <> · <bdi>{a.author_name}</bdi></>} · السبب: <bdi>{a.reason}</bdi></span>
                    <p className="note-text">{a.new_text}</p>
                  </div>
                ))}
                {v.can.amend && <LinkButton onClick={() => setAmending(f)}>إضافة تعديل</LinkButton>}
              </dd>
            </div>
          );
        })}
      </dl>
      {amending && <AmendDialog clinicId={clinicId} visitId={v.id} field={amending} onClose={() => setAmending(null)} />}
    </Card>
  );
}

function AmendDialog({ clinicId, visitId, field, onClose }: { clinicId: string; visitId: string; field: NoteField; onClose: () => void }) {
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const amend = useClinicalMutation(clinicId, () => send(`/visits/${visitId}/amendments`, 'POST', { field, text: text.trim(), reason: reason.trim() }));
  const label = FIELDS.find((x) => x.f === field)!.key;
  return (
    <ConfirmDialog open title={`${'إضافة تعديل'}: ${label}`} confirmLabel="حفظ التعديل"
      onConfirm={() => { if (text.trim() && reason.trim().length >= 3) amend.mutate(undefined, { onSuccess: onClose }); }} onCancel={onClose}>
      <p className="small muted">يُحفظ النص الجديد بجانب الأصل، ولا يُحذف شيء.</p>
      <Field label="النص الجديد">{(a) => <TextArea id={a.id} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} />}</Field>
      <Field label="سبب التعديل" hint="3 أحرف على الأقل">{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      <ErrorText error={amend.error} />
    </ConfirmDialog>
  );
}

/** VISIT-003: what was done. A procedure from the plan takes the item's service, tooth and estimated price. */
function ProceduresCard({ clinicId, v, canInvoice }: { clinicId: string; v: Visit; canInvoice: boolean }) {
  const [adding, setAdding] = useState(false);
  const remove = useClinicalMutation(clinicId, (procId: string) => send(`/visits/${v.id}/procedures/${procId}`, 'DELETE'));
  const total = v.procedures.reduce((s, p) => s + p.price_minor, 0);
  return (
    <Card>
      <div className="row-between">
        <h2>الإجراءات المنفذة</h2>
        <div className="row-end">
          {canInvoice && v.procedures.some((p) => !p.billed) && <RouteLink route={to.create('invoices', { patient: v.patient_id, visit: v.id })} className="btn btn-ghost">فاتورة لهذه الزيارة</RouteLink>}
          {v.can.procedures && !adding && <Button variant="secondary" onClick={() => setAdding(true)}><PlusIcon size={16} />إضافة إجراء</Button>}
        </div>
      </div>
      {v.procedures.length === 0 ? <p className="muted small mt-sm">لم يُسجَّل إجراء بعد.</p> : (
        <ul className="line-list mt">
          {v.procedures.map((p) => (
            <li key={p.id}>
              <span><strong><bdi>{arName(p.service_ar, p.service_en)}</bdi></strong>
                {p.tooth_code && <> · سن <bdi dir="ltr">{p.tooth_code}{p.surfaces.length ? ` ${p.surfaces.join('')}` : ''}</bdi></>}
                {p.plan_item_id && <Badge tone="primary">من الخطة</Badge>}
                {p.notes && <span className="muted small"> — <bdi>{p.notes}</bdi></span>}
              </span>
              <span className="line-end">
                <bdi>{money(p.price_minor)}</bdi>
                {v.can.procedures && v.status === 'draft' && !p.billed && (
                  <LinkButton onClick={() => remove.mutate(p.id)} aria-label={`${'إزالة'} ${arName(p.service_ar, p.service_en)}`}>إزالة</LinkButton>
                )}
              </span>
            </li>
          ))}
          <li className="line-total"><span>الإجمالي</span><strong><bdi>{money(total)}</bdi></strong></li>
        </ul>
      )}
      <ErrorText error={remove.error} />
      {adding && <ProcedureForm clinicId={clinicId} v={v} onDone={() => setAdding(false)} />}
    </Card>
  );
}

function ProcedureForm({ clinicId, v, onDone }: { clinicId: string; v: Visit; onDone: () => void }) {
  const services = useServices(clinicId);
  const plans = usePatientPlans(clinicId, v.patient_id);
  const openPlans = (plans.data ?? []).filter((p) => p.status === 'accepted' || p.status === 'in_progress');
  const [planId, setPlanId] = useState('');
  const plan = usePlan(clinicId, planId || openPlans[0]?.id);
  const items = (plan.data?.items ?? []).filter((i) => i.status === 'planned' || i.status === 'scheduled');
  const [itemId, setItemId] = useState('');
  const item: PlanItem | undefined = items.find((i) => i.id === itemId);
  const [serviceId, setServiceId] = useState('');
  const [tooth, setTooth] = useState('');
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const service = (services.data ?? []).find((s) => s.id === (item?.service_id ?? serviceId));
  const add = useClinicalMutation(clinicId, () => send(`/visits/${v.id}/procedures`, 'POST', {
    ...(item ? { planItemId: item.id } : { serviceId }),
    ...(tooth.trim() && { toothCode: Number(tooth) }), ...(surfaces.length && { surfaces }),
    ...(price.trim() && toMinor(price) !== null && { priceMinor: toMinor(price) }), ...(notes.trim() && { notes: notes.trim() }),
  }));
  const ready = (!!item || !!serviceId) && (!price.trim() || toMinor(price) !== null) && (!tooth.trim() || /^[1-8][1-8]$/.test(tooth));
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready) add.mutate(undefined, { onSuccess: onDone }); };
  return (
    <form className="stack mt tooth-panel" onSubmit={submit}>
      {openPlans.length > 0 && (
        <div className="grid-2">
          {openPlans.length > 1 && (
            <Field label="الخطة">
              {(a) => <Choice id={a.id} value={planId || openPlans[0].id} onChange={(x) => { setPlanId(x); setItemId(''); }} options={openPlans.map((p) => ({ value: p.id, label: p.title }))} />}
            </Field>
          )}
          <Field label="بند من خطة العلاج" optional="اختياري">
            {(a) => <Choice id={a.id} value={itemId} onChange={(x) => { setItemId(x); setPrice(''); }} noneLabel="ليس من الخطة"
              options={items.map((i) => ({ value: i.id, label: `${arName(i.service_ar, i.service_en)}${i.tooth_code ? ` · ${i.tooth_code}` : ''} · ${money(i.price_minor)}` }))} />}
          </Field>
        </div>
      )}
      <div className="grid-2">
        {!item && (
          <Field label="الخدمة">
            {(a) => <Choice id={a.id} value={serviceId} onChange={(x) => { setServiceId(x); setPrice(''); }} placeholder="اختر خدمة"
              options={(services.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: arName(s.name_ar, s.name_en) }))} />}
          </Field>
        )}
        <Field label="رقم السن (FDI)" optional="اختياري">
          {(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={tooth || (item?.tooth_code ? String(item.tooth_code) : '')} onChange={(e) => setTooth(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="36" />}
        </Field>
        <Field label={`${'السعر'} (${currencyLabel()})`} hint={service ? priceHint(service) : undefined}>
          {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
            placeholder={item ? String(item.price_minor / 100) : service && service.price_minor ? String(service.price_minor / 100) : ''} />}
        </Field>
        <Field label="ملاحظات" optional="اختياري">{(a) => <Input id={a.id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />}</Field>
      </div>
      <div className="chips" dir="ltr" role="group" aria-label="الأسطح">
        {SURFACES.map((s) => (
          <button key={s} type="button" className={`chip-toggle${surfaces.includes(s) ? ' is-on' : ''}`} aria-pressed={surfaces.includes(s)} title={toothSurfaceLabel[s]}
            onClick={() => setSurfaces((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{s}</button>
        ))}
      </div>
      <ErrorText error={add.error} />
      <div className="row-end">
        <Button variant="ghost" onClick={onDone}>إلغاء</Button>
        <Button type="submit" loading={add.isPending} disabled={!ready}>إضافة إجراء</Button>
      </div>
    </form>
  );
}

function priceHint(s: { price_minor: number; price_max_minor: number | null }): string {
  if (!s.price_minor) return 'السعر حسب الكشف: أدخل السعر';
  if (s.price_max_minor && s.price_max_minor > s.price_minor) return `${'نطاق السعر'} ${money(s.price_minor)} – ${money(s.price_max_minor)}`;
  return `${'سعر الخدمة'} ${money(s.price_minor)}`;
}

/** VISIT-004: issued at once and never edited; a correction is a new prescription and the old one stays, marked replaced. */
function PrescriptionsCard({ clinicId, v }: { clinicId: string; v: Visit }) {
  const [writing, setWriting] = useState<{ replaces?: Prescription } | null>(null);
  const fmt = new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' });
  return (
    <Card>
      <div className="row-between">
        <h2>الروشتات</h2>
        {v.can.prescribe && !writing && <Button variant="secondary" onClick={() => setWriting({})}><PlusIcon size={16} />روشتة جديدة</Button>}
      </div>
      {v.prescriptions.length === 0 ? <p className="muted small mt-sm">لا توجد روشتات لهذه الزيارة.</p> : (
        <ul className="stack mt">
          {v.prescriptions.map((rx) => (
            <li key={rx.id} className={`rx-item${rx.replaced_by_id ? ' is-replaced' : ''}`}>
              <div className="row-between">
                <span className="muted small">{fmt.format(new Date(rx.issued_at))}{rx.replaces_id && <> · تصحيح</>}</span>
                <span className="row-end">
                  {rx.replaced_by_id ? <Badge>استُبدلت</Badge> : (
                    <>
                      <RouteLink route={to.printPrescription(rx.id)} className="btn btn-ghost">طباعة</RouteLink>
                      {v.can.prescribe && <LinkButton onClick={() => setWriting({ replaces: rx })}>تصحيح</LinkButton>}
                    </>
                  )}
                </span>
              </div>
              <ol className="rx-lines">
                {rx.items.map((i) => (
                  <li key={i.id}><bdi dir="auto"><strong>{i.drug_name}</strong></bdi>{[i.dose, i.frequency, i.duration].filter(Boolean).map((x) => <span key={x}> · <bdi>{x}</bdi></span>)}
                    {i.instructions && <div className="muted small"><bdi>{i.instructions}</bdi></div>}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
      {writing && <PrescriptionForm clinicId={clinicId} visitId={v.id} replaces={writing.replaces} onDone={(id) => { setWriting(null); if (id) navigate(to.printPrescription(id)); }} />}
    </Card>
  );
}

type Line = { drugName: string; dose: string; frequency: string; duration: string; instructions: string };
const EMPTY_LINE: Line = { drugName: '', dose: '', frequency: '', duration: '', instructions: '' };

function PrescriptionForm({ clinicId, visitId, replaces, onDone }: { clinicId: string; visitId: string; replaces?: Prescription; onDone: (id?: string) => void }) {
  const [lines, setLines] = useState<Line[]>(() => replaces
    ? replaces.items.map((i) => ({ drugName: i.drug_name, dose: i.dose ?? '', frequency: i.frequency ?? '', duration: i.duration ?? '', instructions: i.instructions ?? '' }))
    : [{ ...EMPTY_LINE }]);
  const [notes, setNotes] = useState(replaces?.notes ?? '');
  const issue = useClinicalMutation(clinicId, () => send<Prescription>(`/visits/${visitId}/prescriptions`, 'POST', {
    items: lines.filter((l) => l.drugName.trim()).map((l) => Object.fromEntries(Object.entries(l).map(([k, x]) => [k, x.trim() || null]).filter(([k, x]) => k === 'drugName' || x))),
    ...(notes.trim() && { notes: notes.trim() }), ...(replaces && { replacesId: replaces.id }),
  }));
  const set = (i: number, k: keyof Line, x: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: x } : l)));
  const ready = lines.some((l) => l.drugName.trim());
  return (
    <form className="stack mt tooth-panel" onSubmit={(e) => { e.preventDefault(); if (ready) issue.mutate(undefined, { onSuccess: (rx) => onDone(rx.id) }); }}>
      {replaces && <Alert tone="info">تُصدر روشتة جديدة بدل هذه، وتبقى القديمة محفوظة ومعلَّمة بأنها استُبدلت.</Alert>}
      {lines.map((l, i) => (
        <fieldset key={i} className="rx-line-form">
          <legend className="small">الدواء {fmtNumber(i + 1)}</legend>
          <div className="grid-2">
            <Field label="اسم الدواء">{(a) => <Input id={a.id} dir="auto" value={l.drugName} onChange={(e) => set(i, 'drugName', e.target.value)} maxLength={200} placeholder="Amoxicillin 500mg" />}</Field>
            <Field label="الجرعة" optional="اختياري">{(a) => <Input id={a.id} value={l.dose} onChange={(e) => set(i, 'dose', e.target.value)} maxLength={100} />}</Field>
            <Field label="عدد المرات" optional="اختياري">{(a) => <Input id={a.id} value={l.frequency} onChange={(e) => set(i, 'frequency', e.target.value)} maxLength={100} />}</Field>
            <Field label="المدة" optional="اختياري">{(a) => <Input id={a.id} value={l.duration} onChange={(e) => set(i, 'duration', e.target.value)} maxLength={100} />}</Field>
          </div>
          <Field label="تعليمات" optional="اختياري">{(a) => <Input id={a.id} value={l.instructions} onChange={(e) => set(i, 'instructions', e.target.value)} maxLength={500} />}</Field>
          {lines.length > 1 && <LinkButton onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>إزالة</LinkButton>}
        </fieldset>
      ))}
      {lines.length < 20 && <LinkButton onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}><PlusIcon size={14} /> إضافة دواء</LinkButton>}
      <Field label="ملاحظات" optional="اختياري">{(a) => <Input id={a.id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}</Field>
      <ErrorText error={issue.error} />
      <div className="row-end">
        <Button variant="ghost" onClick={() => onDone()}>إلغاء</Button>
        <Button type="submit" loading={issue.isPending} disabled={!ready}>{replaces ? 'إصدار التصحيح' : 'إصدار الروشتة'}</Button>
      </div>
    </form>
  );
}

/** APPT-007 + VISIT-005: book the next appointment (pre-filled, linked to the next planned item) or add a follow-up. */
function NextVisitCard({ clinicId, v }: { clinicId: string; v: Visit }) {
  const plans = usePatientPlans(clinicId, v.patient_id);
  const open = (plans.data ?? []).find((p) => planOpen(p.status) && p.status !== 'draft' && p.status !== 'proposed' && p.doctor_id === v.doctor_id)
    ?? (plans.data ?? []).find((p) => p.status === 'accepted' || p.status === 'in_progress');
  const plan = usePlan(clinicId, open?.id);
  const next = plan.data?.next.item;
  const has = useCan();
  const [reason, setReason] = useState<RecallReason>('checkup');
  const [due, setDue] = useState(addMonths(todayIso(), 6));
  const [note, setNote] = useState('');
  const [added, setAdded] = useState(false);
  const add = useClinicalMutation(clinicId, () => send(`/patients/${v.patient_id}/recalls`, 'POST', { reason, dueDate: due, sourceVisitId: v.id, ...(note.trim() && { notes: note.trim() }) }));
  return (
    <Card>
      <h2>الزيارة القادمة</h2>
      {v.next_visit_note && <p className="history-notes mt-sm">{v.next_visit_note}</p>}
      {next && <p className="small mt-sm">البند التالي في الخطة: <strong><bdi>{arName(next.service_ar, next.service_en)}</bdi></strong>{next.tooth_code && <> · <bdi dir="ltr">{next.tooth_code}</bdi></>}</p>}
      {has('appointments:write') && (
        <div className="row-end mt">
          <RouteLink route={to.create('appointments', nextBookingQuery(v, plan.data))} className="btn btn-primary"><CalendarIcon size={16} />حجز الموعد القادم</RouteLink>
        </div>
      )}
      {has('patients:write') && <form className="stack mt" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => { setAdded(true); setNote(''); } }); }}>
        <h3>إضافة متابعة</h3>
        <div className="grid-2">
          <Field label="سبب المتابعة">
            {(a) => <Choice id={a.id} value={reason} onChange={(x) => setReason(x as RecallReason)} options={REASONS.map((r) => ({ value: r, label: recallReasonLabel[r] }))} />}
          </Field>
          <Field label="موعد الاستحقاق">{(a) => <DatePicker id={a.id} value={due} onChange={setDue} min={todayIso()} />}</Field>
        </div>
        <div className="chips">
          {[1, 3, 6, 12].map((m) => <button key={m} type="button" className={`chip-toggle${due === addMonths(todayIso(), m) ? ' is-on' : ''}`} onClick={() => setDue(addMonths(todayIso(), m))}>{inMonthsLabel[m]}</button>)}
        </div>
        <Field label="ملاحظات" optional="اختياري">{(a) => <Input id={a.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}</Field>
        {added && <Alert tone="success">أُضيفت المتابعة إلى قائمة المتابعات.</Alert>}
        <ErrorText error={add.error} />
        <div className="row-end"><Button type="submit" variant="secondary" loading={add.isPending}>إضافة متابعة</Button></div>
      </form>}
    </Card>
  );
}
