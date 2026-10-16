/**
 * Hash routes, one per screen: `#/doctors`, `#/doctors/new`, `#/doctors/<id>/edit`, `#/doctors/<id>/schedule`.
 * Pure parsing/building lives here (unit-tested); the React hook is in `hooks.ts`.
 */
export type Page = 'overview' | 'profile' | 'branches' | 'appointments' | 'patients' | 'doctors' | 'services' | 'gallery';
export type Action = 'new' | 'edit' | 'hours' | 'schedule' | 'view';

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
  branches: ['new', 'edit', 'hours'],
  appointments: ['new'],
  patients: ['new', 'edit', 'view'],
  gallery: ['new', 'edit'],
  doctors: ['new', 'edit', 'schedule'],
  services: ['new', 'edit'],
};
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
};
