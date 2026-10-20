import { Injectable } from '@nestjs/common';
import { sql, type Db, type Tx } from '@dental/db';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';

export type LegalKind = 'terms' | 'privacy' | 'dpa';
export const LEGAL_KINDS: readonly LegalKind[] = ['terms', 'privacy', 'dpa'];
export interface LegalDocRef { id: string; kind: LegalKind; version: number; title_ar: string }
interface Meta { ip?: string | null; userAgent?: string | null }

/** Which documents a person accepts (owner 2026-10-20): the owner all three (the DPA for their clinic), staff two. */
export const kindsFor = (owner: boolean): LegalKind[] => (owner ? ['terms', 'privacy', 'dpa'] : ['terms', 'privacy']);

/**
 * Legal documents (H6, NFR-15): the current version of each, what a person still has to accept, and recording their
 * acceptance. Publishing is the platform panel's (a database function); acceptances are never changed.
 */
@Injectable()
export class LegalService {
  constructor(private readonly tenantDb: TenantDb) {}
  private get db(): Db { return this.tenantDb.platform(); }

  /** The latest version of each document (only kinds that have one). */
  async current(): Promise<(LegalDocRef & { published_at: Date })[]> {
    const { rows } = await sql<LegalDocRef & { published_at: Date }>`
      select distinct on (kind) id, kind, version, title_ar, published_at from legal_documents order by kind, version desc`.execute(this.db);
    return rows.sort((a, b) => LEGAL_KINDS.indexOf(a.kind) - LEGAL_KINDS.indexOf(b.kind));
  }

  /** One document's current text, for reading before accepting. */
  async document(kind: string) {
    const d = await this.db.selectFrom('legal_documents').select(['id', 'kind', 'version', 'title_ar', 'body_ar', 'published_at'])
      .where('kind', '=', kind).orderBy('version', 'desc').limit(1).executeTakeFirst();
    if (!d) throw Err.notFound('legal_document_not_found', 'Document not found');
    return d;
  }

  /** What this person still has to accept to use this clinic (empty when nothing is published or all is accepted). */
  async pending(userId: string, tenantId: string, owner: boolean): Promise<LegalDocRef[]> {
    const { rows } = await sql<LegalDocRef>`select * from legal_pending(${userId}::uuid, ${tenantId}::uuid, ${owner})`.execute(this.db);
    return rows;
  }

  /**
   * At sign-up or when joining: the person must accept the current version of every kind that applies to them (kinds
   * with nothing published are not asked). Returns the documents to record.
   */
  async requireAccepted(acceptedIds: readonly string[], kinds: readonly LegalKind[]): Promise<LegalDocRef[]> {
    const current = (await this.current()).filter((d) => kinds.includes(d.kind));
    const missing = current.filter((d) => !acceptedIds.includes(d.id));
    if (missing.length) {
      throw Err.badRequest('legal_acceptance_required', 'Accept the current Terms, Privacy Policy and agreement to continue', {
        documents: missing.map((d) => ({ id: d.id, kind: d.kind, version: d.version })),
      });
    }
    return current;
  }

  /** A signed-in member accepts everything their session lists as pending (all of it, or nothing is recorded). */
  async acceptPending(userId: string, tenantId: string, owner: boolean, documentIds: readonly string[], meta: Meta): Promise<void> {
    const pending = await this.pending(userId, tenantId, owner);
    const missing = pending.filter((d) => !documentIds.includes(d.id));
    if (missing.length) {
      throw Err.badRequest('legal_acceptance_required', 'Accept every listed document to continue', {
        documents: missing.map((d) => ({ id: d.id, kind: d.kind, version: d.version })),
      });
    }
    await this.record(this.db, userId, tenantId, pending, meta);
  }

  /** Records acceptances (once each); the DPA for the clinic, the others for the person. */
  async record(tx: Tx | Db, userId: string, tenantId: string, docs: readonly LegalDocRef[], meta: Meta): Promise<void> {
    if (!docs.length) return;
    await tx.insertInto('legal_acceptances')
      .values(docs.map((d) => ({
        user_id: userId, document_id: d.id, tenant_id: d.kind === 'dpa' ? tenantId : null,
        ip: meta.ip ?? null, user_agent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
      })))
      .onConflict((oc) => oc.constraint('legal_acceptances_once').doNothing())
      .execute();
  }
}
