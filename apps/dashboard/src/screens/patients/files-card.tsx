import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, uploadFile } from '../../api';
import { Choice } from '../../components/choice';
import { FilePicker } from '../../components/file-picker';
import { DatePicker } from '../../components/date-picker';
import { fileKindLabel } from '../../labels';
import { patientKeys, usePatientFiles } from '../../queries';
import type { ClinicalFileKind, PatientFile } from '../../types';
import { Badge, Button, Card, ErrorText, Field, Input, LinkButton, Skeleton, Switch } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { fmtNumber } from '../../util';

const KINDS: ClinicalFileKind[] = ['xray', 'clinical_photo', 'document'];
const MAX_BYTES = 20 * 1024 * 1024; // same cap as the API (CLINICAL_FILE_POLICY)
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const loc = () => ('ar-EG-u-nu-latn');

/**
 * X-rays, clinical photos and documents of a patient (SRS PATIENT-004). Shown to members with clinical:read; upload and
 * archive with clinical:write. Links are valid 5 minutes and every opening is audited, so the list refreshes itself.
 */
export function FilesCard({ clinicId, patientId, canWrite }: { clinicId: string; patientId: string; canWrite: boolean }) {
  const [archived, setArchived] = useState(false);
  const files = usePatientFiles(clinicId, patientId, archived, true);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: [...patientKeys.one(clinicId, patientId), 'files'] });
  const [archiving, setArchiving] = useState<PatientFile | null>(null);
  const [reason, setReason] = useState('');
  const archive = useMutation({
    mutationFn: (f: PatientFile) => api(`/patients/${patientId}/files/${f.file_id}/archive`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }),
    onSuccess: () => { setArchiving(null); setReason(''); void refresh(); },
  });
  const date = (iso: string) => new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeZone: 'Africa/Cairo' }).format(new Date(iso));

  return (
    <Card>
      <div className="row-between">
        <h2>الأشعة والملفات</h2>
        <Switch checked={archived} onChange={setArchived} label="عرض المؤرشفة" />
      </div>
      <p className="muted small">تُفتح بروابط مؤقتة لمدة 5 دقائق، ويُسجَّل كل فتح في سجل المريض.</p>
      {canWrite && !archived && <UploadForm patientId={patientId} onDone={() => void refresh()} />}
      {files.isError ? <ErrorText error={files.error} onRetry={() => void files.refetch()} />
        : files.isLoading ? <Skeleton h={64} count={2} />
        : !files.data?.length ? <p className="muted small mt-sm">لا توجد ملفات بعد.</p>
        : (
          <ul className="file-grid mt">
            {files.data.map((f) => (
              <li key={f.file_id} className="file-tile">
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="file-thumb" aria-label={`${'فتح'}: ${fileKindLabel[f.kind]}`}>
                  {f.mime_type.startsWith('image/') ? <img src={f.url} alt="" loading="lazy" /> : <span className="file-pdf">PDF</span>}
                </a>
                <div className="file-meta">
                  <Badge tone={f.kind === 'xray' ? 'primary' : 'neutral'}>{fileKindLabel[f.kind]}</Badge>
                  {f.caption && <strong><bdi>{f.caption}</bdi></strong>}
                  <span className="muted small">{date(f.taken_at ?? f.created_at)} · {fmtNumber(Math.max(1, Math.round(f.size_bytes / 1024)))} KB</span>
                  {f.uploaded_by_name && <span className="muted small"><bdi>{f.uploaded_by_name}</bdi></span>}
                  {f.archive_reason && <span className="muted small">سبب الأرشفة: <bdi>{f.archive_reason}</bdi></span>}
                  {canWrite && !f.archived_at && <LinkButton onClick={() => { setArchiving(f); setReason(''); }}>أرشفة</LinkButton>}
                </div>
              </li>
            ))}
          </ul>
        )}
      <ConfirmDialog open={!!archiving} title="أرشفة" confirmLabel="أرشفة" danger
        onConfirm={() => { if (archiving && reason.trim().length >= 3) archive.mutate(archiving); }} onCancel={() => setArchiving(null)}>
        <p>يختفي الملف من القائمة ولا يُحذف أبدًا؛ يظهر في المؤرشفة.</p>
        <Field label="سبب الأرشفة">{(a) => <Input id={a.id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
        <ErrorText error={archive.error} />
      </ConfirmDialog>
    </Card>
  );
}

function UploadForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ClinicalFileKind>('xray');
  const [caption, setCaption] = useState('');
  const [takenAt, setTakenAt] = useState('');
  const [progress, setProgress] = useState(0);
  const tooBig = !!file && file.size > MAX_BYTES;
  const upload = useMutation({
    mutationFn: () => uploadFile<PatientFile>(`/patients/${patientId}/files`, file!, setProgress, undefined, {
      kind, ...(caption.trim() && { caption: caption.trim() }), ...(takenAt && { takenAt }),
    }),
    onSuccess: () => { setFile(null); setCaption(''); setTakenAt(''); setProgress(0); onDone(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (file && !tooBig) upload.mutate(); };
  // the API's 413 says 10 MB for website images; clinical files allow 20 MB
  const error = upload.error instanceof ApiError && upload.error.code === 'payload_too_large' ? null : upload.error;

  return (
    <form onSubmit={submit} className="grid-2 mt">
      <Field label="الملف (PDF أو صورة، حتى 20 ميجابايت)" error={tooBig || (upload.error instanceof ApiError && upload.error.code === 'payload_too_large') ? 'الملف أكبر من 20 ميجابايت.' : undefined}>
        {(a) => <FilePicker id={a.id} describedBy={a.describedBy} accept={ACCEPT} file={file} onChange={setFile} disabled={upload.isPending} />}
      </Field>
      <Field label="النوع">
        {(a) => <Choice id={a.id} value={kind} onChange={(v) => setKind(v as ClinicalFileKind)} options={KINDS.map((k) => ({ value: k, label: fileKindLabel[k] }))} />}
      </Field>
      <Field label="وصف" optional="اختياري">{(a) => <Input id={a.id} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} />}</Field>
      <Field label="تاريخ الأشعة أو الصورة" optional="اختياري">
        {(a) => <DatePicker id={a.id} value={takenAt} onChange={setTakenAt} max={new Date().toLocaleDateString('en-CA')} placeholder="اختر التاريخ" />}
      </Field>
      <div className="row-end">
        {upload.isPending && <span className="muted small">{fmtNumber(Math.round(progress * 100))}%</span>}
        <Button type="submit" loading={upload.isPending} disabled={!file || tooBig}>رفع الملف</Button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}
