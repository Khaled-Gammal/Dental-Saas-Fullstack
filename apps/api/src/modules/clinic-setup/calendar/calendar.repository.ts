import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

/** A booking that a new closed day or time off would fall on: listed for reception, never changed automatically. */
export interface Conflict {
  id: string; starts_at: Date; status: string; branch_id: string;
  patient: { id: string; full_name: string; phone: string } | null;
  doctor: { name_ar: string | null; name_en: string | null };
}

const conflictColumns = [
  'a.id', 'a.starts_at', 'a.status', 'a.branch_id',
  sql<Conflict['patient']>`case when p.id is null then null else json_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) end`.as('patient'),
  sql<Conflict['doctor']>`json_build_object('name_ar', d.name_ar, 'name_en', d.name_en)`.as('doctor'),
] as const;

const OPEN = ['pending', 'confirmed'];

/** SQL for the clinic calendar: holidays, doctors' time off, rooms, and the booking rules (tenant_settings). */
@Injectable()
export class CalendarRepository {
  // ------------------------------------------------------------- holidays

  holidays(tx: Tx, from: string) {
    return tx.selectFrom('holidays').select(['id', 'branch_id', sql<string>`to_char(date, 'YYYY-MM-DD')`.as('date'), 'name'])
      .where(sql<boolean>`date >= ${from}::date`).orderBy('date').orderBy('branch_id').limit(200).execute();
  }

  insertHoliday(tx: Tx, h: { tenantId: string; branchId: string | null; date: string; name: string; createdBy: string | null }) {
    return tx.insertInto('holidays').values({ tenant_id: h.tenantId, branch_id: h.branchId, date: h.date, name: h.name, created_by: h.createdBy })
      .returning(['id', 'branch_id', sql<string>`to_char(date, 'YYYY-MM-DD')`.as('date'), 'name']).executeTakeFirstOrThrow();
  }

  async deleteHoliday(tx: Tx, id: string): Promise<boolean> {
    return !!(await tx.deleteFrom('holidays').where('id', '=', id).returning('id').executeTakeFirst());
  }

  /** Open bookings on that calendar day in the branch's zone (one branch, or every branch). */
  holidayConflicts(tx: Tx, date: string, branchId: string | null): Promise<Conflict[]> {
    let q = tx.selectFrom('appointments as a')
      .innerJoin('branches as b', 'b.id', 'a.branch_id').innerJoin('tenants as t', 't.id', 'a.tenant_id')
      .innerJoin('doctors as d', 'd.id', 'a.doctor_id').leftJoin('patients as p', 'p.id', 'a.patient_id')
      .select(conflictColumns)
      .where('a.status', 'in', OPEN)
      .where(sql<boolean>`(a.starts_at at time zone coalesce(b.timezone, t.timezone))::date = ${date}::date`);
    if (branchId) q = q.where('a.branch_id', '=', branchId);
    return q.orderBy('a.starts_at').execute() as Promise<Conflict[]>;
  }

  // ------------------------------------------------------------- doctor time off

  timeOff(tx: Tx, doctorId: string) {
    return tx.selectFrom('doctor_time_off').select(['id', 'starts_at', 'ends_at', 'reason'])
      .where('doctor_id', '=', doctorId).where('ends_at', '>', sql<Date>`now()`).orderBy('starts_at').execute();
  }

  insertTimeOff(tx: Tx, t: { tenantId: string; doctorId: string; startsAt: Date; endsAt: Date; reason: string | null; createdBy: string | null }) {
    return tx.insertInto('doctor_time_off').values({
      tenant_id: t.tenantId, doctor_id: t.doctorId, starts_at: t.startsAt, ends_at: t.endsAt, reason: t.reason, created_by: t.createdBy,
    }).returning(['id', 'starts_at', 'ends_at', 'reason']).executeTakeFirstOrThrow();
  }

  async deleteTimeOff(tx: Tx, doctorId: string, id: string): Promise<boolean> {
    return !!(await tx.deleteFrom('doctor_time_off').where('id', '=', id).where('doctor_id', '=', doctorId).returning('id').executeTakeFirst());
  }

  timeOffConflicts(tx: Tx, doctorId: string, from: Date, to: Date): Promise<Conflict[]> {
    return tx.selectFrom('appointments as a')
      .innerJoin('doctors as d', 'd.id', 'a.doctor_id').leftJoin('patients as p', 'p.id', 'a.patient_id')
      .select(conflictColumns)
      .where('a.doctor_id', '=', doctorId).where('a.status', 'in', OPEN).where('a.starts_at', '<', to).where('a.ends_at', '>', from)
      .orderBy('a.starts_at').execute() as Promise<Conflict[]>;
  }

  async doctorExists(tx: Tx, id: string): Promise<boolean> {
    return !!(await tx.selectFrom('doctors').select('id').where('id', '=', id).executeTakeFirst());
  }

  async branchExists(tx: Tx, id: string): Promise<boolean> {
    return !!(await tx.selectFrom('branches').select('id').where('id', '=', id).executeTakeFirst());
  }

  // ------------------------------------------------------------- rooms

  rooms(tx: Tx, branchId: string) {
    return tx.selectFrom('rooms').select(['id', 'branch_id', 'name', 'is_active']).where('branch_id', '=', branchId).orderBy('name').execute();
  }

  insertRoom(tx: Tx, r: { tenantId: string; branchId: string; name: string }) {
    return tx.insertInto('rooms').values({ tenant_id: r.tenantId, branch_id: r.branchId, name: r.name })
      .returning(['id', 'branch_id', 'name', 'is_active']).executeTakeFirstOrThrow();
  }

  updateRoom(tx: Tx, id: string, p: { name?: string; is_active?: boolean }) {
    return tx.updateTable('rooms').set(p).where('id', '=', id).returning(['id', 'branch_id', 'name', 'is_active']).executeTakeFirst();
  }

  // ------------------------------------------------------------- booking rules

  bookingSettings(tx: Tx) {
    return tx.selectFrom('tenant_settings').select([
      'booking_auto_confirm', 'booking_otp_required', 'booking_min_notice_minutes', 'booking_max_days_ahead', 'booking_slot_step_minutes',
      'booking_cancel_window_hours', 'reminder_offsets_minutes',
    ]).executeTakeFirstOrThrow();
  }

  async updateBookingSettings(tx: Tx, p: Record<string, unknown>): Promise<void> {
    if (Object.keys(p).length) await tx.updateTable('tenant_settings').set(p).execute();
  }
}
