import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

export interface PatientFileRow {
  file_id: string; kind: string; mime_type: string; size_bytes: number; caption: string | null; taken_at: string | null;
  created_at: Date; uploaded_by_name: string | null; archived_at: Date | null; archive_reason: string | null;
}

/** SQL for a patient's clinical documents (SRS 8.2: `files` and `patient_files` belong to the patients module). */
@Injectable()
export class PatientFilesRepository {
  async usedBytes(tx: Tx): Promise<number> {
    const { rows } = await sql<{ n: string }>`select coalesce(sum(size_bytes), 0) as n from files`.execute(tx);
    return Number(rows[0]?.n ?? 0);
  }

  async insert(tx: Tx, f: {
    id: string; tenantId: string; patientId: string; bucket: string; objectKey: string; mime: string; size: number; kind: string;
    sha256: string; uploadedBy: string | null; caption: string | null; takenAt: string | null;
  }): Promise<void> {
    await tx.insertInto('files').values({
      id: f.id, tenant_id: f.tenantId, bucket: f.bucket, object_key: f.objectKey, mime_type: f.mime, size_bytes: f.size, kind: f.kind,
      is_private: true, sha256: f.sha256, uploaded_by: f.uploadedBy,
    }).execute();
    await tx.insertInto('patient_files').values({ tenant_id: f.tenantId, patient_id: f.patientId, file_id: f.id, caption: f.caption, taken_at: f.takenAt }).execute();
  }

  list(tx: Tx, patientId: string, archived: boolean): Promise<PatientFileRow[]> {
    let q = tx.selectFrom('patient_files as pf').innerJoin('files as f', 'f.id', 'pf.file_id')
      .leftJoin('tenant_members as m', 'm.id', 'f.uploaded_by').leftJoin('users as u', 'u.id', 'm.user_id')
      .select(['pf.file_id', 'f.kind', 'f.mime_type', 'f.size_bytes', 'pf.caption', sql<string | null>`to_char(pf.taken_at, 'YYYY-MM-DD')`.as('taken_at'),
        'f.created_at', 'u.full_name as uploaded_by_name', 'pf.archived_at', 'pf.archive_reason'])
      .where('pf.patient_id', '=', patientId)
      .where('f.kind', 'in', ['xray', 'clinical_photo', 'document']);
    q = archived ? q.where('pf.archived_at', 'is not', null) : q.where('pf.archived_at', 'is', null);
    return q.orderBy('f.created_at', 'desc').limit(200).execute()
      .then((rows) => rows.map((r) => ({ ...r, size_bytes: Number(r.size_bytes) })));
  }

  /** The file of a patient, for download or archive (RLS: another clinic's file looks missing). */
  find(tx: Tx, fileId: string) {
    return tx.selectFrom('patient_files as pf').innerJoin('files as f', 'f.id', 'pf.file_id')
      .select(['pf.patient_id', 'f.id', 'f.kind', 'f.mime_type', 'f.size_bytes', 'f.object_key', 'pf.archived_at'])
      .where('pf.file_id', '=', fileId).where('f.kind', 'in', ['xray', 'clinical_photo', 'document']).executeTakeFirst();
  }

  async archive(tx: Tx, patientId: string, fileId: string, reason: string, memberId: string | null): Promise<boolean> {
    return !!(await tx.updateTable('patient_files').set({ archived_at: sql<Date>`now()`, archive_reason: reason, archived_by: memberId })
      .where('patient_id', '=', patientId).where('file_id', '=', fileId).where('archived_at', 'is', null).returning('file_id').executeTakeFirst());
  }

  /** One "viewed" audit row per user, file and 10 minutes (thumbnails re-render; every distinct access still shows). */
  async recordView(tx: Tx, tenantId: string, userId: string, patientId: string, fileId: string, ip: string | null): Promise<void> {
    await sql`
      insert into audit_log (tenant_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, ip)
      select ${tenantId}, 'member', ${userId}, 'patient_file.view', 'patient', ${patientId}, ${JSON.stringify({ file_id: fileId })}::jsonb, ${ip}::inet
      where not exists (
        select 1 from audit_log where tenant_id = ${tenantId} and entity_type = 'patient' and entity_id = ${patientId}
          and action = 'patient_file.view' and actor_user_id = ${userId} and changes ->> 'file_id' = ${fileId}
          and created_at > now() - interval '10 minutes')`.execute(tx);
  }
}
