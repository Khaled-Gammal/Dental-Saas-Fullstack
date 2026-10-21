import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { imageJson } from '../../media';

export interface DoctorInput {
  nameAr?: string | null;
  nameEn?: string | null;
  titleAr?: string | null;
  titleEn?: string | null;
  bioAr?: string | null;
  bioEn?: string | null;
  specialties?: string[];
  showOnWebsite?: boolean;
  acceptsOnlineBooking?: boolean;
  isActive?: boolean;
  photoFileId?: string | null;
}

export interface ScheduleRow { branch_id: string; weekday: number; starts_at: string; ends_at: string }

const columns = ['id', 'name_ar', 'name_en', 'title_ar', 'title_en', 'bio_ar', 'bio_en', 'specialties', 'show_on_website', 'accepts_online_booking', 'is_active', 'sort_order'] as const;
const photo = imageJson('doctors.photo_file_id');
/** Branches and weekly schedule as JSON on the row: one query for the list, no N+1. */
const branchesJson = sql<string[]>`coalesce((select json_agg(db.branch_id order by db.branch_id) from doctor_branches db where db.doctor_id = doctors.id), '[]'::json)`;
const scheduleJson = sql<ScheduleRow[]>`coalesce((
  select json_agg(json_build_object('branch_id', s.branch_id, 'weekday', s.weekday,
                  'starts_at', to_char(s.starts_at, 'HH24:MI'), 'ends_at', to_char(s.ends_at, 'HH24:MI')) order by s.weekday, s.starts_at)
  from doctor_schedules s where s.doctor_id = doctors.id), '[]'::json)`;

/** Plain Kysely queries; RLS scopes every one to the current clinic. */
@Injectable()
export class DoctorsRepository {
  /** Active doctors count against the plan's staff limit; a deactivated doctor frees the seat. */
  async countActive(tx: Tx): Promise<number> {
    const row = await tx.selectFrom('doctors').select(({ fn }) => fn.countAll<number>().as('n')).where('is_active', '=', true).executeTakeFirstOrThrow();
    return Number(row.n);
  }

  list(tx: Tx) {
    return tx.selectFrom('doctors').select([...columns, photo.as('photo'), branchesJson.as('branch_ids'), scheduleJson.as('schedule')])
      .orderBy('sort_order').orderBy('name_en').execute();
  }

  get(tx: Tx, id: string) {
    return tx.selectFrom('doctors').select([...columns, photo.as('photo'), branchesJson.as('branch_ids'), scheduleJson.as('schedule')])
      .where('id', '=', id).executeTakeFirst();
  }

  async lock(tx: Tx, id: string): Promise<{ is_active: boolean; photo_file_id: string | null } | undefined> {
    return tx.selectFrom('doctors').select(['is_active', 'photo_file_id']).where('id', '=', id).forUpdate().executeTakeFirst();
  }

  create(tx: Tx, tenantId: string, d: DoctorInput) {
    return tx.insertInto('doctors')
      .values({
        tenant_id: tenantId, name_ar: d.nameAr ?? null, name_en: d.nameEn ?? null, title_ar: d.titleAr ?? null, title_en: d.titleEn ?? null,
        bio_ar: d.bioAr ?? null, bio_en: d.bioEn ?? null, specialties: d.specialties ?? [],
        show_on_website: d.showOnWebsite ?? true, accepts_online_booking: d.acceptsOnlineBooking ?? true, photo_file_id: d.photoFileId ?? null,
      })
      .returning('id').executeTakeFirstOrThrow();
  }

  async update(tx: Tx, id: string, d: DoctorInput): Promise<boolean> {
    const set = {
      ...(d.nameAr !== undefined && { name_ar: d.nameAr }),
      ...(d.nameEn !== undefined && { name_en: d.nameEn }),
      ...(d.titleAr !== undefined && { title_ar: d.titleAr }),
      ...(d.titleEn !== undefined && { title_en: d.titleEn }),
      ...(d.bioAr !== undefined && { bio_ar: d.bioAr }),
      ...(d.bioEn !== undefined && { bio_en: d.bioEn }),
      ...(d.specialties !== undefined && { specialties: d.specialties }),
      ...(d.showOnWebsite !== undefined && { show_on_website: d.showOnWebsite }),
      ...(d.acceptsOnlineBooking !== undefined && { accepts_online_booking: d.acceptsOnlineBooking }),
      ...(d.isActive !== undefined && { is_active: d.isActive }),
      ...(d.photoFileId !== undefined && { photo_file_id: d.photoFileId }),
    };
    const row = await tx.updateTable('doctors').set({ ...set, updated_at: sql<Date>`now()` }).where('id', '=', id).returning('id').executeTakeFirst();
    return !!row;
  }

  /** Replaces where the doctor works. Schedule rows at a removed branch go with it (same transaction). */
  /** A new doctor performs every service on the price list (as a new service gets every active doctor). */
  async performAllServices(tx: Tx, tenantId: string, doctorId: string): Promise<void> {
    await tx.insertInto('doctor_services')
      .columns(['tenant_id', 'doctor_id', 'service_id'])
      .expression((eb) => eb.selectFrom('services').select([sql<string>`${tenantId}::uuid`.as('tenant_id'), sql<string>`${doctorId}::uuid`.as('doctor_id'), 'id'])
        .where('is_active', '=', true).where('deleted_at', 'is', null))
      .execute();
  }

  async replaceBranches(tx: Tx, tenantId: string, doctorId: string, branchIds: string[]): Promise<void> {
    await tx.deleteFrom('doctor_branches').where('doctor_id', '=', doctorId).execute();
    let drop = tx.deleteFrom('doctor_schedules').where('doctor_id', '=', doctorId);
    if (branchIds.length) drop = drop.where('branch_id', 'not in', branchIds);
    await drop.execute();
    if (branchIds.length) {
      await tx.insertInto('doctor_branches').values(branchIds.map((branch_id) => ({ tenant_id: tenantId, doctor_id: doctorId, branch_id }))).execute();
    }
  }

  /** Replaces the whole weekly schedule in the caller's transaction. */
  async replaceSchedule(tx: Tx, tenantId: string, doctorId: string, rows: ScheduleRow[]): Promise<void> {
    await tx.deleteFrom('doctor_schedules').where('doctor_id', '=', doctorId).execute();
    if (rows.length) {
      await tx.insertInto('doctor_schedules')
        .values(rows.map((r) => ({ tenant_id: tenantId, doctor_id: doctorId, branch_id: r.branch_id, weekday: r.weekday, starts_at: r.starts_at, ends_at: r.ends_at })))
        .execute();
    }
  }

  /** Branch ids that exist in this clinic, out of the ones given (RLS hides other clinics'). An inactive branch still counts: it keeps its doctors. */
  async existingBranchIds(tx: Tx, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await tx.selectFrom('branches').select('id').where('id', 'in', ids).execute();
    return new Set(rows.map((r) => r.id));
  }
}
