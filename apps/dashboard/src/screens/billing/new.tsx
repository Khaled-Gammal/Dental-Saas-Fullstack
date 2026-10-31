import { useState, type FormEvent } from 'react';
import { arName } from '@dental/ui/text';
import { toMinor } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { navigate } from '../../hooks';
import { money } from '../../money';
import { send, useBillingMutation, useBranches, usePatient, usePatientBilling, useServices } from '../../queries';
import { to } from '../../router';
import type { InvoiceDetail } from '../../types';
import { Button, Card, Field, Input, LinkButton } from '../../ui/components';
import { FormPage, NotFound, ResourceState } from '../../ui/page';
import { Checkbox } from '../../components/ui/checkbox';

type Line = { serviceId: string; description: string; price: string; qty: string };

/**
 * `#/invoices/new?patient=<id>[&visit=<id>|&branch=<id>]` (BILLING-001): a draft for one patient and one branch, from the
 * patient's unbilled procedures (a visit's, or a branch's from the unbilled-work list, are pre-selected) and/or service lines. Issuing happens on the invoice.
 */
export function NewInvoice({ clinicId, query }: { clinicId: string; query?: Record<string, string> }) {
  const patientId = query?.patient;
  const patient = usePatient(clinicId, patientId);
  const billing = usePatientBilling(clinicId, patientId);
  const branches = useBranches(clinicId);
  const services = useServices(clinicId);
  const unbilled = billing.data?.unbilled ?? [];
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(unbilled.filter((p) => (!query?.visit || p.visit_id === query.visit) && (!query?.branch || p.branch_id === query.branch)).map((p) => p.id));
  const active = (branches.data ?? []).filter((b) => b.is_active);
  const visitBranch = unbilled.find((p) => p.visit_id === query?.visit)?.branch_id ?? unbilled.find((p) => p.branch_id === query?.branch)?.branch_id;
  const [branchId, setBranchId] = useState('');
  const branch = branchId || visitBranch || patient.data?.preferred_branch_id || (active.length === 1 ? active[0].id : '');
  const [lines, setLines] = useState<Line[]>([]);
  const create = useBillingMutation(clinicId, () => send<InvoiceDetail>('/invoices', 'POST', {
    patientId, branchId: branch, procedureIds: [...chosen],
    lines: lines.filter((l) => l.serviceId || (l.description.trim() && toMinor(l.price) !== null)).map((l) => ({
      ...(l.serviceId ? { serviceId: l.serviceId } : { description: l.description.trim() }), quantity: Number(l.qty) || 1,
      ...(l.price.trim() && toMinor(l.price) !== null && { unitPriceMinor: toMinor(l.price) }),
    })),
  }));
  // an invoice always starts from a patient (their profile or a visit); a bare link says so instead of "not found"
  if (!patientId) return <NotFound text="تبدأ الفاتورة من ملف المريض أو من زيارته. افتح ملف المريض ثم اختر «فاتورة جديدة»." back={{ page: 'patients' }} backLabel="المرضى" />;
  if (!patient.data) {
    return <ResourceState isLoading={patient.isLoading} isError={patient.isError} error={patient.error} notFound={!patientId} refetch={() => void patient.refetch()} back={{ page: 'invoices' }} backLabel="الفواتير" />;
  }
  const currency = billing.data?.currency ?? 'EGP';
  const toggle = (id: string) => { const s = new Set(chosen); if (s.has(id)) s.delete(id); else s.add(id); setPicked(s); };
  const set = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const ready = !!branch && (chosen.size > 0 || lines.some((l) => l.serviceId || (l.description.trim() && toMinor(l.price) !== null)));
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready) create.mutate(undefined, { onSuccess: (inv) => navigate(to.invoice(inv.id)) }); };
  return (
    <>
      {/* UI refinement U3: the shared form page (form width, Cancel and the create button in its footer) */}
      <FormPage title="فاتورة جديدة" sub={patient.data.full_name} crumbs={[{ label: 'الفواتير', route: { page: 'invoices' } }, { label: patient.data.full_name, route: to.view('patients', patient.data.id) }, { label: 'فاتورة جديدة' }]}
        back={to.view('patients', patient.data.id)} onSubmit={submit} saving={create.isPending} canSave={ready} error={create.error} saveLabel="إنشاء مسودة">
        <Card>
          <Field label="الفرع">
            {(a) => <Choice id={a.id} value={branch} onChange={setBranchId} placeholder="اختر الفرع"
              options={active.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en, b.slug) }))} />}
          </Field>
        </Card>
        <Card>
          <h2>إجراءات لم تُفوتر</h2>
          {unbilled.length === 0 ? <p className="muted small mt-sm">لا توجد إجراءات غير مفوترة.</p> : (
            <ul className="line-list mt">
              {unbilled.map((p) => (
                <li key={p.id}>
                  <label className="check-row">
                    <Checkbox checked={chosen.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                    <span><bdi>{arName(p.service_ar, p.service_en)}</bdi>{p.tooth_code && <> · <bdi dir="ltr">{p.tooth_code}</bdi></>}
                      <span className="muted small"> · <bdi>{arName(p.doctor_ar, p.doctor_en)}</bdi> · {p.visit_at.slice(0, 10)}</span></span>
                  </label>
                  <span className="line-end"><bdi>{money(p.price_minor, currency)}</bdi></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="row-between">
            <h2>بنود أخرى</h2>
            <Button variant="secondary" onClick={() => setLines((ls) => [...ls, { serviceId: '', description: '', price: '', qty: '1' }])}>إضافة بند</Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid-2 mt tooth-panel">
              <Field label="الخدمة" optional="اختياري">
                {(a) => <Choice id={a.id} value={l.serviceId} onChange={(v) => set(i, 'serviceId', v)} noneLabel="بند آخر (بدون خدمة)"
                  options={(services.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: arName(s.name_ar, s.name_en) }))} />}
              </Field>
              {!l.serviceId && <Field label="البيان">{(a) => <Input id={a.id} value={l.description} onChange={(e) => set(i, 'description', e.target.value)} maxLength={300} />}</Field>}
              <Field label="سعر الوحدة" optional={l.serviceId ? 'اختياري' : undefined}>{(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={l.price} onChange={(e) => set(i, 'price', e.target.value)} />}</Field>
              <Field label="الكمية">{(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value.replace(/\D/g, '').slice(0, 3))} />}</Field>
              <LinkButton onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>إزالة</LinkButton>
            </div>
          ))}
        </Card>
      </FormPage>
    </>
  );
}
