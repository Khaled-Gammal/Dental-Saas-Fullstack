import { Injectable } from '@nestjs/common';
import { sql } from '@dental/db';
import { Err } from '../../../shared/errors/app-error';
import type { BookingPolicy } from '../domain/booking-policy';
import type {
  AppointmentView, BookingOptions, BookingService, CheckInResult, DayContext, DayQuery, DoctorsQuery, FinalizeInput, HoldInput, HoldRow, MovePatch, MoveRow,
  SchedulingRepository, Session, StaffAppointmentInput, StatusPatch, TransitionRow,
} from '../application/ports';

const isPgError = (e: unknown, code: string) => (e as { code?: string })?.code === code;

/** The appointment columns the dashboard sees; names are joined in as JSON so a day is one query. */
const VIEW_COLUMNS = [
  'a.id', 'a.status', 'a.source', 'a.starts_at', 'a.ends_at', 'a.branch_id', 'a.doctor_id', 'a.service_id', 'a.room_id', 'a.payment_mode',
  'a.quoted_price_minor', 'a.patient_notes', 'a.internal_notes', 'a.cancel_reason', 'a.confirmed_at', 'a.checked_in_at', 'a.completed_at', 'a.cancelled_at', 'a.created_at',
] as const;
/** the clinical visit opened on this appointment, if any (VISIT-001: reception sees that it exists) */
const visitId = sql<string | null>`(select v.id from visits v where v.appointment_id = a.id)`;
const hasCode = sql<boolean>`(a.check_in_code_hash is not null and a.check_in_code_used_at is null)`;
const patientJson = sql<AppointmentView['patient']>`case when p.id is null then null else json_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'file_no', p.file_no) end`;
const doctorJson = sql<AppointmentView['doctor']>`json_build_object('name_ar', d.name_ar, 'name_en', d.name_en)`;
const roomJson = sql<AppointmentView['room']>`case when r.id is null then null else json_build_object('id', r.id, 'name', r.name) end`;
const serviceJson = sql<AppointmentView['service']>`case when s.id is null then null else json_build_object('name_ar', s.name_ar, 'name_en', s.name_en, 'duration_minutes', s.duration_minutes) end`;

/** Kysely adapter for the scheduling port. Every query runs under the clinic's RLS context (`tx`). */
@Injectable()
export class KyselySchedulingRepository implements SchedulingRepository {
  /** The website visitor confirming their booking: the clinic's context, audited as the patient's act. */
  async enterTenant(tx: Session, tenantId: string): Promise<void> {
    await sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.actor_type', 'patient', true)`.execute(tx);
  }

  async policy(tx: Session): Promise<BookingPolicy> {
    const r = await tx.selectFrom('tenant_settings as s').innerJoin('tenants as t', 't.id', 's.tenant_id')
      .select(['t.timezone', 's.booking_auto_confirm', 's.booking_otp_required', 's.booking_min_notice_minutes', 's.booking_max_days_ahead', 's.booking_slot_step_minutes', 's.booking_payment_mode'])
      .executeTakeFirst();
    if (!r) throw Err.notFound('site_not_found', 'No clinic at this address');
    return {
      timezone: r.timezone, autoConfirm: r.booking_auto_confirm, otpRequired: r.booking_otp_required, minNoticeMinutes: r.booking_min_notice_minutes,
      maxDaysAhead: r.booking_max_days_ahead, slotStepMinutes: r.booking_slot_step_minutes, paymentMode: r.booking_payment_mode as BookingPolicy['paymentMode'],
    };
  }

  async options(tx: Session): Promise<BookingOptions> {
    const branches = await tx.selectFrom('branches').select(['id', 'name_ar', 'name_en', 'address_ar', 'address_en', 'city', 'timezone'])
      .where('is_active', '=', true).orderBy('is_main', 'desc').orderBy('sort_order').orderBy('name_en').execute();
    const services = await tx.selectFrom('services').select(['id', 'name_ar', 'name_en', 'price_minor', 'price_max_minor', 'duration_minutes', 'bookable_online'])
      .where('is_active', '=', true).where('show_on_website', '=', true).where('bookable_online', '=', true).orderBy('sort_order').orderBy('name_en').execute();
    const doctors = await tx.selectFrom('doctors').select([
      'id', 'name_ar', 'name_en', 'title_ar', 'title_en',
      sql<string[]>`coalesce((select json_agg(db.branch_id) from doctor_branches db where db.doctor_id = doctors.id), '[]'::json)`.as('branch_ids'),
      sql<string[]>`coalesce((select json_agg(ds.service_id) from doctor_services ds where ds.doctor_id = doctors.id), '[]'::json)`.as('service_ids'),
    ]).where('is_active', '=', true).where('accepts_online_booking', '=', true).orderBy('sort_order').orderBy('name_en').execute();
    return {
      branches,
      services: services.map((s) => ({ ...s, price_minor: Number(s.price_minor), price_max_minor: s.price_max_minor === null ? null : Number(s.price_max_minor) })),
      doctors,
    };
  }

