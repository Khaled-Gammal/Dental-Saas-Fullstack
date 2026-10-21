import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useDebounced, useLeave } from '../../hooks';
import { mergeMovesLabel, patientFieldLabel } from '../../labels';
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
const LTR_FIELDS = new Set<string>(['phone', 'email']); // read left to right inside Arabic text
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? v ? 'نعم' : 'لا' : String(v));

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
    return <ResourceState isLoading={survivor.isLoading} isError={survivor.isError} error={survivor.error} notFound={false} refetch={() => void survivor.refetch()} back={to.list('patients')} backLabel="المرضى" />;
  }
  const s = survivor.data;
  const rows = (search ? found.data?.pages[0]?.items ?? [] : []).filter((p) => p.id !== s.id);
  const p = preview.data;
  return (
    <>
      <Breadcrumbs items={[{ label: 'المرضى', route: to.list('patients') }, { label: s.full_name, route: to.view('patients', s.id) }, { label: 'دمج ملف مكرر' }]} />
      <PageHeader title="دمج ملف مكرر" sub="ملف آخر لنفس الشخص يُدمج في هذا الملف: تنتقل إليه كل المواعيد والزيارات والفواتير والمدفوعات." />
      <Card>
        <h2>ابحث عن الملف المكرر</h2>
        <div className="stack mt-sm">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="الاسم أو رقم الموبايل أو رقم الملف" aria-label="بحث عن مريض" />
          {search && (
            <ul className="pick-list" aria-busy={found.isFetching || undefined}>
              {rows.map((r) => (
                <li key={r.id}><button type="button" className={`pick-item${other === r.id ? ' is-on' : ''}`} aria-pressed={other === r.id} onClick={() => setOther(r.id)}>
                  <strong><bdi>{r.full_name}</bdi></strong><span className="muted small">#{r.file_no} · <span dir="ltr">{r.phone}</span></span>
                </button></li>
              ))}
              {!found.isFetching && rows.length === 0 && <li className="muted small">لا يوجد مريض مطابق</li>}
            </ul>
          )}
        </div>
      </Card>

      {other && (preview.isError ? <ErrorText error={preview.error} onRetry={() => void preview.refetch()} /> : !p ? <Skeleton h={120} count={1} /> : (
        <>
          <Card>
            <h2>مقارنة الملفين</h2>
            <div className="table-wrap mt">
              <table className="compare-table">
                <thead><tr><th scope="col" /><th scope="col">هذا الملف (يبقى)</th><th scope="col">الملف المكرر</th></tr></thead>
                <tbody>
                  {SHOWN.map((f) => {
                    const differs = p.conflicts.some((c) => c.field === f);
                    return (
                      <tr key={f} className={differs ? 'is-diff' : undefined}>
                        <th scope="row">{(patientFieldLabel[f] ?? f)}</th>
                        <td><bdi dir={LTR_FIELDS.has(f) ? 'ltr' : undefined}>{show(f === 'file_no' ? fmtNumber(p.survivor.file_no) : p.survivor[f])}</bdi></td>
                        <td><bdi dir={LTR_FIELDS.has(f) ? 'ltr' : undefined}>{show(f === 'file_no' ? fmtNumber(p.merged.file_no) : p.merged[f])}</bdi>{differs && <Badge tone="warning">مختلف</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {p.conflicts.filter((c) => !(SHOWN as readonly string[]).includes(c.field)).map((c) => (
              <p key={c.field} className="small mt-sm">{(patientFieldLabel[c.field] ?? c.field)}: <bdi>{show(c.survivor)}</bdi> ← <span className="muted"><bdi>{show(c.merged)}</bdi></span></p>
            ))}
            <p className="muted small mt-sm">تبقى بيانات هذا الملف كما هي؛ لا يُحذف الملف المكرر بل يُحوَّل إلى هذا الملف ويختفي من القوائم.</p>
          </Card>
          <Card>
            <h2>ما سينتقل إلى هذا الملف</h2>
            {Object.keys(p.moves).length === 0 ? <p className="muted small mt-sm">لا شيء مسجل على الملف المكرر.</p> : (
              <ul className="chips mt-sm">
                {Object.entries(p.moves).map(([table, n]) => <li key={table}><Badge>{(mergeMovesLabel[table] ?? table)}: {fmtNumber(n)}</Badge></li>)}
              </ul>
            )}
            {p.medicalHistory && (
              <div className="mt">
                <h3>التاريخ الطبي بعد الدمج</h3>
                {(['allergies', 'conditions', 'medications'] as const).map((k) => p.medicalHistory![k].length > 0 && (
                  <div key={k} className="history-row"><span className="muted small">{k}</span><span><bdi>{p.medicalHistory![k].join('، ')}</bdi></span></div>
                ))}
                {p.medicalHistory.conflicts.length > 0 && <p className="small muted">تبقى قيم هذا الملف في: {p.medicalHistory.conflicts.map((c) => (patientFieldLabel[c.field] ?? c.field)).join('، ')}</p>}
              </div>
            )}
          </Card>
          <Alert tone="danger"><AlertIcon size={16} /> الدمج لا يمكن التراجع عنه من لوحة التحكم. تأكد أنه نفس الشخص.</Alert>
          <ErrorText error={merge.error} />
          <div className="row-end">
            <Button variant="danger" onClick={() => setConfirming(true)}>دمج الملفين</Button>
          </div>
          <ConfirmDialog open={confirming} title="دمج الملفين" confirmLabel="دمج الملفين" danger
            onConfirm={() => merge.mutate(undefined, { onSuccess: () => leave('تم دمج الملفين.'), onSettled: () => setConfirming(false) })}
            onCancel={() => setConfirming(false)}>
            <p>{'سينتقل كل ما في ملف «{from}» إلى ملف «{to}».'.replace('{from}', p.merged.full_name).replace('{to}', p.survivor.full_name)}</p>
          </ConfirmDialog>
        </>
      ))}
    </>
  );
}
