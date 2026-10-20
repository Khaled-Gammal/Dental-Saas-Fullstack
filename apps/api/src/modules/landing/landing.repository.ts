import { Injectable } from '@nestjs/common';
import type { Db } from '@dental/db';
import { TenantDb } from '../../shared/database/tenant-db.service';

export interface PublicPlan {
  id: string; code: string; name_ar: string; price_monthly_minor: number; price_yearly_minor: number; currency: string; trial_days: number;
  limits: Record<string, number | null>;
}
export interface LeadRow {
  full_name: string; phone: string; email: string | null; clinic_name: string | null; city: string | null; message: string | null;
  source: string | null; plan_id: string | null; ip: string | null; user_agent: string | null;
}

/** The landing page's SQL (H7): public plans, and adding a lead (the API role may add one, never read them). */
@Injectable()
export class LandingRepository {
  constructor(private readonly tenantDb: TenantDb) {}
  private get db(): Db { return this.tenantDb.platform(); }

  /** LND-02: the plans offered to new clinics, in the panel's order. Features are left out: none is enforced yet. */
  publicPlans(): Promise<PublicPlan[]> {
    return this.db.selectFrom('plans')
      .select(['id', 'code', 'name_ar', 'price_monthly_minor', 'price_yearly_minor', 'currency', 'trial_days', 'limits'])
      .where('is_public', '=', true)
      .orderBy('sort_order').orderBy('price_monthly_minor').execute()
      .then((rows) => rows.map((r) => ({
        ...r, price_monthly_minor: Number(r.price_monthly_minor), price_yearly_minor: Number(r.price_yearly_minor),
        limits: (r.limits ?? {}) as Record<string, number | null>,
      })));
  }

  /** A public plan by its code (the plan a visitor asked about). */
  plan(code: string) {
    return this.db.selectFrom('plans').select(['id', 'name_ar']).where('code', '=', code).where('is_public', '=', true).executeTakeFirst();
  }

  async addLead(lead: LeadRow): Promise<void> {
    // no RETURNING: the API role cannot read leads back
    await this.db.insertInto('leads').values(lead).execute();
  }

  /** Where a new request is announced: every active platform admin with an email. */
  adminEmails(): Promise<string[]> {
    return this.db.selectFrom('users').select('email').where('platform_role', '=', 'super_admin').where('is_active', '=', true)
      .where('email', 'is not', null).execute()
      .then((rows) => rows.map((r) => r.email as string));
  }
}
