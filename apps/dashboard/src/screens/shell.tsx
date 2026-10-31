import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import {
  Building2, CalendarDays, ChartColumn, ClipboardList, ChevronDown, ChevronsUpDown, Database, Globe, Home, Image, List, LogOut, MapPin, PenLine, Phone, Receipt, ShieldCheck,
  Stethoscope, Tag, Banknote, UserCog, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { can, logout, type Session } from '../api';
import { roleLabel } from '../labels';
import { Badge, initials } from '../ui/components';
import { ToothIcon } from '../ui/icons';
import { setClinicCurrency } from '../money';
import { setClinicTimeZone } from '../util';
import { useProfile } from '../queries';
import { canSee } from '../access';
import { href, to, type Page } from '../router';
import { activeGroup, NAV_FOOT, NAV_GROUPS, navPageOf, visibleNav, type NavIcon, type NavItem } from '../nav';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';

const ICONS: Record<NavIcon, LucideIcon> = {
  home: Home, calendar: CalendarDays, users: Users, clipboard: ClipboardList, phone: Phone, clinic: Building2, team: UserCog, pin: MapPin, stethoscope: Stethoscope, list: List,
  edit: PenLine, receipt: Receipt, tag: Tag, cash: Banknote, wallet: Wallet, chart: ChartColumn, image: Image, globe: Globe, shield: ShieldCheck,
  database: Database,
};

export const clinicName = (session: Session) => arName(session.clinic.nameAr, session.clinic.nameEn, session.clinic.slug);

/**
 * Whether the sidebar starts expanded: the member's last choice (shadcn's SidebarProvider keeps it in a cookie, so a
 * reload keeps it); with no choice yet, expanded on wide screens and icons only on tablets, where the page needs room.
 */
function startOpen(): boolean {
  const saved = /(?:^|;\s*)sidebar_state=(true|false)/.exec(document.cookie)?.[1];
  return saved ? saved === 'true' : !window.matchMedia('(max-width: 1023px)').matches;
}

/**
 * The dashboard shell (redesign R1): shadcn/ui's Sidebar on the right (the dashboard is right-to-left), collapsible to
 * icons on desktop and a sheet on phones, grouped by module; the header with the sidebar toggle and the clinic; the
 * page in `children`. The member sees only the pages they may open (access.ts); the API checks every request anyway.
 */
/**
 * Pages that are settings or one form (UI refinement U1): a 960px column. Every other page (lists, tables, reports,
 * the overview) uses the full width beside the sidebar; create/edit pages keep their own form width (.form-page).
 */
const NARROW_PAGES: ReadonlySet<string> = new Set(['data', 'booking', 'cash', 'discounts', 'holidays']);

export function AppShell({ session, page, children }: { session: Session; page: Page | 'not-found'; children: ReactNode }) {
  // the profile query is updated on save, so a renamed clinic shows everywhere at once
  const profile = useProfile(session.clinic.id).data;
  setClinicCurrency(profile?.currency); // before the screens below render their amounts (idempotent)
  setClinicTimeZone(profile?.timezone); // and their dates and times (review R11)
  const name = profile ? arName(profile.nameAr, profile.nameEn, session.clinic.slug) : clinicName(session);
  const skipToMain = (e: MouseEvent) => {
    e.preventDefault(); // a plain #main link would change the hash route
    document.getElementById('main')?.focus();
  };

  return (
    <SidebarProvider defaultOpen={startOpen()}>
      <a href="#main" className="skip" onClick={skipToMain}>انتقل للمحتوى</a>
      <AppSidebar session={session} page={page} clinic={name} />
      <SidebarInset className="min-w-0 bg-surface">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger className="-ms-1 size-9" aria-label="القائمة" />
          <Separator orientation="vertical" className="h-5" />
          <span className="truncate font-semibold text-ink"><bdi>{name}</bdi></span>
          {session.clinic.status === 'trialing' && <Badge tone="warning">فترة تجريبية</Badge>}
        </header>
        <div id="main" className={`content${NARROW_PAGES.has(page) ? ' content-narrow' : ''}`} tabIndex={-1}>{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppSidebar({ session, page, clinic }: { session: Session; page: Page | 'not-found'; clinic: string }) {
  const has = (p: string) => can(session, p);
  const groups = visibleNav(NAV_GROUPS, (p) => canSee(has, p), has);
  const foot = visibleNav([{ id: null, label: null, items: NAV_FOOT }], (p) => canSee(has, p), has)[0]?.items ?? [];
  const current = navPageOf(page);

  return (
    <Sidebar side="right" collapsible="icon" aria-label="القائمة الرئيسية">
      <SidebarHeader className="gap-3 p-3">
        <div className="flex items-center gap-2.5 px-1 pt-1">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-accent text-white"><ToothIcon size={18} /></span>
          <span className="truncate text-base font-bold text-ink group-data-[collapsible=icon]:hidden">منصة الأسنان</span>
        </div>
        <div className="flex items-center gap-2.5 rounded-lg border bg-surface p-2 group-data-[collapsible=icon]:hidden">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-50 text-xs font-bold text-primary-700">{initials(clinic)}</span>
          <span className="flex min-w-0 flex-col leading-tight">
            <strong className="truncate text-sm text-ink"><bdi>{clinic}</bdi></strong>
            <small className="truncate text-xs text-muted-foreground" dir="ltr">{session.clinic.slug}</small>
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {groups.map((g) => (g.id && g.label
          ? <NavGroupSection key={g.id} id={g.id} label={g.label} items={g.items} current={current} open={activeGroup(groups, page) === g.id} />
          : (
            <SidebarGroup key="main">
              <SidebarGroupContent><NavItems items={g.items} current={current} /></SidebarGroupContent>
            </SidebarGroup>
          )))}
      </SidebarContent>
      <SidebarFooter className="gap-2">
        {foot.length > 0 && <NavItems items={foot} current={current} />}
        <UserMenu session={session} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Which groups this browser keeps open (a convenience only: storage may be blocked, and then groups start folded). */
const GROUPS_KEY = 'nav-open-groups';
function readOpenGroups(): string[] {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]') as string[]; } catch { return []; }
}
function saveOpenGroup(key: string, open: boolean) {
  try {
    const now = new Set(readOpenGroups());
    if (open) now.add(key); else now.delete(key);
    localStorage.setItem(GROUPS_KEY, JSON.stringify([...now]));
  } catch { /* not saved: nothing else depends on it */ }
}

/**
 * A module's links under a heading that folds. It opens by itself when the current page is inside it (a link, the back
 * button, a reload), remembers what the member opened or folded, and never folds in icon mode.
 */
function NavGroupSection({ id, label, items, current, open: hasActive }: { id: string; label: string; items: NavItem[]; current: Page | null; open: boolean }) {
  const { state, isMobile } = useSidebar();
  const [open, setOpenState] = useState(() => hasActive || readOpenGroups().includes(id));
  const setOpen = (v: boolean) => { setOpenState(v); saveOpenGroup(id, v); };
  useEffect(() => { if (hasActive) setOpenState(true); }, [hasActive]);
  const iconsOnly = state === 'collapsed' && !isMobile;
  return (
    <Collapsible open={open || iconsOnly} onOpenChange={setOpen} className="group/collapsible">
      <SidebarGroup className="py-1">
        <SidebarGroupLabel asChild className="text-xs font-semibold text-muted-foreground hover:bg-sidebar-accent hover:text-ink">
          <CollapsibleTrigger className="w-full">
            {label}
            <ChevronDown className="ms-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent><NavItems items={items} current={current} /></SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

const ACTIVE = 'data-[active=true]:bg-primary-50 data-[active=true]:text-primary-700 data-[active=true]:font-semibold data-[active=true]:[&>svg]:text-primary-500';

function NavItems({ items, current }: { items: NavItem[]; current: Page | null }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const label = i.label;
        if (!i.page) {
          return (
            <SidebarMenuItem key={i.label}>
              <SidebarMenuButton aria-disabled="true" tooltip={`${label} · ${'قريبًا'}`} className="opacity-60">
                <Icon /><span>{label}</span>
              </SidebarMenuButton>
              <SidebarMenuBadge className="rounded-full bg-sidebar-accent px-2 text-[0.6875rem] text-muted-foreground">قريبًا</SidebarMenuBadge>
            </SidebarMenuItem>
          );
        }
        const active = current === i.page;
        return (
          <SidebarMenuItem key={i.page}>
            <SidebarMenuButton asChild isActive={active} tooltip={label} className={`h-9 text-sm text-sidebar-foreground ${ACTIVE}`}>
              <a href={href(to.list(i.page))} aria-current={active ? 'page' : undefined} onClick={() => setOpenMobile(false)}>
                <Icon /><span>{label}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/** The member and their role at the foot; signing out from its menu. */
function UserMenu({ session }: { session: Session }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu dir="rtl">
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={session.user.name} className="data-[state=open]:bg-sidebar-accent">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-50 text-xs font-bold text-primary-700">{initials(session.user.name)}</span>
              <span className="flex min-w-0 flex-1 flex-col text-start leading-tight">
                <strong className="truncate text-sm text-ink"><bdi>{session.user.name}</bdi></strong>
                <small className="truncate text-xs text-muted-foreground">{roleLabel(session.clinic.role, session.clinic.roleName)}</small>
              </span>
              <ChevronsUpDown className="ms-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span className="truncate"><bdi>{session.user.name}</bdi></span>
              {session.user.email && <span className="truncate text-xs font-normal text-muted-foreground" dir="ltr">{session.user.email}</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void logout()} className="text-destructive focus:text-destructive">
              <LogOut className="text-destructive" />خروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
