import { useMemo } from 'react';
import { t } from '../i18n';
import { timeOptions } from '../time-model';
import { Choice } from './choice';

/**
 * A time of day in Arabic (redesign R5): one list of times `step` minutes apart, labelled "5:30 م". The browser's own
 * time input showed AM/PM in the browser's language. The value is still "HH:MM" (24 hours), as the API takes it.
 */
export function TimeField({ id, describedBy, value, onChange, label, step = 5, invalid, className }: {
  id?: string;
  describedBy?: string;
  value: string;
  onChange: (hhmm: string) => void;
  label?: string;
  step?: number;
  invalid?: boolean;
  className?: string;
}) {
  const options = useMemo(() => timeOptions(step, value), [step, value]);
  return (
    <Choice id={id} describedBy={describedBy} value={value} onChange={onChange} options={options} label={label} invalid={invalid}
      placeholder={t('pickTime')} className={className ?? 'h-10 w-36 bg-card tabular-nums'} />
  );
}
