import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

export interface TemplateView {
  id: string; key: string; version: number; title_ar: string; body_ar: string; is_active: boolean; is_draft: boolean;
  reviewed_at: Date | null; reviewed_by_name: string | null; created_at: Date; signed: number;
}
export interface ConsentRow {
  id: string; key: string; version: number; title: string; method: 'screen' | 'paper'; signer_name: string; signer_relation: string;
  visit_id: string | null; signed_at: Date; recorded_by_name: string | null; revoked_at: Date | null; revoke_reason: string | null;
  revoked_by_name: string | null; file_id: string;
}

const memberName = (col: string) => sql<string | null>`(select u.full_name from tenant_members m join users u on u.id = m.user_id where m.id = ${sql.ref(col)})`;

/** The SQL of patient consents (H9). Everything runs inside the clinic's transaction (RLS). */
@Injectable()
export class ConsentsRepository {
  /** The current (latest) version of every consent text, with how many consents were signed on any of its versions. */
  async current(tx: Tx): Promise<TemplateView[]> {
    const { rows } = await sql<TemplateView>`
      select distinct on (t.key) t.id, t.key, t.version, t.title_ar, t.body_ar, t.is_active, t.reviewed_at is null as is_draft, t.reviewed_at,
             (select u.full_name from tenant_members m join users u on u.id = m.user_id where m.id = t.reviewed_by) as reviewed_by_name, t.created_at,
             (select count(*)::int from patient_consents c join consent_templates v on v.id = c.template_id where v.key = t.key) as signed
      from consent_templates t order by t.key, t.version desc`.execute(tx);
    return rows.sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.title_ar.localeCompare(b.title_ar, 'ar'));
  }

  /** Every version of one text, newest first. */
  versions(tx: Tx, key: string) {
    return tx.selectFrom('consent_templates as t')
      .select(['t.id', 't.version', 't.title_ar', 't.body_ar', 't.is_active', 't.reviewed_at', 't.created_at', memberName('t.reviewed_by').as('reviewed_by_name'),
        sql<boolean>`t.reviewed_at is null`.as('is_draft')])
      .where('t.key', '=', key).orderBy('t.version', 'desc').execute();
  }

  /** The current version of a text, locked so two saves cannot take the same next number. */
  async latestForUpdate(tx: Tx, key: string) {
    await sql`select pg_advisory_xact_lock(hashtext('consent_templates'), hashtext(${key}))`.execute(tx);
    return tx.selectFrom('consent_templates').select(['id', 'version', 'is_active', 'reviewed_at'])
      .where('key', '=', key).orderBy('version', 'desc').limit(1).executeTakeFirst();
  }

  async addVersion(tx: Tx, tenantId: string, v: { key: string; version: number; titleAr: string; bodyAr: string; memberId: string }): Promise<void> {
    await tx.insertInto('consent_templates').values({
      tenant_id: tenantId, key: v.key, version: v.version, title_ar: v.titleAr, body_ar: v.bodyAr, is_active: true,
      reviewed_at: sql<Date>`now()`, reviewed_by: v.memberId, created_by: v.memberId,
    }).execute();
  }

  async setActive(tx: Tx, key: string, active: boolean): Promise<boolean> {
    const rows = await tx.updateTable('consent_templates').set({ is_active: active }).where('key', '=', key).returning('id').execute();
    return rows.length > 0;
  }

  // ---------- signed consents ----------
  list(tx: Tx, patientId: string): Promise<ConsentRow[]> {
    return tx.selectFrom('patient_consents as c').innerJoin('consent_templates as t', 't.id', 'c.template_id')
      .select(['c.id', 't.key', 't.version', sql<string>`coalesce(c.title_snapshot, t.title_ar)`.as('title'), 'c.method', 'c.signer_name', 'c.signer_relation',
        'c.visit_id', 'c.signed_at', memberName('c.recorded_by').as('recorded_by_name'), 'c.revoked_at', 'c.revoke_reason', memberName('c.revoked_by').as('revoked_by_name'),
        sql<string>`coalesce(c.signature_file_id, c.paper_file_id)`.as('file_id')])
      .where('c.patient_id', '=', patientId).orderBy('c.signed_at', 'desc').execute() as Promise<ConsentRow[]>;
  }

  get(tx: Tx, patientId: string, id: string) {
    return tx.selectFrom('patient_consents as c').innerJoin('consent_templates as t', 't.id', 'c.template_id')
      .select(['c.id', 't.key', 't.version', sql<string>`coalesce(c.title_snapshot, t.title_ar)`.as('title'), 'c.body_snapshot', 'c.method', 'c.signer_name',
        'c.signer_relation', 'c.visit_id', 'c.signed_at', memberName('c.recorded_by').as('recorded_by_name'), 'c.revoked_at', 'c.revoke_reason',
        memberName('c.revoked_by').as('revoked_by_name'), sql<string>`coalesce(c.signature_file_id, c.paper_file_id)`.as('file_id')])
      .where('c.patient_id', '=', patientId).where('c.id', '=', id).executeTakeFirst();
  }

  async usedBytes(tx: Tx): Promise<number> {
    const { rows } = await sql<{ n: string }>`select coalesce(sum(size_bytes), 0) as n from files`.execute(tx);
    return Number(rows[0]?.n ?? 0);
  }

  async insertFile(tx: Tx, f: { id: string; tenantId: string; bucket: string; objectKey: string; mime: string; size: number; sha256: string; uploadedBy: string | null }) {
    await tx.insertInto('files').values({
      id: f.id, tenant_id: f.tenantId, bucket: f.bucket, object_key: f.objectKey, mime_type: f.mime, size_bytes: f.size, kind: 'consent',
      is_private: true, sha256: f.sha256, uploaded_by: f.uploadedBy,
    }).execute();
  }

  /** The database copies the text signed from the template (patient_consents_guard): what is passed as body is ignored. */
  async insertConsent(tx: Tx, c: {
    tenantId: string; patientId: string; templateId: string; visitId: string | null; signerName: string; signerRelation: string;
    method: 'screen' | 'paper'; fileId: string; recordedBy: string | null; ip: string | null;
  }): Promise<string> {
    const row = await tx.insertInto('patient_consents').values({
      tenant_id: c.tenantId, patient_id: c.patientId, template_id: c.templateId, visit_id: c.visitId, locale: 'ar', body_snapshot: '',
      signer_name: c.signerName, signer_relation: c.signerRelation, method: c.method,
      signature_file_id: c.method === 'screen' ? c.fileId : null, paper_file_id: c.method === 'paper' ? c.fileId : null,
      recorded_by: c.recordedBy, signed_ip: c.ip,
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async revoke(tx: Tx, patientId: string, id: string, memberId: string, reason: string): Promise<boolean> {
    const rows = await tx.updateTable('patient_consents').set({ revoked_at: sql<Date>`now()`, revoked_by: memberId, revoke_reason: reason })
      .where('patient_id', '=', patientId).where('id', '=', id).where('revoked_at', 'is', null).returning('id').execute();
    return rows.length > 0;
  }

  /** The consent's signature or scan, for the signed link (only when it belongs to a consent of this clinic). */
  fileOfConsent(tx: Tx, fileId: string) {
    return tx.selectFrom('patient_consents as c').innerJoin('files as f', (j) => j.on(sql<boolean>`f.id = coalesce(c.signature_file_id, c.paper_file_id)`))
      .select(['f.object_key', 'f.mime_type', 'c.patient_id', 'c.id as consent_id']).where('f.id', '=', fileId).executeTakeFirst();
  }
}
