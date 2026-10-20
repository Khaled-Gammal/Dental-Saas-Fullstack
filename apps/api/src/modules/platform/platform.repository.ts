import { Injectable } from '@nestjs/common';
import { sql, type Db } from '@dental/db';
import { TenantDb } from '../../shared/database/tenant-db.service';

export interface ClinicRow {
  id: string; slug: string; name_ar: string | null; name_en: string | null; status: string; created_at: Date; suspended_at: Date | null;
  suspension_reason: string | null; suspension_kind: 'manual' | 'trial_ended' | null;
  plan_code: string | null; plan_name_ar: string | null; subscription_status: string | null; trial_ends_at: Date | null;
  billing_cycle: string | null; current_period_end: Date | null;
  members: number; branches: number; patients: number; appointments_30d: number; last_login_at: Date | null; owner_email: string | null;
}

export interface LeadView {
  id: string; kind: 'call' | 'subscribe'; billing_cycle: 'monthly' | 'yearly' | null; clinic_id: string | null; full_name: string; phone: string; email: string | null; clinic_name: string | null; city: string | null; message: string | null;
  source: string | null; status: 'new' | 'contacted' | 'converted' | 'lost'; plan_code: string | null; plan_name_ar: string | null;
  created_at: Date; updated_at: Date; updated_by_name: string | null;
}

/**
 * All SQL of the platform admin panel (H5). Cross-clinic reads and the writes the API role may not do go through the
 * SECURITY DEFINER `platform_*()` functions, which check the admin and write the platform audit log themselves. Since
 * 0004 the API role may not write platform tables (plans, the platform audit log, notes), so every write goes through
 * them too; plans and the platform audit log are read directly.
 */
@Injectable()
export class PlatformRepository {
  constructor(private readonly tenantDb: TenantDb) {}
  private get db(): Db { return this.tenantDb.platform(); }

  /** The sign-in candidate (password hash through the definer lookup: the API role cannot read hashes). */
  async loginCandidate(email: string) {
    const { rows } = await sql<{ id: string; password_hash: string | null; is_active: boolean; email: string | null }>`
      select id, password_hash, is_active, email from login_candidate(${email}, ${null})`.execute(this.db);
    return rows[0];
  }

  /** true for an active platform admin (the same check every platform function makes). */
  async isAdmin(userId: string): Promise<boolean> {
    try {
      await sql`select platform_assert_admin(${userId}::uuid)`.execute(this.db);
      return true;
    } catch {
      return false;
    }
  }

  me(userId: string) {
    return this.db.selectFrom('users').select(['id', 'full_name', 'email']).where('id', '=', userId).executeTakeFirst();
  }

  async clinics(actor: string): Promise<ClinicRow[]> {
    const { rows } = await sql<ClinicRow>`select * from platform_clinics(${actor}::uuid)`.execute(this.db);
    return rows;
  }

  extendTrial(actor: string, tenantId: string, until: string) {
    return sql`select platform_extend_trial(${actor}::uuid, ${tenantId}::uuid, ${until}::timestamptz)`.execute(this.db);
  }

  suspend(actor: string, tenantId: string, reason: string) {
    return sql`select platform_suspend(${actor}::uuid, ${tenantId}::uuid, ${reason})`.execute(this.db);
  }

  reactivate(actor: string, tenantId: string) {
    return sql`select platform_reactivate(${actor}::uuid, ${tenantId}::uuid)`.execute(this.db);
  }

  activate(actor: string, tenantId: string, cycle: 'monthly' | 'yearly') {
    return sql`select platform_activate(${actor}::uuid, ${tenantId}::uuid, ${cycle})`.execute(this.db);
  }

  changePlan(actor: string, tenantId: string, planId: string) {
    return sql`select platform_change_plan(${actor}::uuid, ${tenantId}::uuid, ${planId}::uuid)`.execute(this.db);
  }

