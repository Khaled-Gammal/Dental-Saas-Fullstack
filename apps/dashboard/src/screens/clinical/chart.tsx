import { useState } from 'react';
import { CONDITIONS, currentByTooth, PERMANENT, PRIMARY, showsPrimary, SURFACES, toothHistory, toothTone } from '../../clinical-model';
import { Choice } from '../../components/choice';
import { t, type Key, type Lang } from '../../i18n';
import { send, useClinicalMutation, usePatientChart } from '../../queries';
import type { ChartEntry, PatientChart, Surface, ToothCondition } from '../../types';
import { Button, Card, ErrorText, Field, Input, Skeleton, Switch } from '../../ui/components';

const loc = (lang: Lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
const cond = (c: ToothCondition, lang: Lang) => t(`cond_${c}` as Key, lang);

/**
 * The dental chart of a patient (SRS CHART-001): FDI numbering, the current condition per tooth, its history, and
 * new entries (a correction is a new entry; nothing is edited). `visitId` links new entries to the visit.
 */
export function ChartCard({ lang, clinicId, patientId, canWrite, age, visitId }: {
  lang: Lang; clinicId: string; patientId: string; canWrite: boolean; age: number | null; visitId?: string;
}) {
  const chart = usePatientChart(clinicId, patientId, true);
  const [tooth, setTooth] = useState<number | null>(null);
  const entries = chart.data?.entries ?? [];
  const [primary, setPrimary] = useState<boolean | null>(null);
  const withPrimary = primary ?? showsPrimary(entries, age);
  return (
    <Card>
      <div className="row-between">
        <h2>{t('chartTitle', lang)}</h2>
        <Switch checked={withPrimary} onChange={setPrimary} label={t('primaryTeeth', lang)} />
      </div>
      {chart.isError ? <ErrorText error={chart.error} onRetry={() => void chart.refetch()} />
        : chart.isLoading ? <Skeleton h={120} count={1} />
        : (
          <>
            <DentalChart lang={lang} chart={chart.data!} primary={withPrimary} selected={tooth} onSelect={(n) => setTooth(n === tooth ? null : n)} />
            <Legend lang={lang} />
            {tooth !== null && (
              <ToothPanel key={tooth} lang={lang} clinicId={clinicId} patientId={patientId} tooth={tooth} history={toothHistory(entries, tooth)}
                canWrite={canWrite} visitId={visitId} onClose={() => setTooth(null)} />
            )}
          </>
        )}
    </Card>
  );
}

/** The grid itself. Always left-to-right on screen, like a printed chart: the patient's right is on the viewer's left. */
export function DentalChart({ lang, chart, primary, selected, onSelect }: {
  lang: Lang; chart: PatientChart; primary: boolean; selected: number | null; onSelect: (tooth: number) => void;
}) {
  const now = currentByTooth(chart.entries);
  const row = (teeth: readonly number[], label: Key) => (
    <div className="chart-row" role="group" aria-label={t(label, lang)}>
      {teeth.map((n, i) => {
        const e = now.get(n);
        const tone = toothTone(e?.condition);
        return (
          <button key={n} type="button" className={`tooth${tone ? ` tone-${tone}` : ''}${selected === n ? ' is-on' : ''}${i === teeth.length / 2 ? ' mid' : ''}`}
            aria-pressed={selected === n} aria-label={`${t('tooth', lang)} ${n}${e ? `: ${cond(e.condition, lang)}` : ''}`} onClick={() => onSelect(n)}
            title={e ? `${cond(e.condition, lang)}${e.surfaces.length ? ` (${e.surfaces.join('')})` : ''}` : undefined}>
            <span className="tooth-no">{n}</span>
            {e && e.surfaces.length > 0 && <span className="tooth-surf">{e.surfaces.join('')}</span>}
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="dental-chart" dir="ltr">
      <div className="chart-sides muted small"><span>{t('patientRight', lang)}</span><span>{t('patientLeft', lang)}</span></div>
      {row(PERMANENT.upper, 'upperJaw')}
      {primary && row(PRIMARY.upper, 'upperPrimary')}
      {primary && row(PRIMARY.lower, 'lowerPrimary')}
      {row(PERMANENT.lower, 'lowerJaw')}
    </div>
  );
}

function Legend({ lang }: { lang: Lang }) {
  const tones: [string, Key][] = [['problem', 'toneProblem'], ['treated', 'toneTreated'], ['missing', 'toneMissing'], ['healthy', 'toneHealthy']];
  return (
    <ul className="chart-legend small muted">
      {tones.map(([k, label]) => <li key={k}><span className={`legend-dot tone-${k}`} aria-hidden />{t(label, lang)}</li>)}
    </ul>
  );
}

function ToothPanel({ lang, clinicId, patientId, tooth, history, canWrite, visitId, onClose }: {
  lang: Lang; clinicId: string; patientId: string; tooth: number; history: ChartEntry[]; canWrite: boolean; visitId?: string; onClose: () => void;
}) {
  const [condition, setCondition] = useState<ToothCondition>(history[0]?.condition ?? 'caries');
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [notes, setNotes] = useState('');
  const add = useClinicalMutation(clinicId, () => send(`/patients/${patientId}/chart`, 'POST', {
    ...(visitId && { visitId }), entries: [{ toothCode: tooth, condition, surfaces, ...(notes.trim() && { notes: notes.trim() }) }],
  }));
  const fmt = new Intl.DateTimeFormat(loc(lang), { dateStyle: 'medium', timeZone: 'Africa/Cairo' });
  const toggle = (s: Surface) => setSurfaces((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  return (
    <div className="tooth-panel mt">
      <div className="row-between">
        <h3>{t('tooth', lang)} <bdi dir="ltr">{tooth}</bdi></h3>
        <Button variant="ghost" onClick={onClose}>{t('hide', lang)}</Button>
      </div>
      {history.length === 0 ? <p className="muted small">{t('noToothHistory', lang)}</p> : (
        <ol className="stack-sm mt-sm">
          {history.map((e) => (
            <li key={e.id} className="history-row">
              <span className="muted small">{fmt.format(new Date(e.recorded_at))}</span>
              <span>
                <strong>{cond(e.condition, lang)}</strong>{e.surfaces.length > 0 && <> · <bdi dir="ltr">{e.surfaces.join('')}</bdi></>}
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
            <Field label={t('condition', lang)}>
              {(a) => <Choice id={a.id} lang={lang} value={condition} onChange={(v) => setCondition(v as ToothCondition)} options={CONDITIONS.map((c) => ({ value: c, label: cond(c, lang) }))} />}
            </Field>
            <Field label={t('toothNote', lang)} optional={t('optional', lang)}>{(a) => <Input id={a.id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />}</Field>
          </div>
          <fieldset className="surface-picker">
            <legend className="small">{t('surfaces', lang)}</legend>
            <div className="chips" dir="ltr">
              {SURFACES.map((s) => (
                <button key={s} type="button" className={`chip-toggle${surfaces.includes(s) ? ' is-on' : ''}`} aria-pressed={surfaces.includes(s)}
                  title={t(`surf_${s}` as Key, lang)} onClick={() => toggle(s)}>{s}</button>
              ))}
            </div>
          </fieldset>
          <ErrorText error={add.error} />
          <div className="row-end"><Button type="submit" loading={add.isPending}>{t('addChartEntry', lang)}</Button></div>
        </form>
      )}
    </div>
  );
}
