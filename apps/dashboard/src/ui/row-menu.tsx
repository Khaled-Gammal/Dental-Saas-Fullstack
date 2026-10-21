import { Fragment, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Route } from '../router';
import { RouteLink } from './page';

/**
 * One thing a row offers: a page to open (`route`, a real link: open-in-new-tab works) or something to do (`onSelect`,
 * e.g. open a confirm dialog the screen owns). `hidden` drops it for members who may not do it, as the API would refuse.
 */
export interface RowAction {
  label: string;
  icon?: ReactNode;
  route?: Route;
  onSelect?: () => void;
  /** voids, deletes, revokes: listed last, after a line, in red; the screen confirms them (AlertDialog) */
  destructive?: boolean;
  hidden?: boolean;
}

/**
 * The «⋯» menu at the end of a table row (UI refinement U2, after Untitled UI). It opens in a layer of its own, so the
 * table's frame never clips it, and it is keyboard-operable (Radix). Nothing shown when a member has no action here.
 */
export function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const shown = actions.filter((a) => !a.hidden);
  if (!shown.length) return null;
  const regular = shown.filter((a) => !a.destructive);
  const destructive = shown.filter((a) => a.destructive);
  const item = (a: RowAction) => (
    a.route
      ? <DropdownMenuItem key={a.label} asChild><RouteLink route={a.route} className="no-underline text-ink">{a.icon}{a.label}</RouteLink></DropdownMenuItem>
      : <DropdownMenuItem key={a.label} variant={a.destructive ? 'destructive' : 'default'} onSelect={a.onSelect}>{a.icon}{a.label}</DropdownMenuItem>
  );
  return (
    <DropdownMenu dir="rtl" modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="row-menu-trigger" aria-label={`${'إجراءات'}: ${label}`}>
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {regular.map(item)}
        {destructive.length > 0 && (
          <Fragment>
            {regular.length > 0 && <DropdownMenuSeparator />}
            {destructive.map(item)}
          </Fragment>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