  async notes(actor: string, tenantId: string) {
    const { rows } = await sql<{ id: string; body: string; created_at: Date; author: string }>`
      select * from platform_notes(${actor}::uuid, ${tenantId}::uuid)`.execute(this.db);
    return rows;
  }

  addNote(actor: string, tenantId: string, body: string) {
    return sql`select platform_add_note(${actor}::uuid, ${tenantId}::uuid, ${body})`.execute(this.db);
  }

  /** What the platform did to a clinic (or everywhere, when no clinic is given), newest first. */
  audit(tenantId: string | null, limit = 50) {
    let q = this.db.selectFrom('platform_audit_log as a').leftJoin('users as u', 'u.id', 'a.actor_user_id')
      .select(['a.id', 'a.action', 'a.tenant_id', 'a.details', 'a.created_at', 'u.full_name as actor']);
    if (tenantId) q = q.where('a.tenant_id', '=', tenantId);
    return q.orderBy('a.id', 'desc').limit(limit).execute();
  }

  record(actor: string, action: string, tenantId: string | null, details: Record<string, unknown>, ip: string | null) {
    return sql`select platform_record(${actor}::uuid, ${action}, ${tenantId}::uuid, ${JSON.stringify(details)}::jsonb, ${ip}::inet)`.execute(this.db);
  }

  // ---------- legal documents (H6, NFR-15) ----------
  /** Every version of every document, newest first, with how many accepted it. */
  legalVersions() {
    return this.db.selectFrom('legal_documents as d').leftJoin('users as u', 'u.id', 'd.published_by')
      .select(['d.id', 'd.kind', 'd.version', 'd.title_ar', 'd.body_ar', 'd.requires_reacceptance', 'd.published_at', 'u.full_name as published_by',
        sql<number>`(select count(*)::int from legal_acceptances a where a.document_id = d.id)`.as('acceptances')])
      .orderBy('d.kind').orderBy('d.version', 'desc').execute();
  }

  async publishLegal(actor: string, kind: string, title: string, body: string, reaccept: boolean): Promise<string> {
    const { rows } = await sql<{ id: string }>`select platform_publish_legal(${actor}::uuid, ${kind}, ${title}, ${body}, ${reaccept}) as id`.execute(this.db);
    return rows[0].id;
  }

  // ---------- landing-page requests (H7, LND-04): the API role cannot read leads, the definer functions can ----------
  async leads(actor: string): Promise<LeadView[]> {
    const { rows } = await sql<LeadView>`select * from platform_leads(${actor}::uuid)`.execute(this.db);
    return rows;
  }

  setLeadStatus(actor: string, id: string, status: string) {
    return sql`select platform_set_lead_status(${actor}::uuid, ${id}::uuid, ${status})`.execute(this.db);
  }

  // ---------- plans (ADM-04) ----------
  plans() {
    return this.db.selectFrom('plans as p')
      .select(['p.id', 'p.code', 'p.name_ar', 'p.name_en', 'p.price_monthly_minor', 'p.price_yearly_minor', 'p.currency', 'p.trial_days', 'p.limits',
        'p.features', 'p.is_public', 'p.sort_order',
        sql<number>`(select count(*)::int from subscriptions s where s.plan_id = p.id and s.status <> 'cancelled')`.as('clinics')])
      .orderBy('p.sort_order').orderBy('p.price_monthly_minor').execute()
      .then((rows) => rows.map((r) => ({ ...r, price_monthly_minor: Number(r.price_monthly_minor), price_yearly_minor: Number(r.price_yearly_minor) })));
  }

  /** `changes`: name_ar, price_monthly_minor, price_yearly_minor, trial_days, limits, features, is_public (any of them) */
  updatePlan(actor: string, id: string, changes: Record<string, unknown>, ip: string | null) {
    return sql`select platform_update_plan(${actor}::uuid, ${id}::uuid, ${JSON.stringify(changes)}::jsonb, ${ip}::inet)`.execute(this.db);
  }
}
