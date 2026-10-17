import { useState, type FormEvent } from 'react';
import { pickName } from '@dental/ui/text';
import { toMinor } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { navigate } from '../../hooks';
import { t, type Lang } from '../../i18n';
import { money } from '../../money';
import { send, useBillingMutation, useBranches, usePatient, usePatientBilling, useServices } from '../../queries';
import { to } from '../../router';
import type { InvoiceDetail } from '../../types';
import { Button, Card, ErrorText, Field, Input, LinkButton, PageHeader } from '../../ui/components';
import { Breadcrumbs, ResourceState } from '../../ui/page';

type Line = { serviceId: string; description: string; price: string; qty: string };

/**
 * `#/invoices/new?patient=<id>[&visit=<id>]` (BILLING-001): a draft for one patient and one branch, from the
 * patient's unbilled procedures (a visit's are pre-selected) and/or service lines. Issuing happens on the invoice.
 */
export function NewInvoice({ lang, clinicId, query }: { lang: Lang; clinicId: string; query?: Record<string, string> }) {
  const patientId = query?.patient;
  const patient = usePatient(clinicId, patientId);
  const billing = usePatientBilling(clinicId, patientId);
  const branches = useBranches(clinicId);
  const services = useServices(clinicId);
  const unbilled = billing.data?.unbilled ?? [];
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(unbilled.filter((p) => !query?.visit || p.visit_id === query.visit).map((p) => p.id));
  const active = (branches.data ?? []).filter((b) => b.is_active);
  const visitBranch = unbilled.find((p) => p.visit_id === query?.visit)?.branch_id;
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
  if (!patient.data) {
    return <ResourceState isLoading={patient.isLoading} isError={patient.isError} error={patient.error} notFound={!patientId} refetch={() => void patient.refetch()} back={{ page: 'invoices' }} backLabel={t('navBilling', lang)} />;
  }
  const currency = billing.data?.currency ?? 'EGP';
  const toggle = (id: string) => { const s = new Set(chosen); if (s.has(id)) s.delete(id); else s.add(id); setPicked(s); };
  const set = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const ready = !!branch && (chosen.size > 0 || lines.some((l) => l.serviceId || (l.description.trim() && toMinor(l.price) !== null)));
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready) create.mutate(undefined, { onSuccess: (inv) => navigate(to.invoice(inv.id)) }); };
  return (
    <>
      <Breadcrumbs items={[{ label: t('navBilling', lang), route: { page: 'invoices' } }, { label: patient.data.full_name, route: to.view('patients', patient.data.id) }, { label: t('newInvoice', lang) }]} />
      <PageHeader title={t('newInvoice', lang)} sub={patient.data.full_name} />
      <form className="stack" onSubmit={submit}>
        <Card>
          <Field label={t('branch', lang)}>
            {(a) => <Choice id={a.id} lang={lang} value={branch} onChange={setBranchId} placeholder={t('pickBranch', lang)}
              options={active.map((b) => ({ value: b.id, label: pickName(lang, b.name_ar, b.name_en, b.slug) }))} />}
          </Field>
        </Card>
        <Card>
          <h2>{t('unbilledWork', lang)}</h2>
          {unbilled.length === 0 ? <p className="muted small mt-sm">{t('noUnbilled', lang)}</p> : (
            <ul className="line-list mt">
              {unbilled.map((p) => (
                <li key={p.id}>
                  <label className="check-row">
                    <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
                    <span><bdi>{pickName(lang, p.service_ar, p.service_en)}</bdi>{p.tooth_code && <> · <bdi dir="ltr">{p.tooth_code}</bdi></>}
                      <span className="muted small"> · <bdi>{pickName(lang, p.doctor_ar, p.doctor_en)}</bdi> · {p.visit_at.slice(0, 10)}</span></span>
                  </label>
                  <span className="line-end"><bdi>{money(p.price_minor, lang, currency)}</bdi></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="row-between">
            <h2>{t('otherLines', lang)}</h2>
            <Button variant="secondary" onClick={() => setLines((ls) => [...ls, { serviceId: '', description: '', price: '', qty: '1' }])}>{t('addLine', lang)}</Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid-2 mt tooth-panel">
              <Field label={t('service', lang)} optional={t('optional', lang)}>
                {(a) => <Choice id={a.id} lang={lang} value={l.serviceId} onChange={(v) => set(i, 'serviceId', v)} noneLabel={t('otherLine', lang)}
                  options={(services.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: pickName(lang, s.name_ar, s.name_en) }))} />}
              </Field>
              {!l.serviceId && <Field label={t('lineDescription', lang)}>{(a) => <Input id={a.id} value={l.description} onChange={(e) => set(i, 'description', e.target.value)} maxLength={300} />}</Field>}
              <Field label={t('unitPrice', lang)} optional={l.serviceId ? t('optional', lang) : undefined}>{(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={l.price} onChange={(e) => set(i, 'price', e.target.value)} />}</Field>
              <Field label={t('quantity', lang)}>{(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value.replace(/\D/g, '').slice(0, 3))} />}</Field>
              <LinkButton onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>{t('remove', lang)}</LinkButton>
            </div>
          ))}
        </Card>
        <ErrorText error={create.error} />
        <div className="row-end"><Button type="submit" loading={create.isPending} disabled={!ready}>{t('createDraft', lang)}</Button></div>
      </form>
    </>
  );
}
