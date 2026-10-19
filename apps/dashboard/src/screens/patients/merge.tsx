import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useDebounced, useLeave } from '../../hooks';
import { t, tOr, type Key } from '../../i18n';
import { send, useClinicalMutation, usePatient, usePatients } from '../../queries';
import { to } from '../../router';
import type { PatientDetail } from '../../types';
import { Alert, Badge, Button, Card, ErrorText, Input, PageHeader, Skeleton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { AlertIcon } from '../../ui/icons';
import { Breadcrumbs, ResourceState } from '../../ui/page';
import { fmtNumber } from '../../util';

interface MergePreview {
  survivor: PatientDetail; merged: PatientDetail;
  moves: Record<string, number>;
  conflicts: { field: string; survivor: unknown; merged: unknown }[];
  medicalHistory: { allergies: string[]; conditions: string[]; medications: string[]; conflicts: { field: string; survivor: unknown; merged: unknown }[] } | null;
}

const SHOWN = ['full_name', 'file_no', 'phone', 'date_of_birth', 'email', 'city'] as const;
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? t(v ? 'yes' : 'no') : String(v));

/**
 * `#/patients/<id>/merge` (SRS PATIENT-003): another record of the same person is merged into this one. Everything of
 * the other record moves here; allergies, conditions and medications are combined; this record's other details are
 * kept (CLR-15). The other record is never deleted, it points here. Not reversible from the dashboard.
 */
export function PatientMerge({ clinicId, id }: { clinicId: string; id?: string }) {
  const survivor = usePatient(clinicId, id);
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 250);
  const found = usePatients(clinicId, search);
  const [other, setOther] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ['patient-merge', clinicId, id, other], enabled: !!other && !!id,
    queryFn: () => api<MergePreview>(`/patients/${id}/merge-preview?other=${other}`),
  });
  const [confirming, setConfirming] = useState(false);
  const leave = useLeave(to.view('patients', id ?? ''));
  const merge = useClinicalMutation(clinicId, () => send<PatientDetail>(`/patients/${id}/merge`, 'POST', { mergedId: other }));

  if (!survivor.data) {
    return <ResourceState isLoading={survivor.isLoading} isError={survivor.isError} error={survivor.error} notFound={false} refetch={() => void survivor.refetch()} back={to.list('patients')} backLabel={t('navPatients')} />;
  }
  const s = survivor.data;
  const rows = (search ? found.data?.pages[0]?.items ?? [] : []).filter((p) => p.id !== s.id);
  const p = preview.data;
  return (
    <>
      <Breadcrumbs items={[{ label: t('navPatients'), route: to.list('patients') }, { label: s.full_name, route: to.view('patients', s.id) }, { label: t('mergeTitle') }]} />
      <PageHeader title={t('mergeTitle')} sub={t('mergeSub')} />
      <Card>
        <h2>{t('mergeFind')}</h2>
        <div className="stack mt-sm">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('patientSearchHint')} aria-label={t('patientSearch')} />
          {search && (
            <ul className="pick-list" aria-busy={found.isFetching || undefined}>
              {rows.map((r) => (
                <li key={r.id}><button type="button" className={`pick-item${other === r.id ? ' is-on' : ''}`} aria-pressed={other === r.id} onClick={() => setOther(r.id)}>
                  <strong><bdi>{r.full_name}</bdi></strong><span className="muted small">#{r.file_no} · <span dir="ltr">{r.phone}</span></span>
                </button></li>
              ))}
              {!found.isFetching && rows.length === 0 && <li className="muted small">{t('noPatientMatch')}</li>}
            </ul>
          )}
        </div>
      </Card>

      {other && (preview.isError ? <ErrorText error={preview.error} onRetry={() => void preview.refetch()} /> : !p ? <Skeleton h={120} count={1} /> : (
        <>
          <Card>
            <h2>{t('mergeCompare')}</h2>
            <div className="table-wrap mt">
              <table className="compare-table">
                <thead><tr><th scope="col" /><th scope="col">{t('mergeKeeps')}</th><th scope="col">{t('mergeMovesFrom')}</th></tr></thead>
                <tbody>
                  {SHOWN.map((f) => {
                    const differs = p.conflicts.some((c) => c.field === f);
                    return (
                      <tr key={f} className={differs ? 'is-diff' : undefined}>
                        <th scope="row">{tOr(`field_${f}`, f)}</th>
                        <td><bdi>{show(f === 'file_no' ? fmtNumber(p.survivor.file_no) : p.survivor[f])}</bdi></td>
                        <td><bdi>{show(f === 'file_no' ? fmtNumber(p.merged.file_no) : p.merged[f])}</bdi>{differs && <Badge tone="warning">{t('differs')}</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {p.conflicts.filter((c) => !(SHOWN as readonly string[]).includes(c.field)).map((c) => (
              <p key={c.field} className="small mt-sm">{tOr(`field_${c.field}`, c.field)}: <bdi>{show(c.survivor)}</bdi> ← <span className="muted"><bdi>{show(c.merged)}</bdi></span></p>
            ))}
            <p className="muted small mt-sm">{t('mergeKeepsText')}</p>
          </Card>
          <Card>
            <h2>{t('mergeWhatMoves')}</h2>
            {Object.keys(p.moves).length === 0 ? <p className="muted small mt-sm">{t('mergeNothingMoves')}</p> : (
              <ul className="chips mt-sm">
                {Object.entries(p.moves).map(([table, n]) => <li key={table}><Badge>{tOr(`moves_${table}`, table)}: {fmtNumber(n)}</Badge></li>)}
              </ul>
            )}
            {p.medicalHistory && (
              <div className="mt">
                <h3>{t('mergeHistory')}</h3>
                {(['allergies', 'conditions', 'medications'] as const).map((k) => p.medicalHistory![k].length > 0 && (
                  <div key={k} className="history-row"><span className="muted small">{t(k as Key)}</span><span><bdi>{p.medicalHistory![k].join('، ')}</bdi></span></div>
                ))}
                {p.medicalHistory.conflicts.length > 0 && <p className="small muted">{t('mergeHistoryKeeps')}: {p.medicalHistory.conflicts.map((c) => tOr(`field_${c.field}`, c.field)).join('، ')}</p>}
              </div>
            )}
          </Card>
          <Alert tone="danger"><AlertIcon size={16} /> {t('mergeWarning')}</Alert>
          <ErrorText error={merge.error} />
          <div className="row-end">
            <Button variant="danger" onClick={() => setConfirming(true)}>{t('mergeConfirm')}</Button>
          </div>
          <ConfirmDialog open={confirming} title={t('mergeConfirm')} confirmLabel={t('mergeConfirm')} danger
            onConfirm={() => merge.mutate(undefined, { onSuccess: () => leave(t('patientsMerged')), onSettled: () => setConfirming(false) })}
            onCancel={() => setConfirming(false)}>
            <p>{t('mergeConfirmText').replace('{from}', p.merged.full_name).replace('{to}', p.survivor.full_name)}</p>
          </ConfirmDialog>
        </>
      ))}
    </>
  );
}
