import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { toMinor, toPounds } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { difference, otherMethods } from '../../finance-model';
import { t, type Key } from '../../i18n';
import { money } from '../../money';
import { send, useCashBranches, useCashDay, useCashHistory, useFinanceMutation } from '../../queries';
import type { CashSession, DayTotals } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Skeleton, TextArea } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { CashIcon } from '../../ui/icons';

/**
 * `#/cash` (SRS CASH-001…004, CLR-04): one cash session per branch per business day. Reception or the accountant
 * opens it with the counted cash, watches expected cash (computed, never typed) and closes it with the count; a
 * difference needs a note. Once closed nothing is dated into that day; only the owner reopens it, with a reason.
 */
export function CashBox({ clinicId }: { clinicId: string }) {
  const branches = useCashBranches(clinicId);
  const [picked, setPicked] = useState('');
  const list = branches.data ?? [];
  const branchId = picked || list[0]?.id || '';
  const day = useCashDay(clinicId, branchId);
  return (
    <>
      <PageHeader title={t('navCash')} sub={t('cashSub')} />
      {list.length > 1 && (
        <Card>
          <Field label={t('branch')}>
            {(a) => <Choice id={a.id} value={branchId} onChange={setPicked} options={list.map((b) => ({ value: b.id, label: arName(b.name_ar, b.name_en) }))} />}
          </Field>
        </Card>
      )}
      {branches.isError ? <ErrorText error={branches.error} onRetry={() => void branches.refetch()} />
        : !branches.data ? <Skeleton h={120} count={2} />
        : !list.length ? <Card><EmptyState icon={<CashIcon size={28} />} title={t('noCashBranch')} text={t('noCashBranchText')} /></Card>
        : day.isError ? <ErrorText error={day.error} onRetry={() => void day.refetch()} />
        : !day.data ? <Skeleton h={160} count={2} />
        : (
          <>
            {day.data.earlier_open && (
              <Card>
                <Alert tone="danger">{t('earlierOpen').replace('{date}', day.data.earlier_open.business_date)}</Alert>
                <SessionCard clinicId={clinicId} s={day.data.earlier_open} />
              </Card>
            )}
            {day.data.session ? (
              <Card><SessionCard clinicId={clinicId} s={day.data.session} /></Card>
            ) : !day.data.earlier_open && (
              <OpenCard clinicId={clinicId} branchId={branchId} date={day.data.business_date} suggested={day.data.suggested_opening} totals={day.data.totals} />
            )}
          </>
        )}
      {branchId && <History clinicId={clinicId} branchId={branchId} />}
    </>
  );
}

/** CASH-001: the counted opening cash; the last counted closing is proposed. */
function OpenCard({ clinicId, branchId, date, suggested, totals }: { clinicId: string; branchId: string; date: string; suggested: number | null; totals?: DayTotals }) {
  const [amount, setAmount] = useState<string | null>(null);
  const text = amount ?? (suggested !== null ? toPounds(suggested) : '');
  const minor = toMinor(text);
  const open = useFinanceMutation(clinicId, () => send('/cash/sessions', 'POST', { branchId, openingMinor: minor }));
  const moved = totals && (totals.cash_in || totals.cash_refunds || totals.cash_expenses);
  return (
    <Card>
      <h2>{t('openCashDay')} · {date}</h2>
      <p className="muted small">{t(suggested !== null ? 'openingSuggested' : 'openingFirst')}</p>
      {moved ? <Alert tone="info">{t('movedBeforeOpening')}</Alert> : null}
      <Field label={t('openingCash')}>
        {(a) => (
          <div className="row-start">
            <Input id={a.id} className="input-sm" dir="ltr" inputMode="decimal" value={text} onChange={(e) => setAmount(e.target.value)} invalid={!!text && minor === null} />
            <Button loading={open.isPending} disabled={minor === null} onClick={() => open.mutate(undefined)}>{t('openCashDay')}</Button>
          </div>
        )}
      </Field>
      <ErrorText error={open.error} />
    </Card>
  );
}

