import type { ReactNode } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';

/**
 * The parts the clinic dashboard and the platform panel share around their pages (2026-11-04, the websites' design):
 * the floating glass bar on top, and the pieces of the night-coloured sidebar.
 */

/** A link in the sidebar's menu: the panel's light text, the current page filled with the clinic colour. */
export const NAV_LINK = 'h-9 text-sm text-sidebar-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:font-semibold '
  + 'data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-[0_10px_20px_-12px_var(--brand-fill)]';

/** The mark and name at the top of the sidebar; only the mark shows when it folds to icons. */
export function SidebarBrand({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-1 pt-1">
      <span className="sb-mark" aria-hidden>{icon}</span>
      <span className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
        <strong className="truncate text-base font-extrabold text-white">{title}</strong>
        {sub && <small className="truncate text-xs text-white/55">{sub}</small>}
      </span>
    </div>
  );
}

/** A clinic or a person in the sidebar: initials in a mark (square for a clinic), the name, and one line under it. */
export function SidebarIdentity({ mark, name, sub, subDir, square }: { mark: string; name: string; sub?: ReactNode; subDir?: 'ltr'; square?: boolean }) {
  return (
    <>
      <span className={`sb-avatar${square ? ' is-square' : ''}`} aria-hidden>{mark}</span>
      <span className="flex min-w-0 flex-1 flex-col text-start leading-tight">
        <strong className="truncate text-sm text-white"><bdi>{name}</bdi></strong>
        {sub && <small className="truncate text-xs text-white/55" dir={subDir}>{sub}</small>}
      </span>
    </>
  );
}

/** The floating glass bar above every page (the websites' header): the sidebar's toggle, then `children`. */
export function Topbar({ children }: { children: ReactNode }) {
  return (
    <header className="app-topbar">
      <SidebarTrigger className="size-9 rounded-full" aria-label="القائمة" />
      {children}
    </header>
  );
}
