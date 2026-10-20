import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** `disabled`: shown (it is the current value) but not choosable, as a branch that was closed */
export interface Option { value: string; label: string; disabled?: boolean }

/** Radix Select cannot carry an empty value, so "nothing chosen" travels as this sentinel. */
const NONE = '__none__';

/**
 * A labelled shadcn/ui Select for the dashboard's forms. `id` goes on the trigger, so a `<label htmlFor>` (our Field)
 * focuses it; `noneLabel` adds an explicit "not set" choice for optional fields.
 */
export function Choice({ id, value, onChange, options, placeholder, noneLabel, invalid, className, label, disabled }: {
  id?: string; value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; noneLabel?: string;
  invalid?: boolean; className?: string; label?: string; disabled?: boolean;
}) {
  return (
    <Select value={value || (noneLabel ? NONE : '')} onValueChange={(v) => onChange(v === NONE ? '' : v)} dir={'rtl'} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} aria-invalid={invalid || undefined} className={className ?? 'h-10 w-full min-w-40 bg-card'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