function SessionCard({ clinicId, s }: { clinicId: string; s: CashSession }) {
  const totals = s.totals!;
  const expected = s.expected_minor ?? 0;
  return (
    <>
      <div className="row-between">
        <h2>{t('cashDay')} · {s.business_date}</h2>
        <Badge tone={s.status === 'open' ? 'success' : 'neutral'}>{t(`cs_${s.status}` as Key)}</Badge>
      </div>
      <p className="muted small">{t('openedBy')} <bdi>{s.opened_by_name}</bdi>{s.closed_by_name && <> · {t('closedBy')} <bdi>{s.closed_by_name}</bdi></>}</p>
      <ul className="line-list mt-sm cash-figures">
        <li><span>{t('openingCash')}</span><span className="line-end"><bdi>{money(s.opening_minor, s.currency)}</bdi></span></li>
        <li><span>+ {t('cashPayments')}</span><span className="line-end"><bdi>{money(totals.cash_in, s.currency)}</bdi></span></li>
        <li><span>− {t('cashRefunds')}</span><span className="line-end"><bdi>{money(totals.cash_refunds, s.currency)}</bdi></span></li>
        <li><span>− {t('cashExpenses')}</span><span className="line-end"><bdi>{money(totals.cash_expenses, s.currency)}</bdi></span></li>
        <li className="line-total"><strong>= {t('expectedCash')}</strong><span className="line-end"><strong><bdi>{money(expected, s.currency)}</bdi></strong></span></li>
        {s.status === 'closed' && s.counted_minor !== null && (
          <>
            <li><span>{t('countedCash')}</span><span className="line-end"><bdi>{money(s.counted_minor, s.currency)}</bdi></span></li>
            <li><span>{t('cashDifference')}</span><span className="line-end"><DiffBadge diff={s.difference_minor ?? 0} currency={s.currency} /></span></li>
          </>
        )}
      </ul>
      {s.note && <p className="small mt-sm">{t('closingNote')}: <bdi>{s.note}</bdi></p>}
      <OtherMethods totals={totals} currency={s.currency} />
      {s.can?.close && <CloseForm clinicId={clinicId} s={s} />}
      {s.can?.reopen && <ReopenForm clinicId={clinicId} s={s} />}
      {!!s.reopenings?.length && (
        <>
          <h3 className="mt">{t('reopenHistory')}</h3>
          <ul className="line-list mt-sm">
            {s.reopenings.map((r) => (
              <li key={r.id}>
                <span><bdi>{r.reason}</bdi><span className="muted small block">{t('reopenedBy')} <bdi>{r.reopened_by_name}</bdi> · {r.reopened_at.slice(0, 16).replace('T', ' ')}</span></span>
                <span className="line-end small">{t('previousClose')}: <bdi>{money(r.previous_counted, s.currency)}</bdi> / <bdi>{money(r.previous_expected, s.currency)}</bdi></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function DiffBadge({ diff, currency }: { diff: number; currency: string }) {
  if (diff === 0) return <Badge tone="success">{t('noDifference')}</Badge>;
  return <Badge tone="warning">{t(diff > 0 ? 'cashOver' : 'cashShort')} <bdi>{money(Math.abs(diff), currency)}</bdi></Badge>;
}

/** CASH-002: card, transfers, wallets and InstaPay are listed beside expected cash, never inside it. */
function OtherMethods({ totals, currency }: { totals: DayTotals; currency: string }) {
  const rows = otherMethods(totals);
  if (!rows.length) return null;
  return (
    <>
      <h3 className="mt">{t('otherMethods')}</h3>
      <p className="muted small">{t('otherMethodsSub')}</p>
      <ul className="line-list mt-sm">
        {rows.map((r) => (
          <li key={r.method}>
            <span>{t(`pm_${r.method}` as Key)}</span>
            <span className="line-end small">{t('received')} <bdi>{money(r.inMinor, currency)}</bdi>{r.outMinor > 0 && <> · {t('paidOut')} <bdi>{money(r.outMinor, currency)}</bdi></>}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** CASH-003: count, compare, explain any difference, close. */
function CloseForm({ clinicId, s }: { clinicId: string; s: CashSession }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const minor = toMinor(counted);
  const diff = difference(minor, s.expected_minor ?? 0);
  const close = useFinanceMutation(clinicId, () => send(`/cash/sessions/${s.id}/close`, 'POST', { countedMinor: minor, note: note.trim() }));
  const ready = minor !== null && (diff === 0 || note.trim().length >= 3);
  return (
    <div className="stack mt tooth-panel">
      <h3>{t('closeCashDay')}</h3>
      <Field label={t('countedCash')} hint={t('countedHint')}>
        {(a) => <Input id={a.id} describedBy={a.describedBy} className="input-sm" dir="ltr" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} invalid={!!counted && minor === null} />}
      </Field>
      {diff !== null && <p className="small">{t('cashDifference')}: <DiffBadge diff={diff} currency={s.currency} /></p>}
      {diff !== null && diff !== 0 && (
        <Field label={t('closingNote')} hint={t('differenceNoteHint')}>
          {(a) => <TextArea id={a.id} describedBy={a.describedBy} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
      )}
      <ErrorText error={close.error} />
      <div className="row-end"><Button loading={close.isPending} disabled={!ready} onClick={() => close.mutate(undefined)}>{t('closeCashDay')}</Button></div>
    </div>
  );
}

/** CASH-004 (owner): the earlier closing figures stay in the history. */
function ReopenForm({ clinicId, s }: { clinicId: string; s: CashSession }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reopen = useFinanceMutation(clinicId, () => send(`/cash/sessions/${s.id}/reopen`, 'POST', { reason: reason.trim() }));
  if (!open) return <div className="row-end mt"><Button variant="secondary" onClick={() => setOpen(true)}>{t('reopenCashDay')}</Button></div>;
  return (
    <div className="stack mt tooth-panel">
      <h3>{t('reopenCashDay')}</h3>
      <p className="muted small">{t('reopenText')}</p>
      <Field label={t('reason')} hint={t('reasonHint')}>
        {(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
      </Field>
      <ErrorText error={reopen.error} />
      <div className="row-end">
        <Button variant="ghost" onClick={() => setOpen(false)}>{t('cancel')}</Button>
        <Button loading={reopen.isPending} disabled={reason.trim().length < 3} onClick={() => reopen.mutate(undefined, { onSuccess: () => setOpen(false) })}>{t('reopenCashDay')}</Button>
      </div>
    </div>
  );
}

/** The closed days (redesign R4: a table). Every figure is the one the API stored when the day was closed. */
const HISTORY_COLUMNS: Column<CashSession>[] = [
  {
    id: 'date', header: t('cashColDay'), sortValue: (s) => s.business_date,
    cell: (s) => (
      <>
        <strong className="whitespace-nowrap tabular-nums">{s.business_date}</strong>
        {s.reopen_count > 0 && <span className="muted small block">{t('reopenedTimes').replace('{n}', String(s.reopen_count))}</span>}
      </>
    ),
  },
  { id: 'closedBy', header: t('closedBy'), hideOnMobile: true, cell: (s) => <><bdi>{s.closed_by_name}</bdi>{s.note && <span className="muted small block"><bdi>{s.note}</bdi></span>}</> },
  { id: 'expected', header: t('expectedCash'), numeric: true, hideOnMobile: true, cell: (s) => <bdi>{money(s.expected_minor ?? 0, s.currency)}</bdi> },
  { id: 'counted', header: t('countedCash'), numeric: true, cell: (s) => <bdi className="font-semibold">{money(s.counted_minor ?? 0, s.currency)}</bdi> },
  { id: 'difference', header: t('cashDifference'), sortValue: (s) => s.difference_minor ?? 0, cell: (s) => <DiffBadge diff={s.difference_minor ?? 0} currency={s.currency} /> },
];

function History({ clinicId, branchId }: { clinicId: string; branchId: string }) {
  const history = useCashHistory(clinicId, branchId);
  const past = (history.data ?? []).filter((s) => s.status === 'closed');
  if (history.isError) return <Card><ErrorText error={history.error} onRetry={() => void history.refetch()} /></Card>;
  if (!past.length) return null;
  return (
    <section>
      <h2 className="section-title">{t('cashHistory')}</h2>
      <DataTable
        key={branchId}
        label={t('cashHistory')}
        rows={past}
        columns={HISTORY_COLUMNS}
        rowKey={(s) => s.id}
        isFetching={history.isFetching}
        defaultSort={{ id: 'date', dir: 'desc' }}
        pageSize={15}
        empty={{ icon: <CashIcon size={28} />, title: t('cashHistory'), text: '' }}
      />
    </section>
  );
}
