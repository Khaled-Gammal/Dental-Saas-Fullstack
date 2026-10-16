import { addDays, dateInZone } from '../../../shared/time/clinic-time';

/** The clinic's booking rules (tenant_settings) plus its zone; read once per request. */
export interface BookingPolicy {
  timezone: string;
  autoConfirm: boolean;
  otpRequired: boolean;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  slotStepMinutes: number;
  paymentMode: 'at_clinic' | 'deposit' | 'full_online' | 'patient_choice';
}

/** A website slot is reserved for this long while the visitor verifies their phone (SRS BOOK-10). */
export const HOLD_MINUTES = 10;

/** Online payment is V1: every website booking is paid at the clinic for now, whatever the clinic configured. */
export const effectivePaymentMode = (_p: BookingPolicy): 'at_clinic' => 'at_clinic';

/** The calendar dates (clinic zone) a visitor may pick: today … today + maxDaysAhead. */
export function bookableDates(now: number, p: BookingPolicy): { first: string; last: string } {
  const first = dateInZone(now, p.timezone);
  return { first, last: addDays(first, p.maxDaysAhead) };
}

export type DateProblem = 'past' | 'too_far';

export function dateProblem(date: string, now: number, p: BookingPolicy): DateProblem | null {
  const { first, last } = bookableDates(now, p);
  if (date < first) return 'past';
  if (date > last) return 'too_far';
  return null;
}

/** Earliest instant a visitor may book: now plus the clinic's minimum notice. */
export const earliestStart = (now: number, p: BookingPolicy): number => now + p.minNoticeMinutes * 60_000;
