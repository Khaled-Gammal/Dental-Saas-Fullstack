/**
 * The platform admin panel (H5) on the dashboard: its routes (`#/platform…`), its API calls and small pure helpers.
 * The panel has its own session — an httpOnly cookie the API sets for /platform — so it never touches the clinic
 * session or its token. Pure parts are unit-tested.
 */
import { ApiError } from './api';
import { API_URL } from './config';

export type PlatformRoute =
  | { page: 'clinics' }
  | { page: 'clinic'; id: string }
  | { page: 'plans' }
  | { page: 'activity' }
  | { page: 'legal' }
  | { page: 'leads' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `#/platform`, `#/platform/clinics/<id>`, `#/platform/plans`, `#/platform/activity`; null for any other hash. */
export function parsePlatformRoute(hash: string): PlatformRoute | null {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  if (parts[0] !== 'platform') return null;
  if (parts.length === 1 || (parts[1] === 'clinics' && parts.length === 2)) return { page: 'clinics' };
  if (parts[1] === 'clinics' && parts.length === 3 && UUID.test(parts[2])) return { page: 'clinic', id: parts[2] };
  if (parts[1] === 'plans' && parts.length === 2) return { page: 'plans' };
  if (parts[1] === 'activity' && parts.length === 2) return { page: 'activity' };
  if (parts[1] === 'legal' && parts.length === 2) return { page: 'legal' };
  if (parts[1] === 'leads' && parts.length === 2) return { page: 'leads' };
  return { page: 'clinics' };
}

export const platformHref = (r: PlatformRoute) =>
  r.page === 'clinic' ? `#/platform/clinics/${r.id}` : r.page === 'clinics' ? '#/platform' : `#/platform/${r.page}`;

/** A /platform request with the platform cookie (never the clinic token). */
export async function papi<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init.headers } });
  } catch {
    throw new ApiError(0, 'network', 'Network error');
  }
  if (!res.ok) {
    const p = await res.json().catch(() => ({}));
    throw new ApiError(res.status, p.code ?? 'error', p.detail ?? p.title ?? res.statusText, p.errors, p);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** A clinic's trial: days left (negative = ended), or null when it is not on a trial. */
export function trialDaysLeft(trialEndsAt: string | null, subscriptionStatus: string | null, now = Date.now()): number | null {
  if (!trialEndsAt || subscriptionStatus !== 'trialing') return null;
  return Math.ceil((new Date(trialEndsAt).getTime() - now) / 86_400_000);
}

/** Search by name, subdomain or owner email; filter by clinic status ('all' = any). */
export function filterClinics<T extends { slug: string; name_ar: string | null; name_en: string | null; owner_email: string | null; status: string }>(
  clinics: readonly T[], q: string, status: string,
): T[] {
  const needle = q.trim().toLowerCase();
  return clinics.filter((c) => (status === 'all' || c.status === status)
    && (!needle || [c.slug, c.name_ar, c.name_en, c.owner_email].some((v) => v?.toLowerCase().includes(needle))));
}

/** H7: a request from the landing page's contact form moves new → contacted → converted or lost. */
export const LEAD_STATUSES = ['new', 'contacted', 'converted', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Search by name, clinic, city, phone or email; filter by status ('all' = any). Digits are matched whatever their script. */
export function filterLeads<T extends { full_name: string; clinic_name: string | null; city: string | null; phone: string; email: string | null; status: string }>(
  leads: readonly T[], q: string, status: string,
): T[] {
  const needle = q.trim().toLowerCase().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const digits = needle.replace(/\D/g, '');
  return leads.filter((l) => (status === 'all' || l.status === status)
    && (!needle
      || [l.full_name, l.clinic_name, l.city, l.email].some((v) => v?.toLowerCase().includes(needle))
      || (digits.length >= 3 && (l.phone.includes(digits) || l.phone.replace(/^\+20/, '0').includes(digits)))));
}
