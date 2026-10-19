import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { escapeLike, NEEDS_REVIEW, type PatientSearch } from './patient-rules';

/** Columns a list row needs; the date of birth goes out as 'YYYY-MM-DD' (a JS Date would shift it across zones). */
const dob = sql<string | null>`to_char(p.date_of_birth, 'YYYY-MM-DD')`;
const LIST = ['p.id', 'p.file_no', 'p.full_name', 'p.phone', 'p.gender', 'p.tags', 'p.is_blocked', 'p.created_at'] as const;

export interface PatientRow {
  id: string; file_no: number; full_name: string; phone: string; gender: string | null; date_of_birth: string | null;
  tags: string[]; is_blocked: boolean; created_at: Date;
}

/** Writable patient columns (snake case, as stored). */
export interface PatientFields {
  full_name?: string; gender?: string | null; date_of_birth?: string | null; phone?: string; phone_alt?: string | null; email?: string | null;
  address?: string | null; city?: string | null; occupation?: string | null; referral_source?: string | null; preferred_branch_id?: string | null;
  preferred_locale?: 'ar' | 'en'; notes?: string | null; tags?: string[];
  guardian_name?: string | null; guardian_phone?: string | null; guardian_relation?: string | null; guardian_patient_id?: string | null;
  marketing_opt_in?: boolean;
  is_blocked?: boolean;
}

export interface MedicalHistory {
  allergies: string[]; conditions: string[]; medications: string[]; is_pregnant: boolean | null; is_smoker: boolean | null; notes: string | null; updated_at: Date | null;
}

const EMPTY_HISTORY: MedicalHistory = { allergies: [], conditions: [], medications: [], is_pregnant: null, is_smoker: null, notes: null, updated_at: null };
const toRow = <T extends { file_no: unknown }>(r: T) => ({ ...r, file_no: Number(r.file_no) });

/**
 * All SQL for patients. Every query names the clinic explicitly as well as relying on RLS, so the planner can use
 * the (tenant_id, …) indexes. Merged and deleted records are invisible here.
 */
@Injectable()
export class PatientsRepository {
  private base(tx: Tx, tenantId: string) {
    return tx.selectFrom('patients as p').where('p.tenant_id', '=', tenantId).where('p.deleted_at', 'is', null).where('p.merged_into_id', 'is', null);
  }

  /** Search: exact phone, phone prefix, file number or name (trigram-ranked). At most `limit` rows, best first. */
  async search(tx: Tx, tenantId: string, s: Exclude<PatientSearch, { kind: 'all' }>, limit: number): Promise<PatientRow[]> {
    let q = this.base(tx, tenantId).select([...LIST, dob.as('date_of_birth')]);
    switch (s.kind) {
      case 'phone':
        q = q.where((eb) => eb.or([eb('p.phone', '=', s.e164), eb('p.phone_alt', '=', s.e164), eb('p.guardian_phone', '=', s.e164)])).orderBy('p.full_name');
        break;
      case 'phonePrefix':
        q = q.where('p.phone', 'like', `${escapeLike(s.prefix)}%`).orderBy('p.phone');
        break;
      case 'fileOrPhone':
        q = q.where((eb) => eb.or([eb('p.file_no', '=', String(s.fileNo)), eb('p.phone', 'like', `${escapeLike(s.prefix)}%`)]))
          .orderBy(sql`p.file_no = ${s.fileNo}`, 'desc').orderBy('p.file_no');
        break;
      case 'name': {
        // On the normalised name (SRS PATIENT-001): "احمد" finds "أحمد", "فاطمه" finds "فاطمة". ILIKE catches partial words
        // ("أحم"), the % operator spelling variants; both use the trigram index on full_name_norm.
        const norm = sql<string>`ar_normalize(${s.text})`;
        q = q.where((eb) => eb.or([
          // escaped first: ar_normalize never touches \ % _, so the escaping survives it
          sql<boolean>`p.full_name_norm ilike '%' || ar_normalize(${escapeLike(s.text)}) || '%'`,
          sql<boolean>`p.full_name_norm % ${norm}`,
        ])).orderBy(sql`similarity(p.full_name_norm, ${norm})`, 'desc').orderBy('p.full_name');
        break;
      }
    }
    return (await q.limit(limit).execute()).map(toRow);
  }

