/**
 * Phase 2E: the patient's own page for their booking (`/appointment/<token>`, linked from the confirmation and reminder
 * emails). Shapes of the API's /public/appointment endpoints and the page's words.
 */
export interface ManageView {
  status: string; startsAt: string; endsAt: string; timezone: string;
  patientFirstName: string | null;
  clinic: { name: string | null; phone: string | null };
  doctor: string | null; service: string | null; branch: { name: string | null; address: string | null };
  changeUntil: string;
  cancel: { allowed: boolean; block: string | null };
  reschedule: { allowed: boolean; block: string | null; left: number };
  dates: { first: string; last: string };
}
export interface ManageSlots { date: string; timezone: string; durationMinutes: number; slots: { startsAt: string }[] }

/** A token as it appears in a link (the API checks the same shape). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The server-side read for the page; null when the link is not valid (or the clinic is gone), 'busy' when the visitor's
 * address made too many requests (shared clinic Wi-Fi): the page asks to try again instead of failing. Never cached.
 */
export async function getManageView(host: string, token: string, forwardedFor?: string | null): Promise<ManageView | null | 'busy'> {
  if (!TOKEN_RE.test(token)) return null;
  const res = await fetch(`${process.env.API_INTERNAL_URL}/public/appointment/view`, {
    method: 'POST', cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(forwardedFor && { 'x-forwarded-for': forwardedFor }) },
    body: JSON.stringify({ host, token }),
  });
  if (res.status === 404) return null;
  if (res.status === 429) return 'busy';
  if (!res.ok) throw new Error(`API ${res.status}`); // the error tracker never sees the link's key (lib/sentry-scrub)
  return res.json();
}

/** The booking's state in a few words (the badge on the page). */
export const STATUS_TEXT: Record<string, string> = {
  pending: 'بانتظار تأكيد العيادة', confirmed: 'مؤكد', cancelled: 'ملغى', checked_in: 'تم الحضور', in_progress: 'جارٍ الكشف',
  completed: 'تمت الزيارة', no_show: 'لم يتم الحضور',
};

/** Why the page offers no change, and what to do instead (the clinic's phone follows). */
export function blockText(block: string | null, what: 'cancel' | 'reschedule'): string | null {
  switch (block) {
    case null: return null;
    case 'too_late': return 'اقترب موعدك، ولم يعد ممكنًا تغييره أو إلغاؤه من هنا. اتصل بالعيادة.';
    case 'started': return 'بدأ وقت الموعد.';
    case 'not_active': return null; // the status says it (cancelled, attended…)
    case 'limit': return what === 'reschedule' ? 'غيّرت هذا الموعد أقصى عدد من المرات المسموح بها من الرابط. لتغييره مرة أخرى اتصل بالعيادة.' : null;
    case 'not_online': return what === 'reschedule' ? 'لتغيير هذا الموعد اتصل بالعيادة.' : null;
    default: return 'لا يمكن تغيير هذا الموعد من هنا. اتصل بالعيادة.';
  }
}

/** Messages for the problem codes the page can get back; anything else is a plain Arabic message. */
export const MANAGE_ERRORS: Record<string, string> = {
  manage_link_invalid: 'هذا الرابط غير صالح.',
  too_late_to_change: 'اقترب موعدك، ولم يعد ممكنًا تغييره أو إلغاؤه من هنا. اتصل بالعيادة.',
  appointment_not_active: 'لم يعد ممكنًا تغيير هذا الموعد.',
  reschedule_limit: 'غيّرت هذا الموعد أقصى عدد من المرات المسموح بها من الرابط. اتصل بالعيادة.',
  reschedule_not_online: 'لتغيير هذا الموعد اتصل بالعيادة.',
  slot_unavailable: 'هذا الوقت لم يعد متاحًا، اختر وقتًا آخر.',
  slot_taken: 'حُجز هذا الوقت للتو، اختر وقتًا آخر.',
  date_out_of_range: 'لا يمكن الحجز في هذا اليوم.',
  nothing_to_change: 'هذا هو موعدك الحالي.',
  rate_limited: 'طلبات كثيرة، انتظر قليلًا وحاول مرة أخرى.',
  validation: 'راجع البيانات المدخلة.',
  validation_failed: 'راجع البيانات المدخلة.',
  network: 'تعذر الاتصال، تحقق من الإنترنت وحاول مرة أخرى.',
  upstream_unavailable: 'الخدمة غير متاحة مؤقتًا، حاول بعد قليل.',
};

/** The days the new-time picker shows: from the first bookable day, at most three weeks, never past the last one. */
export function pickerDates(first: string, last: string, max = 21): string[] {
  const out: string[] = [];
  for (let d = first; d <= last && out.length < max; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return out;
}
