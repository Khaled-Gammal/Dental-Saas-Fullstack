import type { ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import { paymentMethodLabel } from '../../labels';
import { money } from '../../money';
import { useBranches, useInvoice, usePaymentReceipt, useProfile } from '../../queries';
import { to } from '../../router';
import type { ClinicProfile } from '../../types';
import { Button } from '../../ui/components';
import { Breadcrumbs, ResourceState } from '../../ui/page';
import { clinicTimeZone, fmtNumber, LOC } from '../../util';

const ar = (minor: number, currency: string) => money(minor, currency);
const when = (iso: string) => new Intl.DateTimeFormat(LOC, { dateStyle: 'long', timeStyle: 'short', timeZone: clinicTimeZone() }).format(new Date(iso));

/** The clinic header of every printout: name, logo, branch address and phone. */
function Head({ clinic, branchId, branches, title, children }: {
  clinic: ClinicProfile | undefined; branchId: string; branches: ReturnType<typeof useBranches>['data']; title: string; children?: ReactNode;
}) {
  const branch = branches?.find((b) => b.id === branchId);
  return (
    <header className="rx-head">
      <div>
        <h1 className="rx-clinic">{clinic ? arName(clinic.nameAr, clinic.nameEn) : ''}</h1>
        {branch && <p className="rx-branch">{arName(branch.name_ar, branch.name_en)}{branch.address_ar && ` — ${branch.address_ar}`}{branch.phone && <> · <bdi dir="ltr">{branch.phone}</bdi></>}</p>}
        <p className="rx-doc-title">{title}</p>
        {children}
      </div>
      {clinic?.logo && <img className="rx-logo" src={clinic.logo.thumbUrl} alt="" />}
    </header>
  );
}

/** `#/invoices/<id>/print` (BILLING-004, CLR-17): A4, Arabic, right to left, printed from the browser. */
export function InvoicePrint({ clinicId, id }: { clinicId: string; id?: string }) {
  const inv = useInvoice(clinicId, id);
  const profile = useProfile(clinicId);
  const branches = useBranches(clinicId);
  if (!inv.data) return <ResourceState isLoading={inv.isLoading} isError={inv.isError} error={inv.error} notFound={false} refetch={() => void inv.refetch()} back={{ page: 'invoices' }} backLabel="الفواتير" />;
  const v = inv.data;
  const paidPayments = v.payments.filter((p) => p.status !== 'reversed');
  return (
    <>
      <div className="no-print">
        <Breadcrumbs items={[{ label: 'الفواتير', route: { page: 'invoices' } }, { label: v.number ?? '', route: to.invoice(v.id) }, { label: 'طباعة' }]} />
        <div className="row-end mt-sm"><Button onClick={() => window.print()}>طباعة</Button></div>
      </div>
      <style>{'@page { size: A4; margin: 12mm; }'}</style>
      <article className="rx-sheet rx-a4" dir="rtl" lang="ar">
        <Head clinic={profile.data} branchId={v.branch_id} branches={branches.data} title={v.status === 'void' ? `${'فاتورة'} (${'ملغاة'})` : 'فاتورة'} />
        <dl className="rx-patient">
          <div><dt>رقم الفاتورة</dt><dd><bdi dir="ltr">{v.number}</bdi></dd></div>
          <div><dt>التاريخ</dt><dd>{v.issue_date}</dd></div>
          <div><dt>المريض</dt><dd><bdi>{v.patient.full_name}</bdi></dd></div>
          <div><dt>ملف رقم</dt><dd>{fmtNumber(v.patient.file_no)}</dd></div>
        </dl>
        <table className="print-table">
          <thead><tr><th>#</th><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {v.lines.map((l, i) => (
              <tr key={l.id}><td>{fmtNumber(i + 1)}</td><td><bdi>{l.description}</bdi></td><td>{fmtNumber(l.quantity)}</td><td>{ar(l.unit_price_minor, v.currency)}</td><td>{ar(l.line_total_minor, v.currency)}</td></tr>
            ))}
          </tbody>
        </table>
        <dl className="print-totals">
          <div><dt>المجموع</dt><dd>{ar(v.subtotal_minor, v.currency)}</dd></div>
          {v.discount_minor > 0 && <div><dt>الخصم</dt><dd>− {ar(v.discount_minor, v.currency)}</dd></div>}
          {v.tax_minor > 0 && <div><dt>الضريبة</dt><dd>{ar(v.tax_minor, v.currency)}</dd></div>}
          <div className="is-total"><dt>الإجمالي</dt><dd>{ar(v.total_minor, v.currency)}</dd></div>
          <div><dt>المدفوع</dt><dd>{ar(v.paid_minor, v.currency)}</dd></div>
          <div className="is-total"><dt>المتبقي</dt><dd>{ar(v.balance_minor, v.currency)}</dd></div>
        </dl>
        {paidPayments.length > 0 && (
          <div className="rx-note">المدفوعات: {paidPayments.map((p) => `${ar(p.amount_minor - p.refunded_minor, p.currency)} (${paymentMethodLabel[p.method]})`).join('، ')}</div>
        )}
        {v.notes && <p className="rx-note">{v.notes}</p>}
      </article>
    </>
  );
}

