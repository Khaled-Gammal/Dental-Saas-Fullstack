import { useState, type FormEvent } from 'react';
import { arName } from '@dental/ui/text';
import { planEditable, planMoves, planOpen, SURFACES, toMinor } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { navigate } from '../../hooks';
import { planItemStatusLabel, planMoveLabel, planMoveText, planStatusLabel, toothSurfaceLabel } from '../../labels';
import { send, useClinicalMutation, usePatientPlans, usePlan, useServices } from '../../queries';
import { to } from '../../router';
import type { PlanDetail, PlanItem, PlanStatus, Surface } from '../../types';
import { Badge, Button, Card, ErrorText, Field, Input, LinkButton, PageHeader, Skeleton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { CalendarIcon, PlusIcon } from '../../ui/icons';
import { Breadcrumbs, ResourceState, RouteLink } from '../../ui/page';
import { clinicTimeZone, fmtNumber, LOC } from '../../util';
import { money } from './money';
import { currencyLabel } from '../../money';
import { useCan } from '../../can';

const TONE: Record<PlanStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  draft: 'neutral', proposed: 'warning', accepted: 'primary', in_progress: 'primary', completed: 'success', cancelled: 'neutral',
};
const ITEM_TONE: Record<PlanItem['status'], 'neutral' | 'primary' | 'success' | 'warning'> = { planned: 'neutral', scheduled: 'primary', done: 'success', cancelled: 'neutral' };

