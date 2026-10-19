import { useState, type KeyboardEvent } from 'react';
import { t } from '../../i18n';
import { addItem, historyBody, toHistoryForm, type HistoryForm } from '../../patient-model';
import { useHistoryVersions, useSaveMedicalHistory } from '../../queries';
import type { MedicalHistory } from '../../types';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, LinkButton, Switch, TextArea } from '../../ui/components';
import { AlertIcon, CloseIcon, EditIcon } from '../../ui/icons';

type ListKey = 'allergies' | 'conditions' | 'medications';
const LISTS: ListKey[] = ['allergies', 'conditions', 'medications'];

/**
 * Medical history card on the patient profile. `history` is null when the caller's role may not see clinical data
 * (the API leaves it out); `canEdit` = clinical:write. Allergies and conditions are shown as alerts first.
 */
export function MedicalHistoryCard({ clinicId, patientId, history, canEdit }: { clinicId: string; patientId: string; history: MedicalHistory | null; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  if (!history) {
    return (
      <Card>
        <h2>{t('medicalHistory')}</h2>
        <p className="muted small mt-sm">{t('clinicalHidden')}</p>
      </Card>
    );
  }
  if (editing) return <HistoryEditor clinicId={clinicId} patientId={patientId} history={history} onDone={() => setEditing(false)} />;
  const empty = !history.allergies.length && !history.conditions.length && !history.medications.length && history.is_pregnant === null && history.is_smoker === null && !history.notes;
  return (
    <Card>
      <div className="row-between">
        <h2>{t('medicalHistory')}</h2>
        {canEdit && <Button variant="secondary" onClick={() => setEditing(true)}><EditIcon size={16} />{t('edit')}</Button>}
      </div>
      {empty ? <p className="muted small mt-sm">{t('noHistory')}</p> : (
        <div className="stack mt">
          {(history.allergies.length > 0 || history.is_pregnant) && (
            <Alert tone="danger">
              <strong><AlertIcon size={16} /> {t('alerts')}:</strong>{' '}
              {[...history.allergies.map((a) => `${t('allergyTo')} ${a}`), ...(history.is_pregnant ? [t('pregnant')] : [])].join(' · ')}
            </Alert>
          )}
          {LISTS.map((k) => history[k].length > 0 && (
            <div key={k} className="history-row">
              <span className="muted small">{t(k)}</span>
              <span className="chips">{history[k].map((x) => <Badge key={x} tone={k === 'allergies' ? 'warning' : 'neutral'}><bdi>{x}</bdi></Badge>)}</span>
            </div>
          ))}
          {history.is_smoker !== null && <div className="history-row"><span className="muted small">{t('smoker')}</span><span>{t(history.is_smoker ? 'yes' : 'no')}</span></div>}
          {history.notes && <p className="history-notes">{history.notes}</p>}
        </div>
      )}
      {history.updated_at && <Versions clinicId={clinicId} patientId={patientId} />}
    </Card>
  );
}

/** Earlier versions (SRS PATIENT-005): every save is kept; loaded only when opened (the opening is audited). */
function Versions({ clinicId, patientId }: { clinicId: string; patientId: string }) {
  const [open, setOpen] = useState(false);
  const versions = useHistoryVersions(clinicId, patientId, open);
  const fmt = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(iso));
  return (
    <div className="mt">
      <LinkButton onClick={() => setOpen(!open)} aria-expanded={open}>{t(open ? 'hideVersions' : 'historyVersions')}</LinkButton>
      {open && (versions.isError ? <ErrorText error={versions.error} />
        : versions.isLoading ? <p className="muted small" role="status">{t('loading')}</p>
        : (
          <ol className="stack mt-sm">
            {versions.data?.map((v) => (
              <li key={v.id} className="history-version">
                <span className="muted small">{fmt(v.saved_at)}{v.saved_by_name && <> · <bdi>{v.saved_by_name}</bdi></>}</span>
                {LISTS.map((k) => v[k].length > 0 && (
                  <div key={k} className="history-row"><span className="muted small">{t(k)}</span><span><bdi>{v[k].join('، ')}</bdi></span></div>
                ))}
                {v.notes && <p className="history-notes">{v.notes}</p>}
              </li>
            ))}
          </ol>
        ))}
    </div>
  );
}

function HistoryEditor({ clinicId, patientId, history, onDone }: { clinicId: string; patientId: string; history: MedicalHistory; onDone: () => void }) {
  const [form, setForm] = useState<HistoryForm>(() => toHistoryForm(history));
  const [draft, setDraft] = useState<Record<ListKey, string>>({ allergies: '', conditions: '', medications: '' });
  const save = useSaveMedicalHistory(clinicId, patientId);
  const add = (k: ListKey) => { setForm((f) => ({ ...f, [k]: addItem(f[k], draft[k]) })); setDraft((d) => ({ ...d, [k]: '' })); };
  const onKey = (k: ListKey) => (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' || e.key === ',' || e.key === '،') { e.preventDefault(); add(k); } };
  const remove = (k: ListKey, item: string) => setForm((f) => ({ ...f, [k]: f[k].filter((x) => x !== item) }));
  const submit = () => {
    // anything still typed in a box counts, so "Save" never silently drops it
    const final = LISTS.reduce((f, k) => ({ ...f, [k]: addItem(f[k], draft[k]) }), form);
    save.mutate(historyBody(final), { onSuccess: onDone });
  };

  return (
    <Card>
      <h2>{t('medicalHistory')}</h2>
      <div className="stack mt">
        {LISTS.map((k) => (
          <Field key={k} label={t(k)} hint={t('listHint')}>
            {(a) => (
              <div className="tag-input">
                <span className="chips">
                  {form[k].map((x) => (
                    <Badge key={x} tone={k === 'allergies' ? 'warning' : 'neutral'}>
                      <bdi>{x}</bdi>
                      <button type="button" className="chip-x" onClick={() => remove(k, x)} aria-label={`${t('remove')} ${x}`}><CloseIcon size={12} /></button>
                    </Badge>
                  ))}
                </span>
                <Input id={a.id} describedBy={a.describedBy} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} onKeyDown={onKey(k)} onBlur={() => add(k)} maxLength={80} />
              </div>
            )}
          </Field>
        ))}
        <div className="switch-row">
          <Switch checked={form.isPregnant === true} onChange={(v) => setForm((f) => ({ ...f, isPregnant: v }))} label={t('pregnant')} />
          <Switch checked={form.isSmoker === true} onChange={(v) => setForm((f) => ({ ...f, isSmoker: v }))} label={t('smoker')} />
        </div>
        <Field label={t('notes')} optional={t('optional')}>{(a) => <TextArea id={a.id} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} maxLength={2000} />}</Field>
        <ErrorText error={save.error} />
        <div className="row-end">
          <Button variant="ghost" onClick={onDone}>{t('cancel')}</Button>
          <Button onClick={submit} loading={save.isPending}>{t('save')}</Button>
        </div>
      </div>
    </Card>
  );
}
