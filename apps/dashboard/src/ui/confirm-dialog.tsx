import { useRef, type ReactNode } from 'react';
import { t } from '../i18n';
import { Button } from './components';
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * The confirmation for destructive or hard-to-undo actions, and small forms that ask one more thing (a reason, a date).
 * shadcn/ui's AlertDialog (redesign R2): focus trapped and returned, Escape cancels, a click outside does not, focus
 * starts on Cancel (the safe choice). Controlled: render it, flip `open`. The confirm button never closes it by itself —
 * the caller does (so a missing reason keeps it open). Select menus inside it open above it (the native <dialog> it
 * replaces put them underneath).
 */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card sm:max-w-md"
        onOpenAutoFocus={(e) => { e.preventDefault(); cancel.current?.focus(); }}>
        <AlertDialogHeader className="place-items-start text-start sm:text-start">
          <AlertDialogTitle className="text-lg font-bold text-ink">{title}</AlertDialogTitle>
          {/* the body may hold fields, not only text: a div, with the description role for screen readers */}
          <AlertDialogDescription asChild><div className="dialog-body">{children}</div></AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-end">
          <Button ref={cancel} variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
