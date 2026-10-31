/**
 * Which permissions open each page (H4). One map for the menu and the router, so a member — whatever role the owner
 * gave them — never sees a menu item or lands on a page whose data the API would refuse. The API still checks every
 * request itself; this only hides what would fail. Pure, unit-tested.
 *
 * A need is a list of conditions, all required; a condition is one permission, or a list of which any one will do.
 */
import type { Page, Route } from './router';

type Need = readonly (string | readonly string[])[];
const CLINICAL = ['clinical:read', 'clinical:write'] as const;
const INVOICE_ANY = ['invoices:read', 'invoices:read:own'] as const;
const REPORTS = ['reports:read', 'reports:read:daily', 'reports:read:own'] as const;

/** The page itself (its list or main view). Pages open to every member read data the API gives every member. */
const PAGE: Record<Page, Need> = {
  overview: [], profile: [], branches: [], doctors: [], services: [], holidays: [], booking: [],
  appointments: ['appointments:read'],
  patients: ['patients:read'],
  followups: ['patients:read'],
  visits: [CLINICAL, 'patients:read'],
  plans: ['patients:read'],
  prescriptions: [CLINICAL],
  invoices: ['invoices:read'],
  payments: [INVOICE_ANY],
  discounts: ['discounts:approve'],
  expenses: ['expenses:read'],
  cash: ['cash:operate'],
  reports: [REPORTS],
  staff: ['staff:manage'],
  roles: ['staff:manage'],
  gallery: ['website:write'],
  website: ['website:write'], // Phase 2C-1
  activity: ['audit:read'], // Phase 2D: who changed or opened what
  // H8: the clinic owner only. No role can be given this (it is not in the permission catalogue); the owner's '*' has it
  data: ['clinic:owner'],
};

/** A page's other screens, where they need more (or other) than the page. */
const ACTION: Partial<Record<Page, Partial<Record<string, Need>>>> = {
  branches: { new: ['branches:write'], edit: ['branches:write'], hours: ['branches:write'] },
  doctors: { new: ['settings:write'], edit: ['settings:write'], schedule: ['settings:write'] },
  services: { new: ['settings:write'], edit: ['settings:write'] },
  appointments: { new: ['appointments:write', 'patients:read'], edit: ['appointments:write', 'appointments:read'] },
  patients: { new: ['patients:read', 'patients:write'], import: ['patients:read', 'patients:write', 'settings:write'], edit: ['patients:read', 'patients:write'], merge: ['patients:read', 'patients:merge'] },
  // a doctor opens the invoices of their own patients (invoices:read:own) but not the clinic's list
  invoices: { view: [INVOICE_ANY], print: [INVOICE_ANY], new: ['invoices:write', 'patients:read', INVOICE_ANY] },
  expenses: { new: ['expenses:read', 'expenses:write'] },
};

const meets = (has: (p: string) => boolean, need: Need) => need.every((c) => (typeof c === 'string' ? has(c) : c.some(has)));

/** May the member open this route? `has` answers one permission (the owner's '*' answers yes to all). */
export function canOpen(has: (p: string) => boolean, route: Route): boolean {
  if (route.page === 'not-found') return true;
  const need = (route.action && ACTION[route.page]?.[route.action]) ?? PAGE[route.page];
  return meets(has, need);
}

/** Should the menu show this page? The same rule as opening its list. */
export const canSee = (has: (p: string) => boolean, page: Page) => meets(has, PAGE[page]);