  async service(tx: Session, id: string): Promise<BookingService | undefined> {
    const s = await tx.selectFrom('services').select(['id', 'name_ar', 'name_en', 'price_minor', 'price_max_minor', 'duration_minutes', 'bookable_online'])
      .where('id', '=', id).where('is_active', '=', true).executeTakeFirst();
    return s && { ...s, price_minor: Number(s.price_minor), price_max_minor: s.price_max_minor === null ? null : Number(s.price_max_minor) };
  }

  async branchTimezone(tx: Session, branchId: string): Promise<string | null | undefined> {
    const b = await tx.selectFrom('branches').select('timezone').where('id', '=', branchId).where('is_active', '=', true).executeTakeFirst();
    return b?.timezone; // undefined = no such active branch here
  }

  async doctorsFor(tx: Session, q: DoctorsQuery): Promise<string[]> {
    let query = tx.selectFrom('doctors as d').innerJoin('doctor_branches as db', (j) => j.onRef('db.doctor_id', '=', 'd.id').on('db.branch_id', '=', q.branchId))
      .select('d.id').where('d.is_active', '=', true);
    if (q.serviceId) query = query.innerJoin('doctor_services as ds', (j) => j.onRef('ds.doctor_id', '=', 'd.id').on('ds.service_id', '=', q.serviceId));
    if (q.online) query = query.where('d.accepts_online_booking', '=', true);
    if (q.doctorId) query = query.where('d.id', '=', q.doctorId);
    return (await query.orderBy('d.sort_order').orderBy('d.name_en').execute()).map((r) => r.id);
  }

  async branchAllowed(tx: Session, branchId: string): Promise<boolean> {
    const { rows } = await sql<{ ok: boolean }>`select branch_allowed(${branchId}::uuid) as ok`.execute(tx);
    return rows[0]?.ok === true;
  }

  async doctorAtBranch(tx: Session, doctorId: string, branchId: string): Promise<'ok' | 'not_found' | 'inactive' | 'not_at_branch'> {
    const d = await tx.selectFrom('doctors as d')
      .leftJoin('doctor_branches as db', (j) => j.onRef('db.doctor_id', '=', 'd.id').on('db.branch_id', '=', branchId))
      .select(['d.is_active', 'db.branch_id']).where('d.id', '=', doctorId).executeTakeFirst();
    if (!d) return 'not_found';
    if (!d.is_active) return 'inactive';
    return d.branch_id ? 'ok' : 'not_at_branch';
  }

  async dayContext(tx: Session, q: DayQuery): Promise<DayContext> {
    const holiday = await tx.selectFrom('holidays').select('id')
      .where(sql<boolean>`date = ${q.date}::date`).where((eb) => eb.or([eb('branch_id', 'is', null), eb('branch_id', '=', q.branchId)]))
      .executeTakeFirst();
    const branchHours = await tx.selectFrom('branch_hours').select(['opens_at', 'closes_at']).where('branch_id', '=', q.branchId).where('weekday', '=', q.weekday).execute();
    const shifts = await tx.selectFrom('doctor_schedules').select(['doctor_id', 'starts_at', 'ends_at'])
      .where('branch_id', '=', q.branchId).where('weekday', '=', q.weekday).where('doctor_id', 'in', q.doctorIds).execute();
    // appointments that keep the doctor busy anywhere (not only at this branch), live holds included; stale holds do not
    // block. Read through doctor_busy_intervals(): a branch-limited receptionist cannot read other branches' bookings,
    // but the doctor is still busy there. The function returns times only, for this clinic, the same statuses as
    // BLOCKING_STATUSES.
    const { rows: appointments } = await sql<{ doctor_id: string; starts_at: Date; ends_at: Date }>`
      select doctor_id, starts_at, ends_at
      from doctor_busy_intervals(${sql.val(q.doctorIds)}::uuid[], ${q.from}, ${q.to}, ${q.excludeAppointmentId ?? null}::uuid)`.execute(tx);
    const timeOff = await tx.selectFrom('doctor_time_off').select(['doctor_id', 'starts_at', 'ends_at'])
      .where('doctor_id', 'in', q.doctorIds).where('starts_at', '<', q.to).where('ends_at', '>', q.from).execute();
    return { closed: !!holiday, branchHours, shifts, blocked: [...appointments, ...timeOff] };
  }

