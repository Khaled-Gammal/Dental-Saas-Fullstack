import { useRef, useState, type KeyboardEvent } from 'react';
import { CANINE_PATH, INCISOR_PATH, PREMOLAR_PATH, TOOTH_PATH } from '@dental/ui/arch';
import { CONDITIONS, currentByTooth, showsPrimary, SURFACES, toothHistory, toothTone } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { CHART_KEYS, jawLayout, moveInChart, toothName, type ChartKey, type ChartTooth, type JawKey, type ToothKind } from '../../jaw-model';
import { toothConditionLabel, toothSurfaceLabel } from '../../labels';
import { send, useClinicalMutation, usePatientChart } from '../../queries';
import type { ChartEntry, PatientChart, Surface, ToothCondition } from '../../types';
import { Button, Card, ErrorText, Field, Input, Skeleton, Switch } from '../../ui/components';
import { clinicTimeZone, LOC } from '../../util';

const cond = (c: ToothCondition) => toothConditionLabel[c];

/**
 * The dental chart of a patient (SRS CHART-001): FDI numbering, the current condition per tooth, its history, and
 * new entries (a correction is a new entry; nothing is edited). `visitId` links new entries to the visit.
 */
export function ChartCard({ clinicId, patientId, canWrite, age, visitId, onProcedure }: {
  clinicId: string; patientId: string; canWrite: boolean; age: number | null; visitId?: string;
  /** redesign R8: on the visit, record a procedure on the chosen tooth (the form opens with the tooth filled in) */
  onProcedure?: (tooth: number) => void;
}) {
  const chart = usePatientChart(clinicId, patientId, true);
  const [tooth, setTooth] = useState<number | null>(null);
  const entries = chart.data?.entries ?? [];
  const [primary, setPrimary] = useState<boolean | null>(null);
  const withPrimary = primary ?? showsPrimary(entries, age);
  return (
    <Card>
      <div className="row-between">
        <h2>خريطة الأسنان</h2>
        <Switch checked={withPrimary} onChange={setPrimary} label="الأسنان اللبنية" />
      </div>
      {chart.isError ? <ErrorText error={chart.error} onRetry={() => void chart.refetch()} />
        : chart.isLoading ? <Skeleton h={120} count={1} />
        : (
          <>
            <DentalChart chart={chart.data!} primary={withPrimary} selected={tooth} onSelect={(n) => setTooth(n === tooth ? null : n)} />
            <Legend />
            {tooth !== null && (
              <ToothPanel key={tooth} clinicId={clinicId} patientId={patientId} tooth={tooth} history={toothHistory(entries, tooth)}
                canWrite={canWrite} visitId={visitId} onClose={() => setTooth(null)} onProcedure={onProcedure && (() => onProcedure(tooth))} />
            )}
          </>
        )}
    </Card>
  );
}

const OUTLINE: Record<ToothKind, string> = { incisor: INCISOR_PATH, canine: CANINE_PATH, premolar: PREMOLAR_PATH, molar: TOOTH_PATH };
const JAW_LABEL: Record<JawKey, string> = { upper: 'الفك العلوي', primaryUpper: 'اللبنية العلوية', primaryLower: 'اللبنية السفلية', lower: 'الفك السفلي' };

/**
 * The chart as two jaws (2026-11-04, the user's idea, after the landing page's arch of teeth; jaw-model.ts): each tooth
 * in its own outline, coloured by its current condition. Pointing at a tooth or focusing it lifts it and names it in
 * the middle of the mouth; a click, Enter or Space chooses it; the arrow keys walk the teeth (one tooth takes Tab).
 * Drawn as the dentist faces the patient, like a printed chart: the patient's right on the viewer's left.
 */
