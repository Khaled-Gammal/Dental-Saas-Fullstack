import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Choice } from '../../components/choice';
import { downloadCsv, toCsv } from '../../csv';
import {
  BATCH, BATCH_BYTES, chunks, dateOrder, guessMapping, headerRowIndex, IMPORT_FIELD_LABEL, IMPORT_FIELDS, MAX_FILE_BYTES, MAX_ROWS, mergeReports,
  parseCsv, patientsText, REQUIRED_FIELDS, rowProblem, TEMPLATE_EXAMPLE, TEMPLATE_HEAD, toImportRows, type ImportField, type ImportRow, type Mapping,
  type RowResult,
} from '../../import-model';
import { patientKeys } from '../../queries';
import { to } from '../../router';
import { Alert, Badge, Button, Card, ErrorText, PageHeader } from '../../ui/components';
import { Breadcrumbs, RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { readXlsx, XlsxError, type SheetRow } from '../../xlsx-reader';

interface BatchReport { counts: { new: number; duplicate: number; invalid: number }; created: number; room: number | null; rows: RowResult[] }
type Step = 'pick' | 'map' | 'checked' | 'done';

const FILE_ERROR: Record<string, string> = {
  not_xlsx: 'الملف ليس ملف Excel صالحًا. احفظه بصيغة Excel الحديثة أو CSV وحاول مرة أخرى.',
  encrypted: 'الملف محمي بكلمة سر أو بصيغة Excel القديمة (97–2003). احفظ نسخة بدون كلمة سر وبالصيغة الحديثة أو CSV.',
  too_large: 'الملف كبير جدًا. قسّمه إلى ملفات أصغر.',
  no_sheet: 'لا توجد بيانات في الملف.',
  old_xls: 'صيغة Excel القديمة (97–2003) غير مدعومة. افتح الملف في Excel واحفظه بالصيغة الحديثة أو CSV.',
  type: 'اختر ملف Excel أو CSV.',
  size: `حجم الملف أكبر من ${MAX_FILE_BYTES / 1024 / 1024} ميجابايت. قسّمه إلى ملفات أصغر.`,
  rows: `الملف فيه أكثر من ${fmtNumber(MAX_ROWS)} صف. قسّمه إلى ملفات أصغر.`,
  too_many_rows: `الملف فيه أكثر من ${fmtNumber(MAX_ROWS)} صف. قسّمه إلى ملفات أصغر.`,
  empty: 'لم نجد صفوفًا فيها بيانات تحت صف العناوين.',
};

/**
 * A CSV saved by Excel in Arabic Windows is often Windows-1256, not UTF-8; "Unicode text" is UTF-16. The byte-order mark
 * tells UTF-16; otherwise strict UTF-8 first, then Windows-1256.
 */
function decodeCsv(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1256').decode(buf); }
}

async function readSheet(file: File): Promise<SheetRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) throw new Error('old_xls');
  if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) throw new Error('type');
  if (file.size > MAX_FILE_BYTES) throw new Error('size');
  const buf = await file.arrayBuffer();
  return name.endsWith('.csv') ? parseCsv(decodeCsv(buf)) : readXlsx(buf, MAX_ROWS + 50); // + a title and blank lines above the header
}

/**
 * `#/patients/import` (Phase 2A, SRS ONB-03): the clinic's existing patient list from Excel or CSV. Pick the file, check
 * which column is which (guessed from the headers), run a check that writes nothing (a dry run: new, already
 * registered, or with errors, per row), then import the new ones. The file is read in the browser; only the mapped
 * columns go to the API, in batches of 1,000.
 */