/** `#/payments/<id>/print` (BILLING-004, CLR-17): the A5 receipt — amount, method, reference, date, receiver, what remains. */
export function ReceiptPrint({ clinicId, id }: { clinicId: string; id?: string }) {
  const rc = usePaymentReceipt(clinicId, id);
  const profile = useProfile(clinicId);
  const branches = useBranches(clinicId);
  if (!rc.data) return <ResourceState isLoading={rc.isLoading} isError={rc.isError} error={rc.error} notFound={false} refetch={() => void rc.refetch()} back={{ page: 'invoices' }} backLabel="الفواتير" />;
  const p = rc.data;
  return (
    <>
      <div className="no-print">
        <Breadcrumbs items={[{ label: 'الفواتير', route: { page: 'invoices' } }, ...(p.invoice ? [{ label: p.invoice.number ?? '', route: to.invoice(p.invoice.id) }] : []), { label: 'إيصال' }]} />
        <div className="row-end mt-sm"><Button onClick={() => window.print()}>طباعة</Button></div>
      </div>
      <style>{'@page { size: A5; margin: 10mm; }'}</style>
      <article className="rx-sheet rx-a5" dir="rtl" lang="ar">
        <Head clinic={profile.data} branchId={p.branch_id} branches={branches.data} title="إيصال" />
        {p.status === 'reversed' && <p className="rx-note"><strong>ملغاة (خطأ إدخال)</strong> — {p.reversal_reason}</p>}
        <dl className="rx-patient">
          {p.invoice && <div><dt>المريض</dt><dd><bdi>{p.invoice.patient.full_name}</bdi></dd></div>}
          {p.invoice && <div><dt>رقم الفاتورة</dt><dd><bdi dir="ltr">{p.invoice.number}</bdi></dd></div>}
          <div><dt>التاريخ</dt><dd>{when(p.paid_at)}</dd></div>
          <div><dt>طريقة الدفع</dt><dd>{paymentMethodLabel[p.method]}</dd></div>
          {p.reference && <div><dt>المرجع</dt><dd><bdi dir="ltr">{p.reference}</bdi></dd></div>}
          {p.received_by_name && <div><dt>استلمها</dt><dd><bdi>{p.received_by_name}</bdi></dd></div>}
        </dl>
        <p className="receipt-amount">{ar(p.amount_minor, p.currency)}</p>
        {p.refunded_minor > 0 && <p className="rx-note">استُرد: {ar(p.refunded_minor, p.currency)}</p>}
        {p.invoice && <p className="rx-note">المتبقي على الفاتورة: <strong>{ar(p.invoice.balance_minor, p.currency)}</strong></p>}
        <footer className="rx-foot"><span>التوقيع</span></footer>
      </article>
    </>
  );
}