export function DentalChart({ chart, primary, selected, onSelect }: {
  chart: PatientChart; primary: boolean; selected: number | null; onSelect: (tooth: number) => void;
}) {
  const now = currentByTooth(chart.entries);
  const layout = jawLayout(primary);
  const [pointed, setPointed] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null); // the last tooth walked to with the keys
  const nodes = useRef(new Map<number, SVGGElement>());
  const codes = new Set(layout.jaws.flatMap((j) => j.teeth.map((t) => t.code)));
  const tabStop = [selected, cursor].find((c): c is number => c !== null && codes.has(c)) ?? 11;
  const shown = pointed ?? focused ?? selected;
  const keyDown = (code: number) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(code); return; }
    if (!CHART_KEYS.includes(e.key)) return;
    e.preventDefault();
    const next = moveInChart(code, e.key as ChartKey, primary);
    setCursor(next);
    nodes.current.get(next)?.focus();
  };
  return (
    <div className={`jaw-chart${primary ? ' has-primary' : ''}`} dir="ltr">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="jaw-svg" aria-label="خريطة الأسنان">
        {layout.gums.map((d) => <path key={d} d={d} className="jaw-gum" />)}
        {layout.jaws.map((jaw) => (
          <g key={jaw.key} role="group" aria-label={JAW_LABEL[jaw.key]}>
            {jaw.teeth.map((t) => (
              <Tooth key={t.code} t={t} entry={now.get(t.code)} on={selected === t.code} tabIndex={t.code === tabStop ? 0 : -1}
                register={(el) => { if (el) nodes.current.set(t.code, el); else nodes.current.delete(t.code); }}
                onChoose={() => { setCursor(t.code); onSelect(t.code); }} onKeyDown={keyDown(t.code)}
                onPoint={(over) => setPointed(over ? t.code : null)} onFocusChange={(has) => setFocused(has ? t.code : null)} />
            ))}
          </g>
        ))}
      </svg>
      <div className="jaw-sides small muted" aria-hidden><span>يمين المريض</span><span>يسار المريض</span></div>
      <ToothInfo code={shown} entry={shown === null ? undefined : now.get(shown)} />
    </div>
  );
}

/** One tooth: its outline turned to face out of the mouth, the area that answers the pointer, its number and surfaces. */
function Tooth({ t, entry, on, tabIndex, register, onChoose, onKeyDown, onPoint, onFocusChange }: {
  t: ChartTooth; entry?: ChartEntry; on: boolean; tabIndex: number; register: (el: SVGGElement | null) => void;
  onChoose: () => void; onKeyDown: (e: KeyboardEvent<SVGGElement>) => void; onPoint: (over: boolean) => void; onFocusChange: (has: boolean) => void;
}) {
  const tone = toothTone(entry?.condition);
  const surfaces = entry?.surfaces.join('') ?? '';
  // the pointer area runs past the number: outward for permanent teeth, inward for primary ones (their numbers are inside)
  const outward = t.jaw === 'upper' || t.jaw === 'lower';
  return (
    <g ref={register} className={`jaw-tooth${outward ? '' : ' is-primary'}${tone ? ` tone-${tone}` : ''}${on ? ' is-on' : ''}`} role="button" tabIndex={tabIndex} aria-pressed={on}
      aria-label={`${'سن'} ${t.code}، ${toothName(t.code)}${entry ? `: ${cond(entry.condition)}${surfaces ? ` (${surfaces})` : ''}` : ''}`}
      onClick={onChoose} onKeyDown={onKeyDown} onPointerEnter={() => onPoint(true)} onPointerLeave={() => onPoint(false)}
      onFocus={() => onFocusChange(true)} onBlur={() => onFocusChange(false)}>
      <g transform={`translate(${t.x} ${t.y}) rotate(${t.angle})`}>
        <rect className="jaw-hit" x={-t.span / 2} y={outward ? -(t.height / 2 + 26) : -(t.height / 2 + 4)} width={t.span} height={t.height + 30} rx={8} />
        <g className="jaw-glyph"><path className="jaw-crown" d={OUTLINE[t.kind]} transform={`scale(${t.scale}) translate(-12 -12)`} /></g>
      </g>
      {on && <circle className="jaw-pill" cx={t.label.x} cy={t.label.y} r={outward ? 10 : 8} />}
      <text className="jaw-no" x={t.label.x} y={t.label.y}>{t.code}</text>
      {surfaces && <text className="jaw-note" x={t.note.x} y={t.note.y}>{surfaces}</text>}
    </g>
  );
}

