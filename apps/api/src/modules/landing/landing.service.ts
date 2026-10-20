import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, LANDING_POLICY, type AppConfig } from '../../config';
import { maskEmail } from '../../shared/mask';
import { EMAIL_SENDER, type EmailSender } from '../../shared/notifications/ports';
import { RATE_LIMITER, type RateLimiter } from '../../shared/rate-limit/ports';
import type { RequestMeta } from '../identity/identity.types';
import type { NewLeadInput } from './landing.schemas';
import { LandingRepository } from './landing.repository';

/**
 * The platform landing page (H7): the public plans (LND-02) and the contact form for clinics (LND-04). A request is
 * stored for the platform panel and announced to the platform admins by email (the clinic's name and city only; the
 * person's details stay in the panel).
 */
@Injectable()
export class LandingService {
  private readonly logger = new Logger(LandingService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    private readonly repo: LandingRepository,
  ) {}

  plans() { return this.repo.publicPlans(); }

  async submitLead(input: NewLeadInput, meta: RequestMeta): Promise<void> {
    if (input.website) return; // the hidden field was filled in: a bot. It is told nothing.
    await this.limiter.throttle(`lead:phone:${input.phone}`, ...LANDING_POLICY.throttle.leadPhone);
    const plan = input.planCode ? await this.repo.plan(input.planCode) : undefined;
    await this.repo.addLead({
      full_name: input.fullName, phone: input.phone, email: input.email ?? null, clinic_name: input.clinicName ?? null,
      city: input.city ?? null, message: input.message ?? null, source: input.source ?? 'landing', plan_id: plan?.id ?? null,
      ip: meta.ip ?? null, user_agent: meta.userAgent ?? null,
    });
    await this.announce(input.clinicName, input.city, plan?.name_ar);
  }

  private async announce(clinic: string | undefined, city: string | undefined, plan: string | undefined): Promise<void> {
    const lines = ['وصل طلب تواصل جديد من صفحة المنصة.'];
    if (clinic) lines.push(`العيادة: ${clinic}`);
    if (city) lines.push(`المدينة: ${city}`);
    if (plan) lines.push(`الباقة: ${plan}`);
    lines.push('', `بيانات التواصل في لوحة إدارة المنصة:\n${this.cfg.DASHBOARD_URL}/#/platform/leads`);
    for (const to of await this.repo.adminEmails()) {
      try {
        await this.email.send(to, LANDING_POLICY.notifySubject, lines.join('\n'));
      } catch (err) {
        this.logger.error(`Lead email to ${maskEmail(to)} failed: ${(err as Error).message}`);
      }
    }
  }
}