/** The plans of a patient on the profile (TPLAN-001): status, progress and estimate; a doctor starts a new one here. */
export function PlansCard({ clinicId, patientId, canCreate }: { clinicId: string; patientId: string; canCreate: boolean }) {
  const plans = usePatientPlans(clinicId, patientId);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const create = useClinicalMutation(clinicId, () => send<PlanDetail>(`/patients/${patientId}/plans`, 'POST', { title: title.trim() }));
  return (
    <Card>
      <div className="row-between">
        <h2>خطط العلاج</h2>
        {canCreate && !adding && <Button variant="secondary" onClick={() => setAdding(true)}><PlusIcon size={16} />خطة جديدة</Button>}
      </div>
      {adding && (
        <form className="row-end mt" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(undefined, { onSuccess: (p) => navigate(to.plan(p.id)) }); }}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="مثال: حشو وتنظيف" aria-label="اسم الخطة" autoFocus />
          <Button variant="ghost" onClick={() => setAdding(false)}>إلغاء</Button>
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>إنشاء الحساب</Button>
        </form>
      )}
      <ErrorText error={create.error} />
      {plans.isError ? <ErrorText error={plans.error} onRetry={() => void plans.refetch()} />
        : plans.isLoading ? <Skeleton h={48} count={2} />
        : !plans.data?.length ? <p className="muted small mt-sm">لا توجد خطط علاج.</p>
        : (
          <ul className="line-list mt">
            {plans.data.map((p) => (
              <li key={p.id}>
                <span>
                  <RouteLink route={to.plan(p.id)}><strong><bdi>{p.title}</bdi></strong></RouteLink>{' '}
                  <Badge tone={TONE[p.status]}>{planStatusLabel[p.status]}</Badge>
                  <span className="muted small"> · <bdi>{arName(p.doctor.name_ar, p.doctor.name_en)}</bdi> · {fmtNumber(p.summary.items_done)}/{fmtNumber(p.summary.items_total)} بنود منفذة</span>
                </span>
                <span className="line-end"><bdi>{money(p.summary.estimate_minor)}</bdi></span>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

/** `#/plans/<id>/view`: one plan (TPLAN-001…004): items, acceptance, progress, and booking the next planned item (APPT-007). */
export function PlanPage({ clinicId, id }: { clinicId: string; id?: string }) {
  const plan = usePlan(clinicId, id);
  const [moving, setMoving] = useState<'proposed' | 'accepted' | 'cancelled' | null>(null);
  const move = useClinicalMutation(clinicId, (to_: string) => send(`/plans/${id}/status`, 'POST', { to: to_ }));
  if (!plan.data) {
    return <ResourceState isLoading={plan.isLoading} isError={plan.isError} error={plan.error} notFound={false} refetch={() => void plan.refetch()} back={to.list('patients')} backLabel="المرضى" />;
  }
  const p = plan.data;
  const fmt = new Intl.DateTimeFormat(LOC, { dateStyle: 'medium', timeZone: clinicTimeZone() });
  return (
    <>
      <Breadcrumbs items={[{ label: 'المرضى', route: to.list('patients') }, { label: 'المريض', route: to.view('patients', p.patient_id) }, { label: p.title }]} />
      <PageHeader title={p.title} sub={`${arName(p.doctor.name_ar, p.doctor.name_en)}${p.accepted_at ? ` · ${'وافق المريض في'} ${fmt.format(new Date(p.accepted_at))}${p.accepted_by_name ? ` (${p.accepted_by_name})` : ''}` : ''}`}
        action={<div className="row-end">
          <Badge tone={TONE[p.status]}>{planStatusLabel[p.status]}</Badge>
          {p.can.write && planMoves(p.status).map((m) => (
            <Button key={m} variant={m === 'cancelled' ? 'ghost' : 'primary'} onClick={() => setMoving(m)}>{planMoveLabel[m]}</Button>
          ))}
        </div>} />
      <ErrorText error={move.error} />
      <div className="profile-grid">
        <div className="stack">
          <ItemsCard clinicId={clinicId} p={p} />
        </div>
        <div className="stack">
          <SummaryCard p={p} />
        </div>
      </div>
      <ConfirmDialog open={!!moving} title={moving ? planMoveLabel[moving] : ''} confirmLabel={moving ? planMoveLabel[moving] : ''} danger={moving === 'cancelled'}
        onConfirm={() => { if (moving) move.mutate(moving, { onSettled: () => setMoving(null) }); }} onCancel={() => setMoving(null)}>
        <p>{moving ? planMoveText[moving] : ''}</p>
      </ConfirmDialog>
    </>
  );
}

function SummaryCard({ p }: { p: PlanDetail }) {
  const s = p.summary;
  const pct = s.items_total ? Math.round((s.items_done / s.items_total) * 100) : 0;
  return (
    <Card>
      <h2>ملخص الخطة</h2>
      <div className="progress mt" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="التقدم"><span style={{ width: `${pct}%` }} /></div>
      <dl className="detail-list mt">
        <div><dt>بنود منفذة</dt><dd>{fmtNumber(s.items_done)} / {fmtNumber(s.items_total)}{s.items_cancelled > 0 && <span className="muted small"> · {fmtNumber(s.items_cancelled)} بنود ملغاة</span>}</dd></div>
        <div><dt>التقدير الإجمالي</dt><dd><bdi>{money(s.estimate_minor)}</bdi></dd></div>
        <div><dt>قيمة المنفذ</dt><dd><bdi>{money(s.done_estimate_minor)}</bdi></dd></div>
        <div><dt>المتبقي (تقديري)</dt><dd><strong><bdi>{money(s.remaining_estimate_minor)}</bdi></strong></dd></div>
      </dl>
      {p.billing && (
        <>
          <h3 className="mt">الفواتير والمدفوعات</h3>
          <dl className="detail-list mt-sm">
            <div><dt>المفوتر</dt><dd><bdi>{money(p.billing.invoiced_minor)}</bdi></dd></div>
            <div><dt>المدفوع</dt><dd><bdi>{money(p.billing.paid_minor)}</bdi></dd></div>
            <div><dt>المتبقي على المريض</dt><dd><strong className={p.billing.balance_minor > 0 ? 'text-owed' : undefined}><bdi>{money(p.billing.balance_minor)}</bdi></strong></dd></div>
          </dl>
          <p className="muted small mt-sm">من الفواتير الصادرة فقط. إذا ضمّت الفاتورة أعمالًا أخرى، يُحسب نصيب الخطة بنسبة بنودها من الفاتورة.</p>
        </>
      )}
      {(p.next.item || p.next.next_visit_note) && (
        <div className="mt">
          <h3>الزيارة الموصى بها</h3>
          {p.next.item && <p className="small"><bdi>{arName(p.next.item.service_ar, p.next.item.service_en)}</bdi>{p.next.item.tooth_code && <> · سن <bdi dir="ltr">{p.next.item.tooth_code}</bdi></>}</p>}
          {p.next.next_visit_note && <p className="history-notes small">{p.next.next_visit_note}</p>}
        </div>
      )}
    </Card>
  );
}

function ItemsCard({ clinicId, p }: { clinicId: string; p: PlanDetail }) {
  const [adding, setAdding] = useState(false);
  const act = useClinicalMutation(clinicId, (a: { itemId: string; op: 'cancel' | 'remove' }) =>
    send(`/plans/${p.id}/items/${a.itemId}${a.op === 'cancel' ? '/cancel' : ''}`, a.op === 'cancel' ? 'POST' : 'DELETE'));
  const editable = p.can.write && planEditable(p.status);
  const has = useCan();
  const bookable = p.can.schedule && has('appointments:write') && (p.status === 'accepted' || p.status === 'in_progress');
  const fmt = new Intl.DateTimeFormat(LOC, { dateStyle: 'medium', timeStyle: 'short', timeZone: clinicTimeZone() });
  return (
    <Card>
      <div className="row-between">
        <h2>بنود الخطة</h2>
        {editable && !adding && <Button variant="secondary" onClick={() => setAdding(true)}><PlusIcon size={16} />إضافة بند</Button>}
      </div>
      {!editable && p.can.write && planOpen(p.status) && <p className="muted small">بنود الخطة المعتمدة ثابتة؛ يمكن إلغاء بند فقط.</p>}
      {p.items.length === 0 ? <p className="muted small mt-sm">لا توجد بنود بعد.</p> : (
        <ul className="line-list mt">
          {p.items.map((i) => (
            <li key={i.id} className={i.status === 'cancelled' ? 'is-cancelled' : undefined}>
              <span>
                <strong><bdi>{arName(i.service_ar, i.service_en)}</bdi></strong>
                {i.tooth_code && <> · سن <bdi dir="ltr">{i.tooth_code}{i.surfaces.length ? ` ${i.surfaces.join('')}` : ''}</bdi></>}{' '}
                <Badge tone={ITEM_TONE[i.status]}>{planItemStatusLabel[i.status]}</Badge>
                {i.appointment_at && i.status === 'scheduled' && <span className="muted small"> · {fmt.format(new Date(i.appointment_at))}</span>}
                {i.done_visit_id && <> · <RouteLink route={to.visit(i.done_visit_id)}>الزيارة</RouteLink></>}
              </span>
              <span className="line-end">
                <bdi>{money(i.price_minor - i.discount_minor)}</bdi>
                {i.discount_minor > 0 && <span className="muted small"> (خصم تقديري <bdi>{money(i.discount_minor)}</bdi>)</span>}
                {bookable && i.status === 'planned' && (
                  <RouteLink route={to.create('appointments', { patient: p.patient_id, doctor: p.doctor_id, service: i.service_id, plan: p.id, item: i.id })} className="btn btn-ghost">
                    <CalendarIcon size={14} />حجز موعد
                  </RouteLink>
                )}
                {editable && <LinkButton onClick={() => act.mutate({ itemId: i.id, op: 'remove' })}>إزالة</LinkButton>}
                {p.can.write && !editable && planOpen(p.status) && (i.status === 'planned' || i.status === 'scheduled') && (
                  <LinkButton onClick={() => act.mutate({ itemId: i.id, op: 'cancel' })}>إلغاء البند</LinkButton>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={act.error} />
      {adding && <ItemForm clinicId={clinicId} planId={p.id} onDone={() => setAdding(false)} />}
    </Card>
  );
}

function ItemForm({ clinicId, planId, onDone }: { clinicId: string; planId: string; onDone: () => void }) {
  const services = useServices(clinicId);
  const [serviceId, setServiceId] = useState('');
  const [tooth, setTooth] = useState('');
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const service = (services.data ?? []).find((s) => s.id === serviceId);
  const add = useClinicalMutation(clinicId, () => send(`/plans/${planId}/items`, 'POST', {
    serviceId, ...(tooth && { toothCode: Number(tooth) }), ...(surfaces.length && { surfaces }),
    ...(price.trim() && { priceMinor: toMinor(price) }), ...(discount.trim() && { discountMinor: toMinor(discount) }),
  }));
  const ready = !!serviceId && (!price.trim() || toMinor(price) !== null) && (!discount.trim() || toMinor(discount) !== null) && (!tooth || /^[1-8][1-8]$/.test(tooth));
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready) add.mutate(undefined, { onSuccess: () => { setServiceId(''); setTooth(''); setSurfaces([]); setPrice(''); setDiscount(''); } }); };
  return (
    <form className="stack mt tooth-panel" onSubmit={submit}>
      <div className="grid-2">
        <Field label="الخدمة">
          {(a) => <Choice id={a.id} value={serviceId} onChange={setServiceId} placeholder="اختر خدمة"
            options={(services.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: arName(s.name_ar, s.name_en) }))} />}
        </Field>
        <Field label="رقم السن (FDI)" optional="اختياري">
          {(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={tooth} onChange={(e) => setTooth(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="36" />}
        </Field>
        <Field label={`${'السعر التقديري'} (${currencyLabel()})`} optional={service?.price_minor ? 'اختياري' : undefined}>
          {(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={service?.price_minor ? String(service.price_minor / 100) : ''} />}
        </Field>
        <Field label={`${'خصم تقديري'} (${currencyLabel()})`} optional="اختياري" hint="تقدير فقط؛ يُعتمد الخصم عند إصدار الفاتورة">
          {(a) => <Input id={a.id} describedBy={a.describedBy} dir="ltr" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />}
        </Field>
      </div>
      <div className="chips" dir="ltr" role="group" aria-label="الأسطح">
        {SURFACES.map((s) => (
          <button key={s} type="button" className={`chip-toggle${surfaces.includes(s) ? ' is-on' : ''}`} aria-pressed={surfaces.includes(s)} title={toothSurfaceLabel[s]}
            onClick={() => setSurfaces((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{s}</button>
        ))}
      </div>
      <ErrorText error={add.error} />
      <div className="row-end">
        <Button variant="ghost" onClick={onDone}>تم</Button>
        <Button type="submit" loading={add.isPending} disabled={!ready}>إضافة بند</Button>
      </div>
    </form>
  );
}