  /** Newest first, keyset-paginated (SRS 8.6: every list uses keyset pagination). */
  async page(tx: Tx, tenantId: string, after: { createdAt: Date; id: string } | null, limit: number): Promise<PatientRow[]> {
    let q = this.base(tx, tenantId).select([...LIST, dob.as('date_of_birth')]);
    if (after) q = q.where(sql<boolean>`(p.created_at, p.id) < (${after.createdAt}, ${after.id})`);
    return (await q.orderBy('p.created_at', 'desc').orderBy('p.id', 'desc').limit(limit).execute()).map(toRow);
  }

  countActive(tx: Tx, tenantId: string): Promise<number> {
    return this.base(tx, tenantId).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow().then((r) => Number(r.n));
  }

  /** The full record for the profile, with the guardian's name when the guardian is also a patient. */
  async get(tx: Tx, tenantId: string, id: string) {
    const r = await this.base(tx, tenantId)
      .leftJoin('patients as g', 'g.id', 'p.guardian_patient_id')
      .select([
        ...LIST, dob.as('date_of_birth'), 'p.phone_alt', 'p.email', 'p.address', 'p.city', 'p.occupation', 'p.referral_source', 'p.preferred_branch_id',
        'p.preferred_locale', 'p.notes', 'p.guardian_name', 'p.guardian_phone', 'p.guardian_relation', 'p.guardian_patient_id', 'g.full_name as guardian_patient_name',
        'p.marketing_opt_in', 'p.marketing_opt_in_at', 'p.updated_at',
      ])
      .where('p.id', '=', id).executeTakeFirst();
    return r && toRow(r);
  }

  /** The writable fields, locked, for an update (the audit diff is computed against this). */
  async lock(tx: Tx, tenantId: string, id: string): Promise<(Required<PatientFields> & { marketing_opt_in_at: Date | null }) | undefined> {
    const r = await this.base(tx, tenantId).select([
      'p.full_name', 'p.gender', dob.as('date_of_birth'), 'p.phone', 'p.phone_alt', 'p.email', 'p.address', 'p.city', 'p.occupation', 'p.referral_source',
      'p.preferred_branch_id', 'p.preferred_locale', 'p.notes', 'p.tags', 'p.guardian_name', 'p.guardian_phone', 'p.guardian_relation', 'p.guardian_patient_id',
      'p.marketing_opt_in', 'p.marketing_opt_in_at', 'p.is_blocked',
    ]).where('p.id', '=', id).forUpdate().executeTakeFirst();
    return r as (Required<PatientFields> & { marketing_opt_in_at: Date | null }) | undefined;
  }

  async exists(tx: Tx, tenantId: string, id: string): Promise<boolean> {
    return !!(await this.base(tx, tenantId).select('p.id').where('p.id', '=', id).executeTakeFirst());
  }

  async branchExists(tx: Tx, id: string): Promise<boolean> {
    return !!(await tx.selectFrom('branches').select('id').where('id', '=', id).executeTakeFirst());
  }

  async create(tx: Tx, tenantId: string, f: PatientFields & { full_name: string; phone: string }, createdBy: string | null): Promise<{ id: string }> {
    return tx.insertInto('patients').values({
      tenant_id: tenantId, file_no: sql<string>`next_tenant_counter('patient_file')`, created_by: createdBy, ...f,
      marketing_opt_in: f.marketing_opt_in ?? false, marketing_opt_in_at: f.marketing_opt_in ? sql<Date>`now()` : null,
    }).returning('id').executeTakeFirstOrThrow();
  }

