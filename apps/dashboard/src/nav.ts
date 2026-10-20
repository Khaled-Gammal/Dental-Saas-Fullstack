/**
 * The dashboard's navigation (redesign R1): one configuration for the sidebar, grouped by module. Daily work sits at the
 * top as direct links; related modules are collapsible groups. Which items a member sees comes from `access.ts`
 * (the same rule as opening the page); the API still checks every request. Pure, unit-tested.
 */
import type { Key } from './i18n';
import type { Page } from './router';

export type NavIcon = 'home' | 'calendar' | 'users' | 'phone' | 'clinic' | 'team' | 'pin' | 'stethoscope' | 'list' | 'edit' | 'receipt' | 'tag' | 'cash'
  | 'wallet' | 'chart' | 'image' | 'globe' | 'shield' | 'database';
/** A page link, or an item shown as "soon" to who holds `perm` (the website editor). */
export interface NavItem { key: Key; icon: NavIcon; page?: Page; perm?: string }
export interface NavGroup { key: Key | null; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    key: null, // the daily work: always open, no heading
    items: [
      { key: 'navOverview', icon: 'home', page: 'overview' },
      { key: 'navAppointments', icon: 'calendar', page: 'appointments' },
      { key: 'navPatients', icon: 'users', page: 'patients' },
      { key: 'navFollowUps', icon: 'phone', page: 'followups' },
    ],
  },
  {
    key: 'navGroupClinic',
    items: [
      { key: 'navProfile', icon: 'clinic', page: 'profile' },
      { key: 'navBranches', icon: 'pin', page: 'branches' },
      { key: 'navDoctors', icon: 'stethoscope', page: 'doctors' },
      { key: 'navServices', icon: 'list', page: 'services' },
      { key: 'navConsents', icon: 'edit', page: 'consents' },
    ],
  },
  {
    key: 'navGroupFinance',
    items: [
      { key: 'navBilling', icon: 'receipt', page: 'invoices' },
      { key: 'navDiscounts', icon: 'tag', page: 'discounts' },
      { key: 'navCash', icon: 'cash', page: 'cash' },
      { key: 'navExpenses', icon: 'wallet', page: 'expenses' },
      { key: 'navReports', icon: 'chart', page: 'reports' },
    ],
  },
  {
    key: 'navGroupWebsite',
    items: [
      { key: 'navGallery', icon: 'image', page: 'gallery' },
      { key: 'navWebsite', icon: 'globe', perm: 'website:write' },
    ],
  },
  {
    key: 'navGroupTeam',
    items: [
      { key: 'navStaff', icon: 'team', page: 'staff' },
      { key: 'navRoles', icon: 'shield', page: 'roles' },
    ],
  },
];

/** At the foot of the sidebar: the owner's clinic data page. */
export const NAV_FOOT: NavItem[] = [{ key: 'navData', icon: 'database', page: 'data' }];

/** Pages without their own menu item belong to the item they are opened from (a visit to the patients, a payment to billing). */
const PARENT: Partial<Record<Page, Page>> = {
  visits: 'patients', plans: 'patients', prescriptions: 'patients', payments: 'invoices', holidays: 'branches', booking: 'branches',
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

/** The group holding the current page (it opens by itself), or null. */
export function activeGroup(groups: readonly NavGroup[], page: Page | 'not-found'): Key | null {
  const p = navPageOf(page);
  return groups.find((g) => g.key && g.items.some((i) => i.page === p))?.key ?? null;
}
