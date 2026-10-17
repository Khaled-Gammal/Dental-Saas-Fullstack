import type { ReactNode } from 'react';
import { pickName } from '@dental/ui/text';
import { t, type Key, type Lang } from '../../i18n';
import { money } from '../../money';
import { useBranches, useInvoice, usePaymentReceipt, useProfile } from '../../queries';
import { to } from '../../router';
import type { ClinicProfile } from '../../types';
import { Button } from '../../ui/components';
import { Breadcrumbs, ResourceState } from '../../ui/page';
import { fmtNumber } from '../../util';

const ar = (minor: number, currency: string) => money(minor, 'ar', currency);
const when = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(iso));

/** The clinic header of every printout: name, logo, branch address and phone. */
function Head({ clinic, branchId, branches, title, children }: {
  clinic: ClinicProfile | undefined; branchId: string; branches: ReturnType<typeof useBranches>['data']; title: string; children?: ReactNode;
}) {
  const branch = branches?.find((b) => b.id === branchId);
  return (
    <header className="rx-head">
      <div>
        <h1 className="rx-clinic">{clinic ? pickName('ar', clinic.nameAr, clinic.nameEn) : ''}</h1>
        {branch && <p className="rx-branch">{pickName('ar', branch.name_ar, branch.name_en)}{branch.address_ar && ` — ${branch.address_ar}`}{branch.phone && <> · <bdi dir="ltr">{branch.phone}</bdi></>}</p>}
        <p className="rx-doc-title">{title}</p>
        {children}
      </div>
      {clinic?.logo && <img className="rx-logo" src={clinic.logo.thumbUrl} alt="" />}
    </header>
  );
}

/** `#/invoices/<id>/print` (BILLING-004, CLR-17): A4, Arabic, right to left, printed from the browser. */
export function InvoicePrint({ lang, clinicId, id }: { lang: Lang; clinicId: string; id?: string }) {
  const inv = useInvoice(clinicId, id);
  const profile = useProfile(clinicId);
  const branches = useBranches(clinicId);
  if (!inv.data) return <ResourceState isLoading={inv.isLoading} isError={inv.isError} error={inv.error} notFound={false} refetch={() => void inv.refetch()} back={{ page: 'invoices' }} backLabel={t('navBilling', lang)} />;
  const v = inv.data;
  const paidPayments = v.payments.filter((p) => p.status !== 'reversed');
  return (
    <>
      <div className="no-print">
        <Breadcrumbs items={[{ label: t('navBilling', lang), route: { page: 'invoices' } }, { label: v.number ?? '', route: to.invoice(v.id) }, { label: t('print', lang) }]} />
        <div className="row-end mt-sm"><Button onClick={() => window.print()}>{t('print', lang)}</Button></div>
      </div>
      <style>{'@page { size: A4; margin: 12mm; }'}</style>
      <article className="rx-sheet rx-a4" dir="rtl" lang="ar">
        <Head clinic={profile.data} branchId={v.branch_id} branches={branches.data} title={v.status === 'void' ? `${t('invoice', 'ar')} (${t('inv_void', 'ar')})` : t('invoice', 'ar')} />
        <dl className="rx-patient">
          <div><dt>{t('invoiceNo', 'ar')}</dt><dd><bdi dir="ltr">{v.number}</bdi></dd></div>
          <div><dt>{t('date', 'ar')}</dt><dd>{v.issue_date}</dd></div>
          <div><dt>{t('patient', 'ar')}</dt><dd><bdi>{v.patient.full_name}</bdi></dd></div>
          <div><dt>{t('fileNo', 'ar')}</dt><dd>{fmtNumber(v.patient.file_no, 'ar')}</dd></div>
        </dl>
        <table className="print-table">
          <thead><tr><th>#</th><th>{t('lineDescription', 'ar')}</th><th>{t('quantity', 'ar')}</th><th>{t('unitPrice', 'ar')}</th><th>{t('total', 'ar')}</th></tr></thead>
          <tbody>
            {v.lines.map((l, i) => (
              <tr key={l.id}><td>{fmtNumber(i + 1, 'ar')}</td><td><bdi>{l.description}</bdi></td><td>{fmtNumber(l.quantity, 'ar')}</td><td>{ar(l.unit_price_minor, v.currency)}</td><td>{ar(l.line_total_minor, v.currency)}</td></tr>
            ))}
          </tbody>
        </table>
        <dl className="print-totals">
          <div><dt>{t('subtotal', 'ar')}</dt><dd>{ar(v.subtotal_minor, v.currency)}</dd></div>
          {v.discount_minor > 0 && <div><dt>{t('discount', 'ar')}</dt><dd>− {ar(v.discount_minor, v.currency)}</dd></div>}
          {v.tax_minor > 0 && <div><dt>{t('tax', 'ar')}</dt><dd>{ar(v.tax_minor, v.currency)}</dd></div>}
          <div className="is-total"><dt>{t('total', 'ar')}</dt><dd>{ar(v.total_minor, v.currency)}</dd></div>
          <div><dt>{t('paid', 'ar')}</dt><dd>{ar(v.paid_minor, v.currency)}</dd></div>
          <div className="is-total"><dt>{t('balance', 'ar')}</dt><dd>{ar(v.balance_minor, v.currency)}</dd></div>
        </dl>
        {paidPayments.length > 0 && (
          <div className="rx-note">{t('payments', 'ar')}: {paidPayments.map((p) => `${ar(p.amount_minor - p.refunded_minor, p.currency)} (${t(`pm_${p.method}` as Key, 'ar')})`).join('، ')}</div>
        )}
        {v.notes && <p className="rx-note">{v.notes}</p>}
      </article>
    </>
  );
}