  async update(tx: Tx, id: string, f: PatientFields & { marketing_opt_in_at?: Date | null }): Promise<void> {
    if (!Object.keys(f).length) return;
    await tx.updateTable('patients').set({ ...f, updated_at: sql<Date>`now()` }).where('id', '=', id).execute();
  }

  async removeTag(tx: Tx, id: string, tag: string): Promise<void> {
    await tx.updateTable('patients').set({ tags: sql<string[]>`array_remove(tags, ${tag})`, updated_at: sql<Date>`now()` }).where('id', '=', id).execute();
  }

  async medicalHistory(tx: Tx, patientId: string): Promise<MedicalHistory> {
    const r = await tx.selectFrom('patient_medical_history')
      .select(['allergies', 'conditions', 'medications', 'is_pregnant', 'is_smoker', 'notes', 'updated_at'])
      .where('patient_id', '=', patientId).executeTakeFirst();
    return r ?? EMPTY_HISTORY;
  }

  async saveMedicalHistory(tx: Tx, tenantId: string, patientId: string, h: Omit<MedicalHistory, 'updated_at'>, memberId: string | null): Promise<void> {
    await tx.insertInto('patient_medical_history').values({ tenant_id: tenantId, patient_id: patientId, ...h, updated_by: memberId })
      .onConflict((oc) => oc.column('patient_id').doUpdateSet({ ...h, updated_by: memberId, updated_at: sql<Date>`now()` })).execute();
  }

  /** The visit timeline: the latest 50 appointments, upcoming first, with doctor and service names. */
  appointments(tx: Tx, patientId: string) {
    return tx.selectFrom('appointments as a')
      .innerJoin('doctors as d', 'd.id', 'a.doctor_id')
      .innerJoin('branches as b', 'b.id', 'a.branch_id')
      .leftJoin('services as s', 's.id', 'a.service_id')
      .select(['a.id', 'a.status', 'a.source', 'a.starts_at', 'a.ends_at', 'a.cancel_reason', 'd.name_ar as doctor_ar', 'd.name_en as doctor_en',
        's.name_ar as service_ar', 's.name_en as service_en', 'b.name_ar as branch_ar', 'b.name_en as branch_en'])
      .where('a.patient_id', '=', patientId).where('a.status', 'not in', ['held', 'expired'])
      .orderBy('a.starts_at', 'desc').limit(50).execute();
  }

  /**
   * Possible duplicates before a new record is saved (SRS PATIENT-002): the same phone in any phone field, or the same
   * normalised name (or a close one with the same birth date). A warning only: families share phones.
   */
  async possibleDuplicates(tx: Tx, tenantId: string, q: { phone: string | null; fullName: string | null; dateOfBirth: string | null }): Promise<PatientRow[]> {
    if (!q.phone && !q.fullName) return [];
    const norm = q.fullName ? sql<string>`ar_normalize(${q.fullName})` : null;
    const rows = await this.base(tx, tenantId).select([...LIST, dob.as('date_of_birth')])
      .where((eb) => eb.or([
        ...(q.phone ? [eb('p.phone', '=', q.phone), eb('p.phone_alt', '=', q.phone), eb('p.guardian_phone', '=', q.phone)] : []),
        ...(norm ? [sql<boolean>`p.full_name_norm = ${norm}`] : []),
        ...(norm && q.dateOfBirth ? [sql<boolean>`(p.date_of_birth = ${q.dateOfBirth}::date and similarity(p.full_name_norm, ${norm}) >= 0.5)`] : []),
      ]))
      .orderBy('p.created_at', 'desc').limit(5).execute();
    return rows.map(toRow);
  }

