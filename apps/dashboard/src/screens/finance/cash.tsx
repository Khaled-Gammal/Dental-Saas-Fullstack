import { useState } from 'react';
import { pickName } from '@dental/ui/text';
import { toMinor, toPounds } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { difference, otherMethods } from '../../finance-model';
import { t, type Key, type Lang } from '../../i18n';
import { money } from '../../money';
import { send, useCashBranches, useCashDay, useCashHistory, useFinanceMutation } from '../../queries';
import type { CashSession, DayTotals } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Skeleton, TextArea } from '../../ui/components';
import { CashIcon } from '../../ui/icons';

/**
 * `#/cash` (SRS CASH-001…004, CLR-04): one cash session per branch per business day. Reception or the accountant
 * opens it with the counted cash, watches expected cash (computed, never typed) and closes it with the count; a
 * difference needs a note. Once closed nothing is dated into that day; only the owner reopens it, with a reason.
 */
export function CashBox({ lang, clinicId }: { lang: Lang; clinicId: string }) {
  const branches = useCashBranches(clinicId);
  const [picked, setPicked] = useState('');
  const list = branches.data ?? [];
  const branchId = picked || list[0]?.id || '';
  const day = useCashDay(clinicId, branchId);
  return (
    <>
      <PageHeader title={t('navCash', lang)} sub={t('cashSub', lang)} />
      {list.length > 1 && (
        <Card>
          <Field label={t('branch', lang)}>
            {(a) => <Choice id={a.id} lang={lang} value={branchId} onChange={setPicked} options={list.map((b) => ({ value: b.id, label: pickName(lang, b.name_ar, b.name_en) }))} />}
          </Field>
        </Card>
      )}
      {branches.isError ? <ErrorText error={branches.error} onRetry={() => void branches.refetch()} />
        : !branches.data ? <Skeleton h={120} count={2} />
        : !list.length ? <Card><EmptyState icon={<CashIcon size={28} />} title={t('noCashBranch', lang)} text={t('noCashBranchText', lang)} /></Card>
        : day.isError ? <ErrorText error={day.error} onRetry={() => void day.refetch()} />
        : !day.data ? <Skeleton h={160} count={2} />
        : (
          <>
            {day.data.earlier_open && (
              <Card>
                <Alert tone="danger">{t('earlierOpen', lang).replace('{date}', day.data.earlier_open.business_date)}</Alert>
                <SessionCard lang={lang} clinicId={clinicId} s={day.data.earlier_open} />
              </Card>
            )}
            {day.data.session ? (
              <Card><SessionCard lang={lang} clinicId={clinicId} s={day.data.session} /></Card>
            ) : !day.data.earlier_open && (
              <OpenCard lang={lang} clinicId={clinicId} branchId={branchId} date={day.data.business_date} suggested={day.data.suggested_opening} totals={day.data.totals} />
            )}
          </>
        )}
      {branchId && <History lang={lang} clinicId={clinicId} branchId={branchId} />}
    </>
  );
}

/** CASH-001: the counted opening cash; the last counted closing is proposed. */
function OpenCard({ lang, clinicId, branchId, date, suggested, totals }: { lang: Lang; clinicId: string; branchId: string; date: string; suggested: number | null; totals?: DayTotals }) {
  const [amount, setAmount] = useState<string | null>(null);
  const text = amount ?? (suggested !== null ? toPounds(suggested) : '');
  const minor = toMinor(text);
  const open = useFinanceMutation(clinicId, () => send('/cash/sessions', 'POST', { branchId, openingMinor: minor }));
  const moved = totals && (totals.cash_in || totals.cash_refunds || totals.cash_expenses);
  return (
    <Card>
      <h2>{t('openCashDay', lang)} · {date}</h2>
      <p className="muted small">{t(suggested !== null ? 'openingSuggested' : 'openingFirst', lang)}</p>
      {moved ? <Alert tone="info">{t('movedBeforeOpening', lang)}</Alert> : null}
      <Field label={t('openingCash', lang)}>
        {(a) => (
          <div className="row-start">
            <Input id={a.id} className="input-sm" dir="ltr" inputMode="decimal" value={text} onChange={(e) => setAmount(e.target.value)} invalid={!!text && minor === null} />
            <Button loading={open.isPending} disabled={minor === null} onClick={() => open.mutate(undefined)}>{t('openCashDay', lang)}</Button>
          </div>
        )}
      </Field>
      <ErrorText error={open.error} />
    </Card>
  );
}

