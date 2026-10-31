import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AUTH_POLICY, PLATFORM_POLICY } from '../../config';
import { TokenService } from '../../auth/token.service';
import type { RequestContext } from '../../shared/context/request-context';
import { Err } from '../../shared/errors/app-error';
import { maskEmail } from '../../shared/mask';
import { RATE_LIMITER, type RateLimiter } from '../../shared/rate-limit/ports';
import { endOfDay } from '../../shared/time/clinic-time';
import { DUMMY_HASH, verifyPassword } from '../identity/crypto';
import type { RequestMeta } from '../identity/identity.types';
import { Accounts } from '../identity/accounts.service';
import { OtpService } from '../identity/otp.service';
import type { EditPlanInput, NewPlanInput } from './platform.schemas';
import { PlatformRepository } from './platform.repository';

const { login: L } = AUTH_POLICY;
const LOCKED = `Too many attempts. Try again in ${Math.ceil(L.windowSeconds / 60)} minutes.`;
const invalid = () => Err.unauthorized('invalid_credentials', 'Email or password is not correct');
const clinicNotFound = () => Err.notFound('clinic_not_found', 'Clinic not found');

/**
 * The platform admin panel (H5; ADM-01, ADM-02, ADM-04). Sign-in is a password and then a code emailed to the admin
 * (owner's choice), every time; the session is a short platform token in an httpOnly cookie. Every action names the
 * admin, and the database functions check them again and write the platform audit log.
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    private readonly repo: PlatformRepository,
    private readonly otp: OtpService,
    private readonly accounts: Accounts,
    private readonly tokens: TokenService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private admin(): string {
    const id = this.cls.get('platformUserId');
    if (!id) throw Err.unauthorized('platform_session_required', 'Sign in to the platform panel');
    return id;
  }

  // ---------- sign-in ----------
  /** Step 1: the password. A wrong one, an unknown account and a clinic user all get the same answer. */
  async login(email: string, password: string, meta: RequestMeta) {
    const deviceKey = `platform-login:${email}:${meta.ip ?? '-'}`;
    await this.limiter.enforce(deviceKey, L.perAccountIp, L.windowSeconds, LOCKED, 'login_locked');
    await this.limiter.enforce(`platform-login:${email}`, L.perAccount, L.windowSeconds, LOCKED, 'login_locked');
    const user = await this.repo.loginCandidate(email);
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH); // always hash: timing reveals nothing
    if (!user || !ok || !user.is_active || !user.email || !(await this.repo.isAdmin(user.id))) throw invalid();
    await this.limiter.reset(deviceKey);
    await this.accounts.upgradeHash(user.id, user.password_hash, password); // review R11: peppered from now on
    await this.otp.sendByEmail(user.email, 'login', meta, PLATFORM_POLICY.codeSubject, user.id);
    return { codeSent: true, maskedEmail: maskEmail(user.email) };
  }

  /** Step 2: the emailed code. Returns the platform token (set as a cookie by the controller). */
  async verify(email: string, code: string, meta: RequestMeta): Promise<{ token: string; me: Awaited<ReturnType<PlatformService['me']>> }> {
    const user = await this.repo.loginCandidate(email);
    if (!user?.email || !user.is_active || !(await this.repo.isAdmin(user.id))) throw invalid();
    await this.otp.verify(user.email.toLowerCase(), 'login', code, meta, async () => undefined);
    await this.repo.record(user.id, 'platform.sign_in', null, {}, meta.ip ?? null);
    return { token: await this.tokens.signPlatform(user.id), me: await this.me(user.id) };
  }

  async me(userId = this.admin()) {
    const u = await this.repo.me(userId);
    if (!u) throw Err.unauthorized('platform_session_required', 'Sign in to the platform panel');
    return { id: u.id, name: u.full_name, email: u.email };
  }

  // ---------- clinics (ADM-01, ADM-02) ----------
  /** Every clinic; one its owner deleted carries `deletion` (asked when, erased when). */
  async clinics() {
    const [list, deletions] = await Promise.all([this.repo.clinics(this.admin()), this.repo.deletions(this.admin())]);
    return list.map((c) => ({ ...c, deletion: deletions.get(c.id) ?? null }));
  }

  async clinic(id: string) {
    const c = (await this.clinics()).find((x) => x.id === id);
    if (!c) throw clinicNotFound();
    const [notes, history] = await Promise.all([this.repo.notes(this.admin(), id), this.repo.audit(id)]);
    return { ...c, notes, history };
  }

  /** H8: a clinic its owner deleted comes back as it was, within its 90 days */
  async restore(id: string) {
    await this.repo.restore(this.admin(), id);
    return this.clinic(id);
  }

  async extendTrial(id: string, until: string) {
    // the trial ends at the end of the chosen day in Cairo — +02:00 or +03:00 depending on daylight saving time
    // (review R11: the fixed +02:00 ended summer trials an hour late)
    await this.repo.extendTrial(this.admin(), id, new Date(endOfDay(until, 'Africa/Cairo')).toISOString());
    return this.clinic(id);
  }

  async suspend(id: string, reason: string) {
    await this.repo.suspend(this.admin(), id, reason);
    return this.clinic(id);
  }

  async reactivate(id: string) {
    await this.repo.reactivate(this.admin(), id);
    return this.clinic(id);
  }

  /** The clinic paid (outside the system for now): its subscription is active for a month or a year; a trial-ended suspension is lifted. */
  async activate(id: string, cycle: 'monthly' | 'yearly') {
    await this.repo.activate(this.admin(), id, cycle);
    return this.clinic(id);
  }

  async changePlan(id: string, planId: string) {
    await this.repo.changePlan(this.admin(), id, planId);
    return this.clinic(id);
  }

  async addNote(id: string, body: string) {
    const actor = this.admin();
    await this.repo.addNote(actor, id, body); // the function checks the admin and the clinic
    return this.repo.notes(actor, id);
  }

  audit() {
    this.admin();
    return this.repo.audit(null, 100);
  }

  // ---------- legal documents (H6, NFR-15) ----------
  legalVersions() {
    this.admin();
    return this.repo.legalVersions();
  }

  /** A new version of a document; `requiresReacceptance`: those who accepted an older one accept it at their next sign-in. */
  async publishLegal(kind: string, title: string, body: string, requiresReacceptance: boolean) {
    await this.repo.publishLegal(this.admin(), kind, title, body, requiresReacceptance);
    return this.repo.legalVersions();
  }

  // ---------- requests from the landing page's contact form (H7, LND-04) ----------
  leads() { return this.repo.leads(this.admin()); }

  async setLeadStatus(id: string, status: string) {
    await this.repo.setLeadStatus(this.admin(), id, status);
    return this.repo.leads(this.admin());
  }

  // ---------- plans (ADM-04) ----------
  plans() {
    return this.repo.plans(this.admin());
  }

  /** Prices, trial length, limits and features of a plan; limits and features merge into what the plan has (in the database). */
  async editPlan(id: string, input: EditPlanInput, ip: string | null) {
    await this.repo.updatePlan(this.admin(), id, planColumns(input), ip);
    return (await this.repo.plans(this.admin())).find((p) => p.id === id);
  }

  /** A new plan (owner 2026-10-24), placed after the others; its code must be free. */
  async createPlan(input: NewPlanInput, ip: string | null) {
    const id = await this.repo.createPlan(this.admin(), { code: input.code, ...planColumns(input) }, ip);
    return (await this.repo.plans(this.admin())).find((p) => p.id === id);
  }
}

/** The API's plan fields as the database's columns, only those given. */
function planColumns(input: EditPlanInput): Record<string, unknown> {
  return {
    ...(input.nameAr !== undefined && { name_ar: input.nameAr }),
    ...(input.priceMonthlyMinor !== undefined && { price_monthly_minor: input.priceMonthlyMinor }),
    ...(input.priceYearlyMinor !== undefined && { price_yearly_minor: input.priceYearlyMinor }),
    ...(input.trialDays !== undefined && { trial_days: input.trialDays }),
    ...(input.limits && { limits: input.limits }),
    ...(input.features && { features: input.features }),
    ...(input.isPublic !== undefined && { is_public: input.isPublic }),
  };
}