  async releaseExpiredHolds(tx: Session, doctorId: string): Promise<void> {
    await sql`select release_expired_holds(${doctorId})`.execute(tx);
  }

  insertHold(tx: Session, h: HoldInput): Promise<{ id: string }> {
    return tx.insertInto('appointments').values({
      tenant_id: h.tenantId, branch_id: h.branchId, doctor_id: h.doctorId, service_id: h.serviceId, starts_at: h.startsAt, ends_at: h.endsAt,
      status: 'held', hold_expires_at: h.holdExpiresAt, source: 'website', payment_mode: h.paymentMode, quoted_price_minor: h.quotedPriceMinor,
    }).returning('id').executeTakeFirstOrThrow();
  }

  async lockLiveHold(tx: Session, id: string): Promise<HoldRow | undefined> {
    const r = await tx.selectFrom('appointments').select(['id', 'branch_id', 'doctor_id', 'service_id', 'starts_at', 'ends_at', 'hold_expires_at'])
      .where('id', '=', id).where('status', '=', 'held').where('hold_expires_at', '>', sql<Date>`now()`).forUpdate().executeTakeFirst();
    return r && r.hold_expires_at ? { ...r, hold_expires_at: r.hold_expires_at } : undefined;
  }

  async finalizeHold(tx: Session, id: string, f: FinalizeInput): Promise<void> {
    await tx.updateTable('appointments').set({
      patient_id: f.patientId, status: f.status, confirmed_at: f.status === 'confirmed' ? sql<Date>`now()` : null, patient_notes: f.patientNotes,
      check_in_code_hash: f.codeHash, check_in_code_expires_at: f.codeExpiresAt,
    }).where('id', '=', id).where('status', '=', 'held').execute();
  }

  async addOutboxEvent(tx: Session, tenantId: string, type: string, payload: Record<string, unknown>): Promise<void> {
    await tx.insertInto('outbox_events').values({ tenant_id: tenantId, type, payload: JSON.stringify(payload) }).execute();
  }

  private view(tx: Session) {
    return tx.selectFrom('appointments as a')
      .leftJoin('patients as p', 'p.id', 'a.patient_id')
      .innerJoin('doctors as d', 'd.id', 'a.doctor_id')
      .leftJoin('services as s', 's.id', 'a.service_id')
      .leftJoin('rooms as r', 'r.id', 'a.room_id')
      .select([...VIEW_COLUMNS, patientJson.as('patient'), doctorJson.as('doctor'), serviceJson.as('service'), roomJson.as('room'), hasCode.as('has_code'), visitId.as('visit_id')]);
  }

  private static toView(r: Awaited<ReturnType<ReturnType<KyselySchedulingRepository['view']>['execute']>>[number]): AppointmentView {
    return { ...r, status: r.status as AppointmentView['status'], quoted_price_minor: r.quoted_price_minor === null ? null : Number(r.quoted_price_minor) };
  }

  async listBetween(tx: Session, q: { from: Date; to: Date; branchId?: string; doctorId?: string }): Promise<AppointmentView[]> {
    let query = this.view(tx).where('a.starts_at', '>=', q.from).where('a.starts_at', '<', q.to).where('a.status', '<>', 'expired');
    if (q.branchId) query = query.where('a.branch_id', '=', q.branchId);
    if (q.doctorId) query = query.where('a.doctor_id', '=', q.doctorId);
    return (await query.orderBy('a.starts_at').execute()).map(KyselySchedulingRepository.toView);
  }

  async doctorOfMember(tx: Session, memberId: string): Promise<string | null> {
    return (await tx.selectFrom('doctors').select('id').where('member_id', '=', memberId).executeTakeFirst())?.id ?? null;
  }

  async lockForMove(tx: Session, id: string): Promise<MoveRow | undefined> {
    const r = await tx.selectFrom('appointments as a').leftJoin('patients as p', 'p.id', 'a.patient_id')
      .select(['a.id', 'a.status', 'a.branch_id', 'a.doctor_id', 'a.service_id', 'a.room_id', 'a.starts_at', 'a.ends_at', 'a.source', hasCode.as('has_code'),
        sql<string | null>`p.email::text`.as('patient_email')])
      .where('a.id', '=', id).forUpdate('a').executeTakeFirst();
    return r && { ...r, status: r.status as MoveRow['status'] };
  }