function SessionCard({ lang, clinicId, s }: { lang: Lang; clinicId: string; s: CashSession }) {
  const totals = s.totals!;
  const expected = s.expected_minor ?? 0;
  return (
    <>
      <div className="row-between">
        <h2>{t('cashDay', lang)} · {s.business_date}</h2>
        <Badge tone={s.status === 'open' ? 'success' : 'neutral'}>{t(`cs_${s.status}` as Key, lang)}</Badge>
      </div>
      <p className="muted small">{t('openedBy', lang)} <bdi>{s.opened_by_name}</bdi>{s.closed_by_name && <> · {t('closedBy', lang)} <bdi>{s.closed_by_name}</bdi></>}</p>
      <ul className="line-list mt-sm cash-figures">
        <li><span>{t('openingCash', lang)}</span><span className="line-end"><bdi>{money(s.opening_minor, lang, s.currency)}</bdi></span></li>
        <li><span>+ {t('cashPayments', lang)}</span><span className="line-end"><bdi>{money(totals.cash_in, lang, s.currency)}</bdi></span></li>
        <li><span>− {t('cashRefunds', lang)}</span><span className="line-end"><bdi>{money(totals.cash_refunds, lang, s.currency)}</bdi></span></li>
        <li><span>− {t('cashExpenses', lang)}</span><span className="line-end"><bdi>{money(totals.cash_expenses, lang, s.currency)}</bdi></span></li>
        <li className="line-total"><strong>= {t('expectedCash', lang)}</strong><span className="line-end"><strong><bdi>{money(expected, lang, s.currency)}</bdi></strong></span></li>
        {s.status === 'closed' && s.counted_minor !== null && (
          <>
            <li><span>{t('countedCash', lang)}</span><span className="line-end"><bdi>{money(s.counted_minor, lang, s.currency)}</bdi></span></li>
            <li><span>{t('cashDifference', lang)}</span><span className="line-end"><DiffBadge lang={lang} diff={s.difference_minor ?? 0} currency={s.currency} /></span></li>
          </>
        )}
      </ul>
      {s.note && <p className="small mt-sm">{t('closingNote', lang)}: <bdi>{s.note}</bdi></p>}
      <OtherMethods lang={lang} totals={totals} currency={s.currency} />
      {s.can?.close && <CloseForm lang={lang} clinicId={clinicId} s={s} />}
      {s.can?.reopen && <ReopenForm lang={lang} clinicId={clinicId} s={s} />}
      {!!s.reopenings?.length && (
        <>
          <h3 className="mt">{t('reopenHistory', lang)}</h3>
          <ul className="line-list mt-sm">
            {s.reopenings.map((r) => (
              <li key={r.id}>
                <span><bdi>{r.reason}</bdi><span className="muted small block">{t('reopenedBy', lang)} <bdi>{r.reopened_by_name}</bdi> · {r.reopened_at.slice(0, 16).replace('T', ' ')}</span></span>
                <span className="line-end small">{t('previousClose', lang)}: <bdi>{money(r.previous_counted, lang, s.currency)}</bdi> / <bdi>{money(r.previous_expected, lang, s.currency)}</bdi></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function DiffBadge({ lang, diff, currency }: { lang: Lang; diff: number; currency: string }) {
  if (diff === 0) return <Badge tone="success">{t('noDifference', lang)}</Badge>;
  return <Badge tone="warning">{t(diff > 0 ? 'cashOver' : 'cashShort', lang)} <bdi>{money(Math.abs(diff), lang, currency)}</bdi></Badge>;
}

/** CASH-002: card, transfers, wallets and InstaPay are listed beside expected cash, never inside it. */
function OtherMethods({ lang, totals, currency }: { lang: Lang; totals: DayTotals; currency: string }) {
  const rows = otherMethods(totals);
  if (!rows.length) return null;
  return (
    <>
      <h3 className="mt">{t('otherMethods', lang)}</h3>
      <p className="muted small">{t('otherMethodsSub', lang)}</p>
      <ul className="line-list mt-sm">
        {rows.map((r) => (
          <li key={r.method}>
            <span>{t(`pm_${r.method}` as Key, lang)}</span>
            <span className="line-end small">{t('received', lang)} <bdi>{money(r.inMinor, lang, currency)}</bdi>{r.outMinor > 0 && <> · {t('paidOut', lang)} <bdi>{money(r.outMinor, lang, currency)}</bdi></>}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** CASH-003: count, compare, explain any difference, close. */
function CloseForm({ lang, clinicId, s }: { lang: Lang; clinicId: string; s: CashSession }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const minor = toMinor(counted);
  const diff = difference(minor, s.expected_minor ?? 0);
  const close = useFinanceMutation(clinicId, () => send(`/cash/sessions/${s.id}/close`, 'POST', { countedMinor: minor, note: note.trim() }));
  const ready = minor !== null && (diff === 0 || note.trim().length >= 3);
  return (
    <div className="stack mt tooth-panel">
      <h3>{t('closeCashDay', lang)}</h3>
      <Field label={t('countedCash', lang)} hint={t('countedHint', lang)}>
        {(a) => <Input id={a.id} describedBy={a.describedBy} className="input-sm" dir="ltr" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} invalid={!!counted && minor === null} />}
      </Field>
      {diff !== null && <p className="small">{t('cashDifference', lang)}: <DiffBadge lang={lang} diff={diff} currency={s.currency} /></p>}
      {diff !== null && diff !== 0 && (
        <Field label={t('closingNote', lang)} hint={t('differenceNoteHint', lang)}>
          {(a) => <TextArea id={a.id} describedBy={a.describedBy} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
      )}
      <ErrorText error={close.error} />
      <div className="row-end"><Button loading={close.isPending} disabled={!ready} onClick={() => close.mutate(undefined)}>{t('closeCashDay', lang)}</Button></div>
    </div>
  );
}

/** CASH-004 (owner): the earlier closing figures stay in the history. */
function ReopenForm({ lang, clinicId, s }: { lang: Lang; clinicId: string; s: CashSession }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reopen = useFinanceMutation(clinicId, () => send(`/cash/sessions/${s.id}/reopen`, 'POST', { reason: reason.trim() }));
  if (!open) return <div className="row-end mt"><Button variant="secondary" onClick={() => setOpen(true)}>{t('reopenCashDay', lang)}</Button></div>;
  return (
    <div className="stack mt tooth-panel">
      <h3>{t('reopenCashDay', lang)}</h3>
      <p className="muted small">{t('reopenText', lang)}</p>
      <Field label={t('reason', lang)} hint={t('reasonHint', lang)}>
        {(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
      </Field>
      <ErrorText error={reopen.error} />
      <div className="row-end">
        <Button variant="ghost" onClick={() => setOpen(false)}>{t('cancel', lang)}</Button>
        <Button loading={reopen.isPending} disabled={reason.trim().length < 3} onClick={() => reopen.mutate(undefined, { onSuccess: () => setOpen(false) })}>{t('reopenCashDay', lang)}</Button>
      </div>
    </div>
  );
}

function History({ lang, clinicId, branchId }: { lang: Lang; clinicId: string; branchId: string }) {
  const history = useCashHistory(clinicId, branchId);
  const past = (history.data ?? []).filter((s) => s.status === 'closed');
  if (history.isError) return <Card><ErrorText error={history.error} onRetry={() => void history.refetch()} /></Card>;
  if (!past.length) return null;
  return (
    <Card>
      <h2>{t('cashHistory', lang)}</h2>
      <ul className="line-list mt-sm">
        {past.map((s) => (
          <li key={s.id}>
            <span><strong>{s.business_date}</strong>{s.reopen_count > 0 && <span className="muted small"> · {t('reopenedTimes', lang).replace('{n}', String(s.reopen_count))}</span>}
              <span className="muted small block">{t('closedBy', lang)} <bdi>{s.closed_by_name}</bdi>{s.note && <> — <bdi>{s.note}</bdi></>}</span></span>
            <span className="line-end small">
              {t('expectedCash', lang)} <bdi>{money(s.expected_minor ?? 0, lang, s.currency)}</bdi> · {t('countedCash', lang)} <bdi>{money(s.counted_minor ?? 0, lang, s.currency)}</bdi>
              <DiffBadge lang={lang} diff={s.difference_minor ?? 0} currency={s.currency} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
