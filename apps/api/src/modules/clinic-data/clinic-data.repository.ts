import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';
import { TenantDb } from '../../shared/database/tenant-db.service';

export interface ExportView {
  id: string; status: 'queued' | 'running' | 'ready' | 'failed' | 'expired'; size_bytes: number | null; files_count: number | null;
  created_at: Date; finished_at: Date | null; expires_at: Date | null;
}

/** The SQL of H8 (NFR-08): the clinic's exports (RLS-scoped) and the deletion request (a definer function). */
@Injectable()
export class ClinicDataRepository {
  constructor(private readonly db: TenantDb) {}

  /** The member's role key in their clinic: only 'owner' may export or delete. */
  roleOf(tx: Tx, memberId: string): Promise<string | undefined> {
    return tx.selectFrom('tenant_members as m').innerJoin('roles as r', 'r.id', 'm.role_id')
      .select('r.key').where('m.id', '=', memberId).where('m.status', '=', 'active').executeTakeFirst().then((r) => r?.key);
  }

  clinic(tx: Tx, tenantId: string) {
    return tx.selectFrom('tenants').select(['name_ar', 'name_en', 'slug']).where('id', '=', tenantId).executeTakeFirstOrThrow();
  }

  exports(tx: Tx): Promise<ExportView[]> {
    return tx.selectFrom('data_exports')
      .select(['id', 'status', 'size_bytes', 'files_count', 'created_at', 'finished_at', 'expires_at'])
      .orderBy('created_at', 'desc').limit(10).execute()
      .then((rows) => rows.map((r) => ({ ...r, size_bytes: r.size_bytes == null ? null : Number(r.size_bytes) })) as ExportView[]);
  }

  async exportsSince(tx: Tx, hours: number): Promise<number> {
    const r = await tx.selectFrom('data_exports').select(({ fn }) => fn.countAll<number>().as('n'))
      .where('created_at', '>', sql<Date>`now() - make_interval(hours => ${hours})`).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** No RETURNING beyond the id: the API role reads exports through RLS, writes only these two columns. */
  async addExport(tx: Tx, tenantId: string, userId: string): Promise<void> {
    await tx.insertInto('data_exports').values({ tenant_id: tenantId, requested_by: userId }).execute();
  }

  readyExport(tx: Tx, id: string) {
    return tx.selectFrom('data_exports').select(['id', 'object_key', 'created_at'])
      .where('id', '=', id).where('status', '=', 'ready').where('expires_at', '>', sql<Date>`now()`).executeTakeFirst();
  }

  userEmail(userId: string): Promise<string | null> {
    return this.db.platform().selectFrom('users').select('email').where('id', '=', userId).executeTakeFirst().then((r) => r?.email ?? null);
  }

  /** request_clinic_deletion checks the owner again, closes the clinic and returns when its data will be erased. */
  async requestDeletion(userId: string, tenantId: string): Promise<Date> {
    const { rows } = await sql<{ at: Date }>`select request_clinic_deletion(${userId}::uuid, ${tenantId}::uuid) as at`.execute(this.db.platform());
    return rows[0].at;
  }
}
