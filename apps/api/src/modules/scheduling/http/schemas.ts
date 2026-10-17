import { z } from 'zod';
import { E164Phone, OtpCode } from '../../../shared/validation/common';
import { ISO_DATE } from '../../../shared/time/clinic-time';

/** The clinic website's hostname (the Next.js proxy sends it); same normalisation as /public/site. */
export const Host = z.string().trim().toLowerCase().min(1).max(253).transform((h) => h.split(':')[0].replace(/\.$/, ''));
const Uuid = z.string().uuid();
const IsoDate = z.string().regex(ISO_DATE, 'YYYY-MM-DD');
/** An instant from the client; must be a real timestamp, not a wall-clock guess. */
const Instant = z.string().datetime({ offset: true }).transform((v) => new Date(v));
const Notes = z.string().trim().max(500).transform((v) => v || null);

export const SlotsQuery = z.object({ host: Host, branchId: Uuid, serviceId: Uuid, doctorId: Uuid.optional(), date: IsoDate }).strict();
export const HoldBody = z.object({ host: Host, branchId: Uuid, serviceId: Uuid, doctorId: Uuid.optional(), startsAt: Instant }).strict();
export const DetailsBody = z.object({
  host: Host,
  fullName: z.string().trim().min(2).max(120),
  phone: E164Phone,
  email: z.string().trim().toLowerCase().email().max(254), // the booking is verified and confirmed by email
  notes: Notes.optional(),
}).strict();
export const ConfirmBody = z.object({ host: Host, code: OtpCode }).strict();
export const HostQuery = z.object({ host: Host }).strict();
/** A body with only the hostname (the proxy adds it); sendBeacon may also send an empty text body. */
export const HostOnlyBody = z.object({ host: Host }).passthrough();
export const ArriveBody = z.object({ note: z.string().trim().min(3).max(300).optional() }).strict();

export const DayQuery = z.object({
  date: IsoDate, branchId: Uuid.optional(),
  /** only the signed-in doctor's own appointments (SRS APPT-004) */
  mine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
}).strict();
export const MoveBody = z.object({
  startsAt: Instant.optional(), doctorId: Uuid.optional(), branchId: Uuid.optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  roomId: Uuid.nullable().optional(),
  overrideReason: z.string().trim().min(3).max(200).optional(),
}).strict();
export const StaffBookingBody = z.object({
  patientId: Uuid, branchId: Uuid, doctorId: Uuid, serviceId: Uuid.nullable().optional(), startsAt: Instant,
  durationMinutes: z.number().int().min(5).max(480).optional(),
  source: z.enum(['dashboard', 'phone', 'walk_in', 'whatsapp']).default('dashboard'),
  notes: Notes.optional(), overrideReason: z.string().trim().min(3).max(200).optional(),
}).strict();
export const StaffSlotsQuery = z.object({
  branchId: Uuid, doctorId: Uuid, serviceId: Uuid.optional(), date: IsoDate, durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  /** the appointment being moved: its own time counts as free */
  excludeAppointmentId: Uuid.optional(),
}).strict();
export const CheckInBody = z.object({ code: OtpCode, branchId: Uuid, method: z.enum(['code', 'qr']).optional() }).strict();
export const CancelBody = z.object({ reason: z.string().trim().max(200).optional() }).strict();
