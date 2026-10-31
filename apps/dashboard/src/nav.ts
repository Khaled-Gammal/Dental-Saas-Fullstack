/**
 * The dashboard's navigation (redesign R1): one configuration for the sidebar, grouped by module. Daily work sits at the
 * top as direct links; related modules are collapsible groups. Which items a member sees comes from `access.ts`
 * (the same rule as opening the page); the API still checks every request. Pure, unit-tested.
 */
import type { Page } from './router';

export type NavIcon = 'home' | 'calendar' | 'users' | 'clipboard' | 'phone' | 'clinic' | 'team' | 'pin' | 'stethoscope' | 'list' | 'edit' | 'receipt' | 'tag' | 'cash'
  | 'wallet' | 'chart' | 'image' | 'globe' | 'shield' | 'database';
/** A page link, or an item shown as "soon" to who holds `perm` (the website editor). */
export interface NavItem { label: string; icon: NavIcon; page?: Page; perm?: string }
/** `id` names the group in code (its remembered open state, the active group); `label` is what the menu shows. */
export interface NavGroup { id: string | null; label: string | null; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    id: null, label: null, // the daily work: always open, no heading
    items: [
      { label: 'نظرة عامة', icon: 'home', page: 'overview' },
      { label: 'المواعيد', icon: 'calendar', page: 'appointments' },
      { label: 'المرضى', icon: 'users', page: 'patients' },
      { label: 'الزيارات', icon: 'clipboard', page: 'visits' }, // redesign R5: today's visits and the open drafts
      { label: 'المتابعات', icon: 'phone', page: 'followups' },
    ],
  },
  {
    id: 'clinic', label: 'العيادة',
    items: [
      { label: 'ملف العيادة', icon: 'clinic', page: 'profile' },
      { label: 'الفروع', icon: 'pin', page: 'branches' },
      { label: 'الأطباء', icon: 'stethoscope', page: 'doctors' },
      { label: 'الخدمات والأسعار', icon: 'list', page: 'services' },
    ],
  },
  {
    id: 'finance', label: 'المالية',
    items: [
      { label: 'الفواتير', icon: 'receipt', page: 'invoices' },
      { label: 'الخصومات', icon: 'tag', page: 'discounts' },
      { label: 'الخزنة اليومية', icon: 'cash', page: 'cash' },
      { label: 'المصروفات', icon: 'wallet', page: 'expenses' },
      { label: 'التقارير', icon: 'chart', page: 'reports' },
    ],
  },
  {
    id: 'website', label: 'الموقع الإلكتروني',
    items: [
      { label: 'معرض الصور', icon: 'image', page: 'gallery' },
      { label: 'الموقع', icon: 'globe', page: 'website' }, // Phase 2C-1: sections and questions
    ],
  },
  {
    id: 'team', label: 'الفريق والصلاحيات',
    items: [
      { label: 'فريق العمل', icon: 'team', page: 'staff' },
      { label: 'الأدوار والصلاحيات', icon: 'shield', page: 'roles' },
    ],
  },
];

/** At the foot of the sidebar: the owner's clinic data page. */
export const NAV_FOOT: NavItem[] = [{ label: 'بيانات العيادة', icon: 'database', page: 'data' }];

/** Pages without their own menu item belong to the item they are opened from (a visit to the patients, a payment to billing). */
const PARENT: Partial<Record<Page, Page>> = {
  plans: 'patients', prescriptions: 'patients', payments: 'invoices', holidays: 'branches', booking: 'branches',
};
export const navPageOf = (page: Page | 'not-found'): Page | null => (page === 'not-found' ? null : PARENT[page] ?? page);

/**
 * The groups this member sees: items they may open (or, for "soon" items, hold the permission for); a group with no
 * item left is dropped. `canSeePage` is access.ts's rule, `has` a permission check.
 */
export function visibleNav(groups: readonly NavGroup[], canSeePage: (p: Page) => boolean, has: (perm: string) => boolean): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => (i.page ? canSeePage(i.page) : !i.perm || has(i.perm))) }))
    .filter((g) => g.items.length > 0);
}

/** The id of the group holding the current page (it opens by itself), or null. */
export function activeGroup(groups: readonly NavGroup[], page: Page | 'not-found'): string | null {
  const p = navPageOf(page);
  return groups.find((g) => g.id && g.items.some((i) => i.page === p))?.id ?? null;
}
