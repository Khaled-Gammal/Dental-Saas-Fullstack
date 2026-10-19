import { useState } from 'react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const toIso = (d: Date) => format(d, 'yyyy-MM-dd');
const fromIso = (s: string) => new Date(`${s}T12:00:00`); // midday: never shifts to the previous day in any zone

/**
 * shadcn/ui date picker (Popover + Calendar). The value is an ISO date ('' = none); the display follows the UI
 * language and direction. `min`/`max` limit the choice; `years` switches the caption to month/year dropdowns
 * (for a birth date, where clicking back decades would be painful).
 */
export function DatePicker({ value, onChange, label, id, placeholder, min, max, years, invalid }: {
  value: string; onChange: (iso: string) => void; label?: string; id?: string; placeholder?: string;
  min?: string; max?: string; years?: boolean; invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const locale = ar; // Arabic only (L10N-001)
  const selected = value ? fromIso(value) : undefined;
  const disabled = [...(min ? [{ before: fromIso(min) }] : []), ...(max ? [{ after: fromIso(max) }] : [])];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" aria-label={label} aria-invalid={invalid || undefined}
          className="h-10 min-w-56 justify-start gap-2 font-normal data-[empty=true]:text-muted-foreground" data-empty={!value}>
          <CalendarIcon className="size-4 opacity-70" />
          {selected ? format(selected, years ? 'd MMMM yyyy' : 'EEEE d MMMM yyyy', { locale }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? (max ? fromIso(max) : undefined)}
          onSelect={(d) => { if (d) { onChange(toIso(d)); setOpen(false); } }}
          locale={locale}
          dir={'rtl'}
          weekStartsOn={6}
          disabled={disabled}
          {...(years && { captionLayout: 'dropdown' as const, startMonth: fromIso(min ?? '1920-01-01'), endMonth: fromIso(max ?? toIso(new Date())) })}
        />
      </PopoverContent>
    </Popover>
  );
}
