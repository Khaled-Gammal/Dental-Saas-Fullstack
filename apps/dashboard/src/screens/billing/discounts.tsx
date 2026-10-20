import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { navigate } from '../../hooks';
import { money } from '../../money';
import { send, useBillingMutation, useDiscountLimits, useOverdueInstallments, usePendingDiscounts } from '../../queries';
import { to } from '../../router';
import type { OverdueInstallment, RoleLimit } from '../../types';
import { Badge, Button, Card, EmptyState, ErrorText, Input, PageHeader, Skeleton } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { ReceiptIcon, UsersIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { toMinor } from '../../clinical-model';
import { RowMenu } from '../../ui/row-menu';

/**
 * `#/discounts` (SRS DISC-002/003): the owner's approval queue for discounts above a role's limit, and each role's
 * limit (a percentage and an optional amount cap; CLR-02 starts receptionists at 10 % and accountants at 20 %).
 */
export function Discounts({ clinicId, canSetLimits }: { clinicId: string; canSetLimits: boolean }) {
  const pending = usePendingDiscounts(clinicId);
  const limits = useDiscountLimits(clinicId);
  return (
    <>
      <PageHeader title="الخصومات" sub="خصومات تنتظر موافقتك، وحد الخصم لكل دور." />
      <Card>
        <h2>بانتظار الموافقة</h2>
        {pending.isError ? <ErrorText error={pending.error} onRetry={() => void pending.refetch()} />
          : pending.isLoading ? <Skeleton h={48} count={2} />
          : !pending.data?.length ? <EmptyState icon={<ReceiptIcon size={28} />} title="لا خصومات بانتظار الموافقة." text="الخصم داخل حد الدور يُطبق مباشرة." />
          : (
            <ul className="line-list mt">
              {pending.data.map((i) => (
                <li key={i.id}>
                  <span>
                    <RouteLink route={to.invoice(i.id)}><strong><bdi>{i.patient.full_name}</bdi></strong></RouteLink>
                    <span className="muted small"> · طلبه <bdi>{i.discount_requested_by_name}</bdi></span>
                  </span>
                  <span className="line-end"><bdi>{money(i.subtotal_minor - i.discount_minor, i.currency)}</bdi><RouteLink route={to.invoice(i.id)} className="btn btn-secondary">مراجعة</RouteLink></span>
                </li>
              ))}
            </ul>
          )}
      </Card>
      <Card>
        <h2>حد الخصم لكل دور</h2>
        <p className="muted small">نسبة من إجمالي الفاتورة قبل الخصم، ومبلغ أقصى اختياري. ما يزيد ينتظر موافقة المالك.</p>
        {limits.isError ? <ErrorText error={limits.error} /> : !limits.data ? <Skeleton h={48} count={3} /> : (
          <ul className="line-list mt">
            {limits.data.map((r) => <LimitRow key={r.id} clinicId={clinicId} r={r} canEdit={canSetLimits && !r.unlimited} />)}
          </ul>
        )}
      </Card>
    </>
  );
}

function LimitRow({ clinicId, r, canEdit }: { clinicId: string; r: RoleLimit; canEdit: boolean }) {
  const [pct, setPct] = useState(String(r.max_discount_bp / 100));
  const [cap, setCap] = useState(r.max_discount_minor === null ? '' : String(r.max_discount_minor / 100));
  const bp = Math.round(Number(pct) * 100);
  const capMinor = cap.trim() ? toMinor(cap) : null;
  const dirty = bp !== r.max_discount_bp || capMinor !== r.max_discount_minor;
  const save = useBillingMutation(clinicId, () => send(`/discounts/limits/${r.id}`, 'PATCH', { maxDiscountBp: bp, maxDiscountMinor: capMinor }));
  const valid = Number.isFinite(bp) && bp >= 0 && bp <= 10000 && (!cap.trim() || capMinor !== null);
  return (
    <li>
      <span><strong>{arName(r.name_ar, r.name_en)}</strong>{r.unlimited && <> <Badge tone="primary">بلا حد</Badge></>}</span>
      {r.unlimited ? <span className="muted small">—</span> : canEdit ? (
        <span className="line-end">
          <label className="small">أقصى نسبة % <Input className="input-sm" dir="ltr" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="أقصى نسبة %" /></label>
          <label className="small">أقصى مبلغ <Input className="input-sm" dir="ltr" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="بدون" aria-label="أقصى مبلغ" /></label>
          <Button variant="secondary" disabled={!dirty || !valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>حفظ</Button>
          <ErrorText error={save.error} />
        </span>
      ) : (
        <span className="line-end">{fmtNumber(r.max_discount_bp / 100)}%{r.max_discount_minor !== null && <> · {money(r.max_discount_minor)}</>}</span>
      )}
    </li>
  );
}

/** Installments unpaid after their date (PAY-004), shown on the invoices page. */
/** What is still due on an installment (the same expression as before the table: amount minus what was paid on it). */
const installmentLeft = (i: OverdueInstallment) => i.amount_minor - i.paid_minor;

const OVERDUE_COLUMNS: Column<OverdueInstallment>[] = [
  {
    id: 'patient', header: 'المريض', sortValue: (i) => i.patient.full_name,
    cell: (i) => <RouteLink route={to.invoice(i.invoice_id)} className="font-semibold no-underline hover:underline"><bdi>{i.patient.full_name}</bdi></RouteLink>,
  },
  { id: 'phone', header: 'رقم الموبايل', hideOnMobile: true, cell: (i) => <bdi dir="ltr" className="tabular-nums">{i.patient.phone}</bdi> },
  { id: 'invoice', header: 'رقم الفاتورة', hideOnMobile: true, sortValue: (i) => i.number, cell: (i) => <bdi dir="ltr" className="whitespace-nowrap">{i.number}</bdi> },
  { id: 'seq', header: 'القسط', numeric: true, sortValue: (i) => i.seq, cell: (i) => fmtNumber(i.seq) },
  {
    id: 'due', header: 'موعد الاستحقاق', sortValue: (i) => i.due_date,
    cell: (i) => <span className="whitespace-nowrap"><span className="tabular-nums">{i.due_date}</span> <Badge tone="danger" dot>متأخرة</Badge></span>,
  },
  { id: 'left', header: 'المتبقي', numeric: true, sortValue: installmentLeft, cell: (i) => <bdi className="text-owed font-semibold">{money(installmentLeft(i), i.currency)}</bdi> },
];

/** The invoices page's «أقساط متأخرة» tab: installments past their date and not paid, oldest first (redesign R4: DataTable). */
export function OverdueInstallments({ clinicId }: { clinicId: string }) {
  const overdue = useOverdueInstallments(clinicId);
  return (
    <DataTable
      label="أقساط متأخرة"
      rows={overdue.data?.items}
      columns={OVERDUE_COLUMNS}
      rowKey={(i) => i.id}
      isLoading={overdue.isLoading}
      isFetching={overdue.isFetching}
      error={overdue.isError ? overdue.error : undefined}
      onRetry={() => void overdue.refetch()}
      search={{ placeholder: 'ابحث برقم الفاتورة أو اسم المريض', text: (i) => `${i.patient.full_name} ${i.patient.phone} ${i.number ?? ''} ${i.patient.file_no}` }}
      defaultSort={{ id: 'due', dir: 'asc' }}
      pageSize={20}
      onRowClick={(i) => navigate(to.invoice(i.invoice_id))}
      actions={(i) => (
        <RowMenu label={i.patient.full_name} actions={[
          { label: 'فتح الفاتورة', icon: <ReceiptIcon size={16} />, route: to.invoice(i.invoice_id) },
          { label: 'ملف المريض', icon: <UsersIcon size={16} />, route: to.view('patients', i.patient.id) },
        ]} />
      )}
      empty={{ icon: <ReceiptIcon size={28} />, title: 'لا أقساط متأخرة.', text: 'القسط يظهر هنا من اليوم التالي لتاريخه إن لم يُدفع.' }}
    />
  );
}
