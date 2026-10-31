import type { AppointmentStatus } from './appointment-status';

/**
 * Phase 2E: what a patient may do from their link. Both cancelling and moving close `cancelWindowHours` before the
 * visit (the clinic's booking rule; 0 = until it starts); a booking is moved from the link at most
 * MAX_PATIENT_RESCHEDULES times, then only cancelled. Pure, unit-tested.
 */
export const MAX_PATIENT_RESCHEDULES = 2;

/** Why a change is not allowed (the page explains each one and gives the clinic's phone). */
export type SelfServiceBlock = 'not_active' | 'started' | 'too_late';
export type RescheduleBlock = SelfServiceBlock | 'limit' | 'not_online';

export interface SelfServiceState {
  status: AppointmentStatus; startsAt: Date; patientReschedules: number;
  /** the doctor still takes website bookings (the patient picks from the website's times) */
  onlineDoctor: boolean;
}

/** The last moment a patient may cancel or move from the link. */
export const changeDeadline = (startsAt: Date, cancelWindowHours: number): Date => new Date(startsAt.getTime() - Math.max(0, cancelWindowHours) * 3_600_000);

export function cancelBlock(s: SelfServiceState, now: number, cancelWindowHours: number): SelfServiceBlock | null {
  if (s.status !== 'pending' && s.status !== 'confirmed') return 'not_active';
  if (s.startsAt.getTime() <= now) return 'started';
  if (now > changeDeadline(s.startsAt, cancelWindowHours).getTime()) return 'too_late';
  return null;
}

export function rescheduleBlock(s: SelfServiceState, now: number, cancelWindowHours: number): RescheduleBlock | null {
  const base = cancelBlock(s, now, cancelWindowHours);
  if (base) return base;
  if (s.patientReschedules >= MAX_PATIENT_RESCHEDULES) return 'limit';
  if (!s.onlineDoctor) return 'not_online';
  return null;
}

/**
 * The status after the patient moves the booking: the clinic confirmed the old time, not the new one, so a clinic that
 * confirms website bookings by hand confirms it again; with automatic confirmation it stays (or becomes) confirmed.
 */
export const statusAfterMove = (current: 'pending' | 'confirmed', autoConfirm: boolean): 'pending' | 'confirmed' =>
  autoConfirm ? 'confirmed' : current === 'confirmed' ? 'pending' : current;
