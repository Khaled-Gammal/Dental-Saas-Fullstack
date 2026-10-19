/**
 * Hash routes, one per screen: `#/doctors`, `#/doctors/new`, `#/doctors/<id>/edit`, `#/doctors/<id>/schedule`.
 * Pure parsing/building lives here (unit-tested); the React hook is in `hooks.ts`.
 */
export type Page = 'overview' | 'profile' | 'branches' | 'appointments' | 'patients' | 'doctors' | 'services' | 'gallery' | 'staff' | 'holidays' | 'booking'
  | 'visits' | 'plans' | 'prescriptions' | 'followups' | 'invoices' | 'payments' | 'discounts' | 'expenses' | 'cash' | 'reports';
export type Action = 'new' | 'edit' | 'hours' | 'schedule' | 'view' | 'timeoff' | 'rooms' | 'print' | 'merge';

/** `query` carries optional, non-identifying hints such as `?catalog=rct` on a create page. */
export type Route = (
  | { page: Page; id?: undefined; action?: undefined }
  | { page: Page; id?: undefined; action: 'new' }
  | { page: Page; id: string; action: Exclude<Action, 'new'> }
  | { page: 'not-found'; id?: undefined; action?: undefined }
) & { query?: Record<string, string> };

/** What each resource page offers beyond its list. */
const ACTIONS: Record<Page, readonly Action[]> = {
  overview: [],
  profile: [],
  branches: ['new', 'edit', 'hours', 'rooms'],
  appointments: ['new', 'edit'], // `edit` = move to another time/doctor and/or give it a room
  patients: ['new', 'edit', 'view', 'merge'], // merge = another record of the same person is merged into this one
  gallery: ['new', 'edit'],
  doctors: ['new', 'edit', 'schedule', 'timeoff'],
  services: ['new', 'edit'],
  staff: ['new', 'edit'], // `new` = invite someone; `edit` = a member's role, branches and status
  holidays: [], // closed days (whole clinic or one branch)
  booking: [], // the website booking rules and reminders
  visits: ['view'], // the doctor's visit: notes, procedures, prescriptions, chart
  plans: ['view'], // a treatment plan
  prescriptions: ['print'], // the printable prescription (A5/A4)
  followups: [], // the follow-up list reception works
  invoices: ['new', 'view', 'print'], // print = the A4 invoice
  payments: ['print'], // the A5 receipt
  discounts: [], // the owner's approval queue and role limits
  expenses: [], // expenses, the owner's approval queue, categories and the reception limit
  cash: [], // the branch's cash day: open, expected cash, count and close; history
  reports: [], // revenue, expenses, attendance, performance, balances (`?tab=`), each printable
};

/**
 * `#/invite/<token>`: the link in a staff invitation email. Not a dashboard page — it opens without a session —
 * so it is parsed on its own. Returns the token, or null for any other hash.
 */
export function invitationToken(hash: string): string | null {
  const m = /^#\/invite\/([A-Za-z0-9_-]{32,64})$/.exec(hash);
  return m ? m[1] : null;
}
const isPage = (s: string): s is Page => s in ACTIONS;
const NOT_FOUND: Route = { page: 'not-found' };

export function parseRoute(hash: string): Route {
  const [path, search] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(search ?? ''));
  const withQuery = (r: Route): Route => (Object.keys(query).length ? { ...r, query } : r);
  if (parts.length === 0) return { page: 'overview' };
  const [page, second, third] = parts;
  if (!isPage(page)) return NOT_FOUND;
  if (parts.length === 1) return withQuery({ page });
  if (parts.length === 2) return second === 'new' && ACTIONS[page].includes('new') ? withQuery({ page, action: 'new' }) : NOT_FOUND;
  if (parts.length === 3 && third !== 'new' && ACTIONS[page].includes(third as Action)) return withQuery({ page, id: second, action: third as Exclude<Action, 'new'> });
  return NOT_FOUND;
}

export function href(route: Route): string {
  const q = route.query && Object.keys(route.query).length ? `?${new URLSearchParams(route.query)}` : '';
  if (route.page === 'not-found') return '#/';
  if (route.action === 'new') return `#/${route.page}/new${q}`;
  if (route.action) return `#/${route.page}/${route.id}/${route.action}${q}`;
  return `#/${route.page}${q}`;
}

/** Convenience builders so screens never spell a path by hand. */
export const to = {
  list: (page: Page): Route => ({ page }),
  create: (page: Page, query?: Record<string, string>): Route => (query ? { page, action: 'new', query } : { page, action: 'new' }),
  edit: (page: Page, id: string): Route => ({ page, id, action: 'edit' }),
  view: (page: Page, id: string): Route => ({ page, id, action: 'view' }),
  hours: (id: string): Route => ({ page: 'branches', id, action: 'hours' }),
  schedule: (id: string): Route => ({ page: 'doctors', id, action: 'schedule' }),
  timeOff: (id: string): Route => ({ page: 'doctors', id, action: 'timeoff' }),
  rooms: (id: string): Route => ({ page: 'branches', id, action: 'rooms' }),
  visit: (id: string): Route => ({ page: 'visits', id, action: 'view' }),
  plan: (id: string): Route => ({ page: 'plans', id, action: 'view' }),
  printPrescription: (id: string): Route => ({ page: 'prescriptions', id, action: 'print' }),
  invoice: (id: string): Route => ({ page: 'invoices', id, action: 'view' }),
  printInvoice: (id: string): Route => ({ page: 'invoices', id, action: 'print' }),
  printReceipt: (id: string): Route => ({ page: 'payments', id, action: 'print' }),
};
