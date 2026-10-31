import { SITE_REVALIDATE_S } from './site';

/** Shapes of the public booking endpoints (apps/api/src/modules/scheduling/http). */
export interface BookingBranch { id: string; name_ar: string | null; name_en: string | null; address_ar: string | null; address_en: string | null; city: string | null; timezone: string | null }
export interface BookingService { id: string; name_ar: string | null; name_en: string | null; price_minor: number; price_max_minor: number | null; duration_minutes: number }
export interface BookingDoctor { id: string; name_ar: string | null; name_en: string | null; title_ar: string | null; title_en: string | null; branch_ids: string[]; service_ids: string[] }
export interface BookingOptions {
  branches: BookingBranch[];
  services: BookingService[];
  doctors: BookingDoctor[];
  policy: { otpRequired: boolean; minNoticeMinutes: number; maxDaysAhead: number; slotStepMinutes: number; timezone: string };
  dates: { first: string; last: string };
}
export interface Slot { startsAt: string; doctorIds: string[] }
export interface SlotsResponse { date: string; timezone: string; durationMinutes: number; slots: Slot[] }
export interface Hold {
  holdId: string; doctorId: string; startsAt: string; endsAt: string; expiresAt: string; otpRequired: boolean;
  /** seconds the hold lasts from the moment the API answered (an older API may not send it) */
  ttlSeconds?: number;
  /** set by the wizard on receipt: the deadline on this device's own clock */
  deadline?: number;
}
export interface BookingSummary {
  appointmentId: string; status: 'pending' | 'confirmed'; startsAt: string; endsAt: string; timezone: string; code: string;
  appointment: { doctor: { name_ar: string | null; name_en: string | null }; service: { name_ar: string | null; name_en: string | null } | null; branch_id: string };
}
export type DetailsOutcome = { status: 'otp_required'; maskedEmail: string } | { status: 'booked'; booking: BookingSummary };

/**
 * Server-side read of the wizard's starting data. Cached like the site itself (60 s, purged with the site's tag on a
 * catalogue change): it holds no availability, only branches, services, doctors and rules. Slots are always live.
 */
export async function getBookingOptions(host: string): Promise<BookingOptions | null> {
  const res = await fetch(`${process.env.API_INTERNAL_URL}/public/booking/options?host=${encodeURIComponent(host)}`, {
    next: { revalidate: SITE_REVALIDATE_S, tags: [`site:${host}`] },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

/** Today's date (YYYY-MM-DD) in an IANA zone; an unknown zone falls back to Cairo, like the API does. */
export function todayIn(tz: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  }
}

/** Messages for the problem codes the wizard can get back; anything else shows the server's own text. */
export const BOOKING_ERRORS: Record<string, string> = {
  slot_unavailable: 'هذا الوقت لم يعد متاحًا، اختر وقتًا آخر.',
  slot_taken: 'حُجز هذا الوقت للتو، اختر وقتًا آخر.',
  hold_expired: 'انتهت مهلة الحجز المؤقت، اختر الوقت من جديد.',
  booking_refused: 'لا يمكن إتمام الحجز عبر الموقع. يُرجى الاتصال بالعيادة لحجز موعدك.',
  otp_invalid: 'الرمز غير صحيح.',
  otp_expired: 'انتهت صلاحية الرمز، اطلب رمزًا جديدًا.',
  otp_locked: 'محاولات كثيرة خاطئة، اطلب رمزًا جديدًا.',
  otp_used: 'استُخدم هذا الرمز بالفعل.',
  otp_rate_limited: 'طلبت رموزًا كثيرة، انتظر بضع دقائق.',
  rate_limited: 'طلبات كثيرة، انتظر قليلًا وحاول مرة أخرى.',
  date_out_of_range: 'لا يمكن الحجز في هذا اليوم.',
  service_not_bookable: 'هذه الخدمة لا تُحجز عبر الموقع.',
  validation: 'راجع البيانات المدخلة.',
  network: 'تعذر الاتصال، تحقق من الإنترنت وحاول مرة أخرى.',
  upstream_unavailable: 'الحجز غير متاح مؤقتًا، حاول بعد قليل.',
};
