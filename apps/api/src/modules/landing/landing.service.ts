import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, LANDING_POLICY, type AppConfig } from '../../config';
import { maskEmail } from '../../shared/mask';
import { EMAIL_SENDER, type EmailSender } from '../../shared/notifications/ports';
import { RATE_LIMITER, type RateLimiter } from '../../shared/rate-limit/ports';
import type { RequestMeta } from '../identity/identity.types';
import type { NewLeadInput } from './landing.schemas';

export interface SubscribeRequest {
  clinicId: string; clinicName: string; fullName: string; phone: string; email: string; planCode: string; cycle: 'monthly' | 'yearly';
}
import { LandingRepository } from './landing.repository';

/**
 * The platform landing page (H7): the public plans (LND-02) and the contact form for clinics (LND-04). A request is
 * stored for the platform panel and announced to the platform admins by email (the clinic's name and city only; the
 * person's details stay in the panel). «اشترك الآن» (owner, 2026-10-20) is a sign-up that names a plan and a billing
 * cycle: the new clinic is recorded the same way, as a subscription request, for the admin to collect payment and
 * activate it.
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
    await this.announce(LANDING_POLICY.notifySubject, 'وصل طلب تواصل جديد من صفحة المنصة.', [
      input.clinicName && `العيادة: ${input.clinicName}`, input.city && `المدينة: ${input.city}`, plan && `الباقة: ${plan.name_ar}`,
    ]);
  }

  /**
   * A clinic signed up from «اشترك الآن». Never fails the sign-up: a problem here is logged, and the admin still sees the
   * new clinic in the panel. An unknown or hidden plan is recorded as "no plan named".
   */
  async subscribeRequest(input: SubscribeRequest, meta: RequestMeta): Promise<void> {
    try {
      const plan = await this.repo.plan(input.planCode);
      await this.repo.addLead({
        kind: 'subscribe', full_name: input.fullName, phone: input.phone, email: input.email, clinic_name: input.clinicName, city: null,
        message: null, source: 'signup', plan_id: plan?.id ?? null, billing_cycle: input.cycle, clinic_id: input.clinicId,
        ip: meta.ip ?? null, user_agent: meta.userAgent ?? null,
      });
      await this.announce(LANDING_POLICY.subscribeSubject, 'سجّلت عيادة جديدة من «اشترك الآن» وتنتظر تفعيل اشتراكها.', [
        `العيادة: ${input.clinicName}`, `الباقة: ${plan?.name_ar ?? 'لم تحدد'}`, `الدفع: ${input.cycle === 'yearly' ? 'سنوي' : 'شهري'}`,
      ]);
    } catch (err) {
      this.logger.error(`Subscription request for clinic ${input.clinicId} not recorded: ${(err as Error).message}`);
    }
  }

  /** Emails every platform admin: a heading and a few facts about the clinic, never the person's contact details. */
  private async announce(subject: string, heading: string, facts: (string | false | undefined | null)[]): Promise<void> {
    const lines = [heading, ...facts.filter((f): f is string => !!f)];
    lines.push('', `بيانات التواصل في لوحة إدارة المنصة:\n${this.cfg.DASHBOARD_URL}/#/platform/leads`);
    for (const to of await this.repo.adminEmails()) {
      try {
        await this.email.send(to, subject, lines.join('\n'));
      } catch (err) {
        this.logger.error(`Lead email to ${maskEmail(to)} failed: ${(err as Error).message}`);
      }
    }
  }
}