/** The middle of the mouth: the tooth pointed at, focused or chosen, by number and name, with its current condition. */
function ToothInfo({ code, entry }: { code: number | null; entry?: ChartEntry }) {
  if (code === null) return <p className="jaw-info is-idle" dir="rtl" aria-hidden>اختر سنًّا لعرض تفاصيله</p>;
  const tone = toothTone(entry?.condition);
  return (
    <div className="jaw-info" dir="rtl" aria-hidden>
      <strong className="jaw-info-no"><bdi dir="ltr">{code}</bdi></strong>
      <span className="jaw-info-name">{toothName(code)}</span>
      <span className={`jaw-info-state${tone ? ` tone-${tone}` : ''}`}>
        {entry ? cond(entry.condition) : 'لا تسجيلات'}
        {entry && entry.surfaces.length > 0 && <> · <bdi dir="ltr">{entry.surfaces.join('')}</bdi></>}
      </span>
    </div>
  );
}

function Legend() {
  const tones: [string, string][] = [['problem', 'يحتاج علاج'], ['treated', 'معالَج'], ['missing', 'مفقود'], ['healthy', 'سليم']];
  return (
    <ul className="chart-legend small muted">
      {tones.map(([k, label]) => <li key={k}><span className={`legend-dot tone-${k}`} aria-hidden />{label}</li>)}
    </ul>
  );
}

function ToothPanel({ clinicId, patientId, tooth, history, canWrite, visitId, onClose, onProcedure }: {
  clinicId: string; patientId: string; tooth: number; history: ChartEntry[]; canWrite: boolean; visitId?: string; onClose: () => void; onProcedure?: () => void;
}) {
  const [condition, setCondition] = useState<ToothCondition>(history[0]?.condition ?? 'caries');
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [notes, setNotes] = useState('');
  const add = useClinicalMutation(clinicId, () => send(`/patients/${patientId}/chart`, 'POST', {
    ...(visitId && { visitId }), entries: [{ toothCode: tooth, condition, surfaces, ...(notes.trim() && { notes: notes.trim() }) }],
  }));
  const fmt = new Intl.DateTimeFormat(LOC, { dateStyle: 'medium', timeZone: clinicTimeZone() });
  const toggle = (s: Surface) => setSurfaces((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  return (
    <div className="tooth-panel mt">
      <div className="row-between">
        <h3>سن <bdi dir="ltr">{tooth}</bdi></h3>
        <div className="row-end">
          {onProcedure && <Button variant="secondary" onClick={onProcedure}>إجراء على هذا السن</Button>}
          <Button variant="ghost" onClick={onClose}>إخفاء</Button>
        </div>
      </div>
      {history.length === 0 ? <p className="muted small">لا توجد تسجيلات لهذا السن.</p> : (
        <ol className="stack-sm mt-sm">
          {history.map((e) => (
            <li key={e.id} className="history-row">
              <span className="muted small">{fmt.format(new Date(e.recorded_at))}</span>
              <span>
                <strong>{cond(e.condition)}</strong>{e.surfaces.length > 0 && <> · <bdi dir="ltr">{e.surfaces.join('')}</bdi></>}
                {e.recorded_by_name && <span className="muted small"> · <bdi>{e.recorded_by_name}</bdi></span>}
                {e.notes && <span className="muted small"> — <bdi>{e.notes}</bdi></span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {canWrite && (
        <form className="stack mt" onSubmit={(ev) => { ev.preventDefault(); add.mutate(undefined, { onSuccess: () => { setSurfaces([]); setNotes(''); } }); }}>
          <div className="grid-2">
            <Field label="الحالة">
              {(a) => <Choice id={a.id} value={condition} onChange={(v) => setCondition(v as ToothCondition)} options={CONDITIONS.map((c) => ({ value: c, label: cond(c) }))} />}
            </Field>
            <Field label="ملاحظة" optional="اختياري">{(a) => <Input id={a.id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />}</Field>
          </div>
          <fieldset className="surface-picker">
            <legend className="small">الأسطح</legend>
            <div className="chips" dir="ltr">
              {SURFACES.map((s) => (
                <button key={s} type="button" className={`chip-toggle${surfaces.includes(s) ? ' is-on' : ''}`} aria-pressed={surfaces.includes(s)}
                  title={toothSurfaceLabel[s]} onClick={() => toggle(s)}>{s}</button>
              ))}
            </div>
          </fieldset>
          <ErrorText error={add.error} />
          <div className="row-end"><Button type="submit" loading={add.isPending}>تسجيل</Button></div>
        </form>
      )}
    </div>
  );
}