  async move(tx: Session, id: string, p: MovePatch): Promise<void> {
    await tx.updateTable('appointments').set({
      starts_at: p.startsAt, ends_at: p.endsAt, doctor_id: p.doctorId, branch_id: p.branchId, room_id: p.roomId, override_reason: p.overrideReason,
      ...(p.code === null && { check_in_code_hash: null, check_in_code_expires_at: null }),
      ...(p.code && { check_in_code_hash: p.code.hash, check_in_code_expires_at: p.code.expiresAt }),
    }).where('id', '=', id).execute();
  }

  async setRoom(tx: Session, id: string, roomId: string | null): Promise<void> {
    await tx.updateTable('appointments').set({ room_id: roomId }).where('id', '=', id).execute();
  }

  async roomInBranch(tx: Session, roomId: string, branchId: string): Promise<boolean> {
    return !!(await tx.selectFrom('rooms').select('id').where('id', '=', roomId).where('branch_id', '=', branchId).where('is_active', '=', true).executeTakeFirst());
  }

  async get(tx: Session, id: string): Promise<AppointmentView | undefined> {
    const r = await this.view(tx).where('a.id', '=', id).executeTakeFirst();
    return r && KyselySchedulingRepository.toView(r);
  }

  async lockForTransition(tx: Session, id: string): Promise<TransitionRow | undefined> {
    const r = await tx.selectFrom('appointments as a').innerJoin('doctors as d', 'd.id', 'a.doctor_id')
      .select(['a.id', 'a.status', 'a.doctor_id', 'd.member_id as doctor_member_id', hasCode.as('has_code')]).where('a.id', '=', id).forUpdate('a').executeTakeFirst();
    return r && { ...r, status: r.status as TransitionRow['status'] };
  }

  async setStatus(tx: Session, id: string, p: StatusPatch): Promise<void> {
    await tx.updateTable('appointments').set({
      status: p.status,
      ...(p.confirmedAt && { confirmed_at: p.confirmedAt }),
      ...(p.completedAt && { completed_at: p.completedAt }),
      ...(p.cancelledAt && { cancelled_at: p.cancelledAt, cancel_reason: p.cancelReason ?? null, cancelled_by: p.cancelledBy ?? 'clinic' }),
    }).where('id', '=', id).execute();
  }

  async arriveManually(tx: Session, id: string, a: { memberId: string; note: string }): Promise<void> {
    // a manual check-in never consumes the code (the CHECK allows used_at only for code/qr), so the code is cleared instead
    await tx.updateTable('appointments').set({
      status: 'checked_in', checked_in_at: sql<Date>`now()`, check_in_method: 'manual', check_in_note: a.note, checked_in_by: a.memberId,
      check_in_code_hash: null, check_in_code_expires_at: null,
    }).where('id', '=', id).where('status', 'in', ['pending', 'confirmed']).execute();
  }

  async codeInUse(tx: Session, codeHash: string): Promise<boolean> {
    return !!(await tx.selectFrom('appointments').select('id').where('check_in_code_hash', '=', codeHash).where('check_in_code_used_at', 'is', null).executeTakeFirst());
  }

  async releaseHold(tx: Session, id: string): Promise<boolean> {
    const r = await tx.updateTable('appointments').set({ status: 'expired', hold_expires_at: sql<Date>`now()` })
      .where('id', '=', id).where('status', '=', 'held').returning('id').executeTakeFirst();
    return !!r;
  }

  insertStaffAppointment(tx: Session, a: StaffAppointmentInput): Promise<{ id: string }> {
    return tx.insertInto('appointments').values({
      tenant_id: a.tenantId, branch_id: a.branchId, doctor_id: a.doctorId, service_id: a.serviceId, patient_id: a.patientId, starts_at: a.startsAt, ends_at: a.endsAt,
      status: a.status, confirmed_at: sql<Date>`now()`, source: a.source, booked_by: a.bookedBy, payment_mode: 'at_clinic', quoted_price_minor: a.quotedPriceMinor,
      internal_notes: a.internalNotes, override_reason: a.overrideReason,
    }).returning('id').executeTakeFirstOrThrow();
  }

  async checkInByCode(tx: Session, codeHash: string, branchId: string, memberId: string, method: 'code' | 'qr'): Promise<CheckInResult | undefined> {
    try {
      const { rows } = await sql<CheckInResult>`select * from check_in_by_code(${codeHash}, ${branchId}, ${memberId}, ${method})`.execute(tx);
      const r = rows[0];
      return r && { ...r, quoted_price_minor: r.quoted_price_minor === null ? null : Number(r.quoted_price_minor), paid_online_minor: Number(r.paid_online_minor), amount_due_minor: Number(r.amount_due_minor) };
    } catch (e) {
      if (isPgError(e, 'P0002')) return undefined; // no_data_found: wrong, used, expired, cancelled or another branch
      throw e;
    }
  }
}
