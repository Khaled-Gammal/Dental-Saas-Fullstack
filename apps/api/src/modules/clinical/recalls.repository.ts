import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

export type RecallStatus = 'pending' | 'contacted' | 'booked' | 'done' | 'dismissed';
const due = sql<string>`to_char(r.due_date, 'YYYY-MM-DD')`;

/** Follow-ups (SRS VISIT-005). Booked ones go back to the list, or close, with their appointment (database trigger). */
@Injectable()
export class RecallsRepository {
  private rows(tx: Tx) {
    return tx.selectFrom('recalls as r').innerJoin('patients as p', 'p.id', 'r.patient_id').leftJoin('doctors as d', 'd.id', 'r.doctor_id')
      .leftJoin('appointments as a', 'a.id', 'r.appointment_id')
      .select([
        'r.id', 'r.patient_id', 'r.doctor_id', 'r.reason', 'r.status', due.as('due_date'), 'r.appointment_id', 'r.source_visit_id', 'r.last_contacted_at',
        'r.contact_attempts', 'r.notes', 'r.created_at', 'a.starts_at as appointment_at',
        sql<{ id: string; full_name: string; phone: string; file_no: number }>`json_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'file_no', p.file_no)`.as('patient'),
        sql<{ name_ar: string | null; name_en: string | null } | null>`case when d.id is null then null else json_build_object('name_ar', d.name_ar, 'name_en', d.name_en) end`.as('doctor'),
      ]);
  }

  /** due: open and due by today; upcoming: open and later; closed: booked, done or dismissed (latest first). */
  list(tx: Tx, view: 'due' | 'upcoming' | 'closed', today: string, limit: number) {
    let q = this.rows(tx).where('p.merged_into_id', 'is', null);
    if (view === 'closed') return q.where('r.status', 'in', ['booked', 'done', 'dismissed']).orderBy('r.due_date', 'desc').limit(limit).execute();
    q = q.where('r.status', 'in', ['pending', 'contacted']);
    const day = sql<Date>`${today}::date`;
    q = view === 'due' ? q.where('r.due_date', '<=', day) : q.where('r.due_date', '>', day);
    return q.orderBy('r.due_date').orderBy('r.created_at').limit(limit).execute();
  }

  forPatient(tx: Tx, patientId: string) {
    return this.rows(tx).where('r.patient_id', '=', patientId).orderBy('r.due_date', 'desc').limit(100).execute();
  }

  get(tx: Tx, id: string) {
    return this.rows(tx).where('r.id', '=', id).executeTakeFirst();
  }

  lock(tx: Tx, id: string) {
    return tx.selectFrom('recalls').select(['id', 'status', 'patient_id', 'notes', 'contact_attempts']).where('id', '=', id).forUpdate().executeTakeFirst()
      .then((r) => r && { ...r, status: r.status as RecallStatus });
  }

  async create(tx: Tx, tenantId: string, r: { patientId: string; reason: string; dueDate: string; notes: string | null; doctorId: string | null; sourceVisitId: string | null; createdBy: string }): Promise<string> {
    const { id } = await tx.insertInto('recalls').values({
      tenant_id: tenantId, patient_id: r.patientId, reason: r.reason, due_date: r.dueDate, notes: r.notes, doctor_id: r.doctorId,
      source_visit_id: r.sourceVisitId, created_by: r.createdBy,
    }).returning('id').executeTakeFirstOrThrow();
    return id;
  }

  async update(tx: Tx, id: string, f: { status?: RecallStatus; notes?: string | null; contact_attempts?: number; last_contacted_at?: Date; appointment_id?: string | null }): Promise<void> {
    await tx.updateTable('recalls').set(f).where('id', '=', id).execute();
  }

  visitPatient(tx: Tx, visitId: string) {
    return tx.selectFrom('visits').select(['id', 'patient_id', 'doctor_id']).where('id', '=', visitId).executeTakeFirst();
  }

  appointment(tx: Tx, id: string) {
    return tx.selectFrom('appointments').select(['id', 'patient_id', 'status']).where('id', '=', id).executeTakeFirst();
  }

  timezone(tx: Tx, tenantId: string) {
    return tx.selectFrom('tenants').select('timezone').where('id', '=', tenantId).executeTakeFirst().then((t) => t?.timezone ?? null);
  }

  memberName(tx: Tx, memberId: string) {
    return tx.selectFrom('tenant_members as m').innerJoin('users as u', 'u.id', 'm.user_id').select('u.full_name').where('m.id', '=', memberId)
      .executeTakeFirst().then((r) => r?.full_name ?? '');
  }
}
