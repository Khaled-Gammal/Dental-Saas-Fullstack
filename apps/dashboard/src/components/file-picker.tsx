import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { t } from '../i18n';
import { Button, LinkButton } from '../ui/components';

/**
 * One file, chosen in Arabic (redesign R4b): the browser's own field says "Choose File / No file chosen" in the
 * browser's language. The real input stays hidden; the button takes the Field's id, so the label still names it.
 * Controlled by `file`: the parent clears it (null) after an upload, and the same file can be picked again.
 */
export function FilePicker({ id, describedBy, accept, file, onChange, disabled }: {
  id?: string;
  describedBy?: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="file-picker">
      <input ref={input} type="file" accept={accept} hidden tabIndex={-1}
        onChange={(e) => { onChange(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      <Button id={id} aria-describedby={describedBy} variant="secondary" disabled={disabled} onClick={() => input.current?.click()}>
        <Upload size={16} aria-hidden />{t(file ? 'changeFile' : 'pickFile')}
      </Button>
      {file
        ? <span className="file-picker-name"><bdi dir="auto">{file.name}</bdi></span>
        : <span className="muted small">{t('noFileChosen')}</span>}
      {file && !disabled && <LinkButton onClick={() => onChange(null)}>{t('remove')}</LinkButton>}
    </div>
  );
}