/** `#/payments/<id>/print` (BILLING-004, CLR-17): the A5 receipt — amount, method, reference, date, receiver, what remains. */
export function ReceiptPrint({ lang, clinicId, id }: { lang: Lang; clinicId: string; id?: string }) {
  const rc = usePaymentReceipt(clinicId, id);
  const profile = useProfile(clinicId);
  const branches = useBranches(clinicId);
  if (!rc.data) return <ResourceState isLoading={rc.isLoading} isError={rc.isError} error={rc.error} notFound={false} refetch={() => void rc.refetch()} back={{ page: 'invoices' }} backLabel={t('navBilling', lang)} />;
  const p = rc.data;
  return (
    <>
      <div className="no-print">
        <Breadcrumbs items={[{ label: t('navBilling', lang), route: { page: 'invoices' } }, ...(p.invoice ? [{ label: p.invoice.number ?? '', route: to.invoice(p.invoice.id) }] : []), { label: t('receipt', lang) }]} />
        <div className="row-end mt-sm"><Button onClick={() => window.print()}>{t('print', lang)}</Button></div>
      </div>
      <style>{'@page { size: A5; margin: 10mm; }'}</style>
      <article className="rx-sheet rx-a5" dir="rtl" lang="ar">
        <Head clinic={profile.data} branchId={p.branch_id} branches={branches.data} title={t('receipt', 'ar')} />
        {p.status === 'reversed' && <p className="rx-note"><strong>{t('ps_reversed', 'ar')}</strong> — {p.reversal_reason}</p>}
        <dl className="rx-patient">
          {p.invoice && <div><dt>{t('patient', 'ar')}</dt><dd><bdi>{p.invoice.patient.full_name}</bdi></dd></div>}
          {p.invoice && <div><dt>{t('invoiceNo', 'ar')}</dt><dd><bdi dir="ltr">{p.invoice.number}</bdi></dd></div>}
          <div><dt>{t('date', 'ar')}</dt><dd>{when(p.paid_at)}</dd></div>
          <div><dt>{t('paymentMethod', 'ar')}</dt><dd>{t(`pm_${p.method}` as Key, 'ar')}</dd></div>
          {p.reference && <div><dt>{t('paymentReference', 'ar')}</dt><dd><bdi dir="ltr">{p.reference}</bdi></dd></div>}
          {p.received_by_name && <div><dt>{t('receivedBy', 'ar')}</dt><dd><bdi>{p.received_by_name}</bdi></dd></div>}
        </dl>
        <p className="receipt-amount">{ar(p.amount_minor, p.currency)}</p>
        {p.refunded_minor > 0 && <p className="rx-note">{t('refunded', 'ar')}: {ar(p.refunded_minor, p.currency)}</p>}
        {p.invoice && <p className="rx-note">{t('remainingBalance', 'ar')}: <strong>{ar(p.invoice.balance_minor, p.currency)}</strong></p>}
        <footer className="rx-foot"><span>{t('signature', 'ar')}</span></footer>
      </article>
    </>
  );
}