export function PatientImport({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('pick');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [reading, setReading] = useState(false);
  const [sheet, setSheet] = useState<SheetRow[]>([]);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [report, setReport] = useState<ReturnType<typeof mergeReports> & { room: number | null } | null>(null);
  const [created, setCreated] = useState(0);
  const [askedOrder, setAskedOrder] = useState<'dmy' | 'mdy'>('dmy');
  // leaving the page stops sending further batches (the one in flight finishes on the server). Set again on every
  // mount: React's StrictMode (development) mounts, unmounts and mounts once more, and a flag cleared by that first
  // unmount left the check button doing nothing.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]); // a new step: screen readers and keyboards start there

  const headers = sheet[headerIndex]?.cells ?? [];
  const dateCol = mapping.dateOfBirth;
  const detected = useMemo(() => (dateCol === undefined ? 'none' : dateOrder(sheet.slice(headerIndex + 1).map((r) => r.cells[dateCol] ?? ''))), [sheet, headerIndex, dateCol]);
  const order = detected === 'dmy' || detected === 'mdy' ? detected : askedOrder;
  const rows: ImportRow[] = useMemo(() => (sheet.length ? toImportRows(sheet, headerIndex, mapping, order) : []), [sheet, headerIndex, mapping, order]);
  const byRow = useMemo(() => new Map(rows.map((r) => [r.row, r])), [rows]);
  const missing = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file again still fires
    if (!file) return;
    setFileError(''); setError(null); setReport(null); setCreated(0); setReading(true);
    try {
      const s = await readSheet(file);
      const h = headerRowIndex(s);
      const body = s.length - h - 1;
      if (s.slice(h + 1).length > MAX_ROWS) throw new Error('rows');
      if (body < 1) throw new Error('empty');
      setSheet(s); setHeaderIndex(h); setMapping(guessMapping(s[h]?.cells ?? [])); setFileName(file.name); setStep('map');
    } catch (err) {
      const code = err instanceof XlsxError ? err.code : err instanceof Error ? err.message : '';
      setFileError(FILE_ERROR[code] ?? FILE_ERROR.not_xlsx);
    } finally {
      setReading(false);
    }
  };

  /** Sends the rows batch by batch; a failure stops there (batches already imported stay imported, and say so). */
  const send = async (dryRun: boolean) => {
    setError(null);
    const batches = chunks(rows, BATCH, BATCH_BYTES);
    const results: BatchReport[] = [];
    setBusy({ done: 0, total: rows.length });
    try {
      for (const b of batches) {
        if (!alive.current) return;
        const r = await api<BatchReport>('/patients/import', { method: 'POST', body: JSON.stringify({ dryRun, rows: b }) });
        results.push(r);
        setBusy((x) => (x ? { ...x, done: x.done + b.length } : x));
        if (!dryRun) setCreated((n) => n + r.created); // adds up across a retry after a failed batch
      }
      setReport({ ...mergeReports(results.map((r) => r.rows)), room: results[0]?.room ?? null });
      setStep(dryRun ? 'checked' : 'done');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
      if (!dryRun) void qc.invalidateQueries({ queryKey: patientKeys.all(clinicId) });
    }
  };

  const reset = () => { setStep('pick'); setSheet([]); setMapping({}); setReport(null); setCreated(0); setError(null); setFileName(''); };
  const template = () => downloadCsv('patients-template.csv', toCsv(TEMPLATE_HEAD, [TEMPLATE_EXAMPLE]));
  const problems = report?.rows.filter((r) => r.status !== 'new') ?? [];
  const nameOf = (row: number) => byRow.get(row);
  const downloadProblems = () => downloadCsv('patients-import-problems.csv',
    toCsv(['السطر', 'الاسم', 'الموبايل', 'المشكلة'], problems.map((r) => [r.row, nameOf(r.row)?.fullName ?? '', nameOf(r.row)?.phone ?? '', rowProblem(r)])));
  const overRoom = report && report.room !== null && report.counts.new > report.room;

  return (
    <div className="stack">
      <Breadcrumbs items={[{ label: 'المرضى', route: to.list('patients') }, { label: 'استيراد من Excel' }]} />
      <PageHeader title="استيراد المرضى من Excel" sub="انقل قائمة مرضى عيادتك من ملف Excel أو CSV مرة واحدة، بدون إدخال يدوي" />

      {step === 'pick' && (
        <Card>
          <h2 ref={heading} tabIndex={-1}>1. اختر الملف</h2>
          <p className="muted">ملف Excel أو CSV، أول صف فيه عناوين الأعمدة (الاسم، الموبايل، …). الاسم والموبايل مطلوبان، والباقي اختياري.</p>
          <div className="import-pick mt">
            <label className="btn btn-primary">
              <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={pick} className="sr-only" disabled={reading} />
              {reading ? 'جارٍ قراءة الملف…' : 'اختيار ملف'}
            </label>
            <Button variant="ghost" onClick={template}>تنزيل نموذج فارغ</Button>
          </div>
          {fileError && <Alert>{fileError}</Alert>}
          <p className="muted small mt">الملف يُقرأ على جهازك، ولا يُرسل منه إلا الأعمدة التي تختارها.</p>
        </Card>
      )}

      {step !== 'pick' && (
        <Card>
          <div className="import-file"><strong><bdi>{fileName}</bdi></strong><span className="muted">{fmtNumber(rows.length)} صف</span>
            {step !== 'done' && <Button variant="ghost" onClick={reset} disabled={!!busy}>ملف آخر</Button>}</div>
        </Card>
      )}

      {step === 'map' && (
        <Card>
          <h2 ref={heading} tabIndex={-1}>2. طابق الأعمدة</h2>
          <p className="muted">اخترنا لكل بيان العمود الأقرب من عناوين ملفك. راجعها، وغيّر ما يلزم.</p>
          <div className="import-map mt">
            {IMPORT_FIELDS.map((f) => (
              <div key={f} className="import-map-row">
                <span>{IMPORT_FIELD_LABEL[f]}{REQUIRED_FIELDS.includes(f) && <><span className="req" aria-hidden> *</span><span className="sr-only"> (مطلوب)</span></>}</span>
                <Choice label={IMPORT_FIELD_LABEL[f]} value={mapping[f] === undefined ? '' : String(mapping[f])} noneLabel="— لا يوجد —"
                  onChange={(v) => setMapping((m) => {
                    const next: Mapping = { ...m };
                    if (v === '') delete next[f];
                    else {
                      for (const k of Object.keys(next) as ImportField[]) if (next[k] === Number(v)) delete next[k]; // one column, one field
                      next[f] = Number(v);
                    }
                    return next;
                  })}
                  options={headers.map((h, i) => ({ value: String(i), label: h.trim() || `العمود ${fmtNumber(i + 1)}` }))} />
              </div>
            ))}
          </div>
          {detected === 'ambiguous' && (
            <div className="import-date-order mt">
              <span>تواريخ الميلاد في ملفك مكتوبة:</span>
              <Choice label="ترتيب التاريخ" value={askedOrder} onChange={(v) => setAskedOrder(v === 'mdy' ? 'mdy' : 'dmy')} className="h-10 w-56 bg-card"
                options={[{ value: 'dmy', label: 'يوم / شهر / سنة (15/3/1990)' }, { value: 'mdy', label: 'شهر / يوم / سنة (3/15/1990)' }]} />
            </div>
          )}
          <Preview rows={rows.slice(0, 5)} mapping={mapping} />
          {missing.length > 0 && <Alert tone="info">اختر عمود {missing.map((f) => IMPORT_FIELD_LABEL[f]).join(' و')} للمتابعة.</Alert>}
          <ErrorText error={error} />
          <div className="row-end mt">
            <Button onClick={() => void send(true)} loading={!!busy} disabled={missing.length > 0 || !rows.length}>فحص الملف</Button>
          </div>
          {busy && <Progress busy={busy} label="جارٍ الفحص" />}
        </Card>
      )}

      {(step === 'checked' || step === 'done') && report && (
        <Card>
          <h2 ref={heading} tabIndex={-1}>{step === 'done' ? 'تم الاستيراد' : '3. نتيجة الفحص'}</h2>
          {step === 'done'
            ? <Alert tone="success">تم استيراد {patientsText(created, fmtNumber)}. تم تخطي المكرر والصفوف التي بها أخطاء.</Alert>
            : <p className="muted">لم يُحفظ شيء بعد. هذا ما سيحدث عند الاستيراد:</p>}
          <div className="import-counts">
            <div><strong>{fmtNumber(step === 'done' ? created : report.counts.new)}</strong><span>{step === 'done' ? 'أضيفوا' : 'جديد سيُضاف'}</span></div>
            <div><strong>{fmtNumber(report.counts.duplicate)}</strong><span>{step === 'done' ? 'مسجّلون بالفعل أو مكررون (تم تخطيهم)' : 'مسجّلون بالفعل أو مكررون (سيُتخطَّون)'}</span></div>
            <div className={report.counts.invalid ? 'is-bad' : undefined}><strong>{fmtNumber(report.counts.invalid)}</strong><span>{step === 'done' ? 'بها أخطاء (تم تخطيها)' : 'بها أخطاء (ستُتخطَّى)'}</span></div>
          </div>
          {overRoom && step === 'checked' && (
            <Alert>باقتك تسمح بإضافة {patientsText(report.room!, fmtNumber)} فقط، والملف فيه {patientsText(report.counts.new, fmtNumber)} جديد. رقِّ الباقة أو قسّم الملف.</Alert>
          )}
          {problems.length > 0 && (
            <>
              <div className="import-problems-head">
                <h3>{step === 'done' ? 'الصفوف التي لم تُستورد' : 'الصفوف التي لن تُستورد'}</h3>
                <Button variant="ghost" onClick={downloadProblems}>تنزيلها كملف</Button>
              </div>
              <div className="table-wrap">
                <table className="import-table">
                  <thead><tr><th>السطر</th><th>الاسم</th><th>السبب</th></tr></thead>
                  <tbody>
                    {problems.slice(0, 200).map((r, i) => (
                      <tr key={`${r.row}-${i}`}>
                        <td>{fmtNumber(r.row)}</td><td><bdi>{nameOf(r.row)?.fullName ?? '—'}</bdi></td>
                        <td>{r.status === 'invalid' ? <Badge tone="danger">خطأ</Badge> : <Badge tone="neutral">مكرر</Badge>} {rowProblem(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {problems.length > 200 && <p className="muted small">يظهر أول 200 صف فقط. نزّل الملف لرؤيتها كلها.</p>}
            </>
          )}
          <ErrorText error={error} />
          {step === 'checked' && (
            <div className="row-end mt">
              <Button variant="ghost" onClick={() => setStep('map')} disabled={!!busy}>تعديل المطابقة</Button>
              <Button onClick={() => void send(false)} loading={!!busy} disabled={!report.counts.new || !!overRoom}>
                استيراد {patientsText(report.counts.new, fmtNumber)}
              </Button>
            </div>
          )}
          {busy && <Progress busy={busy} label="جارٍ الاستيراد" />}
          {created > 0 && step !== 'done' && error != null && <Alert tone="info">تم استيراد {patientsText(created, fmtNumber)} قبل التوقف. إعادة الاستيراد لن تكرّرهم.</Alert>}
          {step === 'done' && <div className="row-end mt"><RouteLink route={to.list('patients')} className="btn btn-primary">عرض المرضى</RouteLink></div>}
        </Card>
      )}
    </div>
  );
}

function Preview({ rows, mapping }: { rows: ImportRow[]; mapping: Mapping }) {
  const fields = IMPORT_FIELDS.filter((f) => mapping[f] !== undefined);
  if (!rows.length || !fields.length) return null;
  return (
    <div className="mt">
      <h3 className="small muted">أول الصفوف كما ستُقرأ</h3>
      <div className="table-wrap">
        <table className="import-table">
          <thead><tr><th>السطر</th>{fields.map((f) => <th key={f}>{IMPORT_FIELD_LABEL[f]}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.row}><td>{fmtNumber(r.row)}</td>{fields.map((f) => <td key={f}><bdi>{r[f] ?? ''}</bdi></td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Progress({ busy, label }: { busy: { done: number; total: number }; label: string }) {
  const pct = busy.total ? Math.round((busy.done / busy.total) * 100) : 0;
  return (
    <div className="mt-sm" role="status">
      <p className="muted small">{label}: {fmtNumber(busy.done)} من {fmtNumber(busy.total)}</p>
      <div className="progress" aria-hidden><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