  /** Earlier versions of the medical history, newest first, with who saved each (SRS PATIENT-005). */
  historyVersions(tx: Tx, patientId: string) {
    return tx.selectFrom('patient_medical_history_versions as v')
      .leftJoin('tenant_members as m', 'm.id', 'v.saved_by').leftJoin('users as u', 'u.id', 'm.user_id')
      .select(['v.id', 'v.allergies', 'v.conditions', 'v.medications', 'v.is_pregnant', 'v.is_smoker', 'v.notes', 'v.saved_at', 'u.full_name as saved_by_name'])
      .where('v.patient_id', '=', patientId).orderBy('v.saved_at', 'desc').orderBy('v.id', 'desc').limit(50).execute()
      .then((rows) => rows.map((r) => ({ ...r, id: Number(r.id) })));
  }

  /** Who viewed or changed the record (DSH-15), newest first. */
  activity(tx: Tx, tenantId: string, patientId: string, limit: number) {
    return tx.selectFrom('audit_log as l').leftJoin('users as u', 'u.id', 'l.actor_user_id')
      .select(['l.id', 'l.action', 'l.changes', 'l.created_at', 'u.full_name as actor_name'])
      .where('l.tenant_id', '=', tenantId).where('l.entity_type', '=', 'patient').where('l.entity_id', '=', patientId)
      .orderBy('l.created_at', 'desc').limit(limit).execute()
      .then((rows) => rows.map((r) => ({ ...r, id: Number(r.id) })));
  }

  // ---------- for other modules (PatientDirectory) ----------

  /** BOOK-11: same phone and the same name (normalised: case, hamza, ة/ه, ى/ي, diacritics) is the same person; families share phones. */
  /** Blocked records are included on purpose: a blocked patient must be refused, not given a fresh duplicate record. */
  findByPhoneAndName(tx: Tx, tenantId: string, phone: string, fullName: string) {
    return this.base(tx, tenantId).select(['p.id', 'p.is_blocked', 'p.email']).where('p.phone', '=', phone).where(sql<boolean>`p.full_name_norm = ar_normalize(${fullName})`)
      .orderBy('p.is_blocked', 'desc').orderBy('p.created_at', 'desc').executeTakeFirst();
  }

  createFromBooking(tx: Tx, tenantId: string, p: { fullName: string; phone: string; email: string | null; preferredBranchId: string }) {
    return tx.insertInto('patients').values({
      tenant_id: tenantId, file_no: sql<string>`next_tenant_counter('patient_file')`, full_name: p.fullName, phone: p.phone, email: p.email,
      preferred_branch_id: p.preferredBranchId, referral_source: 'website', tags: [NEEDS_REVIEW],
    }).returning('id').executeTakeFirstOrThrow();
  }

  /** A record that was merged: where it went (its URL keeps working). */
  mergedInto(tx: Tx, tenantId: string, id: string) {
    return tx.selectFrom('patients').select(['merged_into_id']).where('tenant_id', '=', tenantId).where('id', '=', id)
      .where('merged_into_id', 'is not', null).executeTakeFirst().then((r) => r?.merged_into_id ?? null);
  }

  /** What a merge would move from this record, per table (database function: every table, every branch). */
  async mergeCounts(tx: Tx, id: string): Promise<Record<string, number>> {
    const r = await sql<{ c: Record<string, number> }>`select patient_merge_counts(${id}) as c`.execute(tx);
    return r.rows[0]?.c ?? {};
  }

  /** SRS PATIENT-003: one database function moves everything in one transaction (see migration 0022). */
  async merge(tx: Tx, survivorId: string, mergedId: string): Promise<Record<string, number>> {
    const r = await sql<{ m: Record<string, number> }>`select merge_patients(${survivorId}, ${mergedId}) as m`.execute(tx);
    return r.rows[0]?.m ?? {};
  }

  bookable(tx: Tx, tenantId: string, id: string) {
    return this.base(tx, tenantId).select(['p.id', 'p.is_blocked']).where('p.id', '=', id).executeTakeFirst();
  }
}
