import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { arName } from '@dental/ui/text';
import {
  Building2, CalendarDays, ChartColumn, ClipboardList, ChevronDown, ChevronsUpDown, Database, Globe, History, Home, Image, List, LogOut, MapPin, PenLine, Phone, Receipt, ShieldCheck,
  Stethoscope, Tag, Banknote, UserCog, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { can, logout, type Session } from '../api';
import { roleLabel } from '../labels';
import { Badge, initials } from '../ui/components';
import { NAV_LINK, SidebarBrand, SidebarIdentity, Topbar } from '../ui/app-chrome';
import { useBrandTheme } from '../hooks/use-brand-theme';
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
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, useSidebar,
} from '@/components/ui/sidebar';

const ICONS: Record<NavIcon, LucideIcon> = {
  home: Home, calendar: CalendarDays, users: Users, clipboard: ClipboardList, phone: Phone, clinic: Building2, team: UserCog, pin: MapPin, stethoscope: Stethoscope, list: List,
  edit: PenLine, receipt: Receipt, tag: Tag, cash: Banknote, wallet: Wallet, chart: ChartColumn, image: Image, globe: Globe, shield: ShieldCheck, history: History,
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
 * Every page fills the width beside the sidebar (2026-11-04, at the user's request: no narrower settings column).
 */
export function AppShell({ session, page, children }: { session: Session; page: Page | 'not-found'; children: ReactNode }) {
  // the profile query is updated on save, so a renamed clinic shows everywhere at once
  const profile = useProfile(session.clinic.id).data;
  setClinicCurrency(profile?.currency); // before the screens below render their amounts (idempotent)
  setClinicTimeZone(profile?.timezone); // and their dates and times (review R11)
  useBrandTheme(profile ? profile.brandColor : undefined, session.clinic.id); // 2026-11-04: the dashboard in the clinic's own colour
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
        <Topbar>
          <span className="truncate font-bold text-ink"><bdi>{name}</bdi></span>
          {session.clinic.status === 'trialing' && <Badge tone="warning">فترة تجريبية</Badge>}
          {/* Phase 2B: the paid period ran out; the clinic works for the grace days (details on the plan card) */}
          {session.clinic.status === 'past_due' && <Badge tone="danger">الاشتراك منتهٍ: جدِّده</Badge>}
        </Topbar>
        <div id="main" className="content" tabIndex={-1}>{children}</div>
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
        <SidebarBrand icon={<ToothIcon size={18} />} title="منصة الأسنان" />
        <div className="sb-card">{/* not on the folded rail (styles.css) */}
          <SidebarIdentity mark={initials(clinic)} name={clinic} sub={session.clinic.slug} subDir="ltr" square />
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
        <SidebarGroupLabel asChild className="text-xs font-semibold text-white/45 hover:bg-sidebar-accent hover:text-white">
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
              <SidebarMenuBadge className="rounded-full bg-sidebar-accent px-2 text-[0.6875rem] text-white/60">قريبًا</SidebarMenuBadge>
            </SidebarMenuItem>
          );
        }
        const active = current === i.page;
        return (
          <SidebarMenuItem key={i.page}>
            <SidebarMenuButton asChild isActive={active} tooltip={label} className={NAV_LINK}>
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
              <SidebarIdentity mark={initials(session.user.name)} name={session.user.name} sub={roleLabel(session.clinic.role, session.clinic.roleName)} />
              <ChevronsUpDown className="ms-auto size-4 text-white/50" />
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
