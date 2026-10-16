/** The appointment lifecycle (SRS 4.10). Mirrors the `appointments_transition` trigger, which stays the last guard. */
export const APPOINTMENT_STATUSES = ['held', 'expired', 'pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  held: ['expired', 'pending', 'confirmed', 'cancelled'],
  expired: [],
  pending: ['confirmed', 'checked_in', 'cancelled', 'no_show'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const canTransition = (from: AppointmentStatus, to: AppointmentStatus): boolean => TRANSITIONS[from].includes(to);

/** Completed, cancelled, no-show and expired never change again; a change after that is a new appointment. */
export const isFinal = (s: AppointmentStatus): boolean => TRANSITIONS[s].length === 0;

/** Statuses that keep a doctor's time busy (the DB exclusion constraint uses the same set). */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = ['held', 'pending', 'confirmed', 'checked_in', 'in_progress', 'completed'];

/** What a staff action means in status terms; `cancel` and `noShow` also record who/why in the use case. */
export type StaffAction = 'confirm' | 'start' | 'complete' | 'cancel' | 'noShow';
export const ACTION_TARGET: Record<StaffAction, AppointmentStatus> = {
  confirm: 'confirmed', start: 'in_progress', complete: 'completed', cancel: 'cancelled', noShow: 'no_show',
};
