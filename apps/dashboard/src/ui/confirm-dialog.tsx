import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '../i18n';
import { useLang } from '../lang';
import { Button } from './components';

/**
 * A native <dialog> (focus trap, Escape and the ::backdrop styling for free) for destructive or hard-to-undo actions.
 * Controlled: render it always, flip `open`. Focus lands on Cancel on purpose: the safe choice for a destructive dialog.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const lang = useLang();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="row-end">
        <Button variant="ghost" onClick={onCancel}>{t('cancel', lang)}</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
