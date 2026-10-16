import { Inject, Injectable } from '@nestjs/common';
import { Err } from '../../../shared/errors/app-error';
import { effectivePaymentMode, HOLD_MINUTES } from '../domain/booking-policy';
import { dateInZone, safeTimeZone } from '../../../shared/time/clinic-time';
import { GetAvailability } from './get-availability.usecase';
import { CLOCK, SCHEDULING_REPOSITORY, type Clock, type SchedulingRepository, type TenantScope } from './ports';

export interface HoldSlotInput { branchId: string; serviceId: string; doctorId?: string; startsAt: Date }

export interface Hold { holdId: string; doctorId: string; startsAt: Date; endsAt: Date; expiresAt: Date; otpRequired: boolean }

/**
 * Step 1 of online booking (SRS 4.11): reserve the slot as a `held` appointment for 10 minutes.
 * The slot must come from today's availability (hours, schedule, notice), then the database's exclusion
 * constraint settles a race between two visitors: the loser gets 409 `slot_taken`.
 */
@Injectable()
export class HoldSlot {
  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly repo: SchedulingRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly availability: GetAvailability,
  ) {}

  execute(scope: TenantScope, input: HoldSlotInput): Promise<Hold> {
    return scope.run(async (tx, tenantId) => {
      const policy = await this.repo.policy(tx);
      const branchTz = await this.repo.branchTimezone(tx, input.branchId);
      if (branchTz === undefined) throw Err.notFound('branch_not_found', 'Branch not found');
      const date = dateInZone(input.startsAt.getTime(), safeTimeZone(branchTz ?? policy.timezone)); // bad zone data falls back, like the slot search

      const day = await this.availability.forDate(tx, { ...input, date, policy, online: true });
      const slot = day.slots.find((s) => s.startsAt.getTime() === input.startsAt.getTime());
      if (!slot) throw Err.conflict('slot_unavailable', 'That time is no longer available; pick another slot');
      // "any doctor": the first free one. Spreading load between doctors is a later refinement.
      const doctorId = input.doctorId ?? slot.doctorIds[0];

      await this.repo.releaseExpiredHolds(tx, doctorId); // SRS 4.11 step 1
      const now = this.clock.now().getTime();
      const endsAt = new Date(input.startsAt.getTime() + day.durationMinutes * 60_000);
      const expiresAt = new Date(now + HOLD_MINUTES * 60_000);
      const { id } = await this.repo.insertHold(tx, {
        tenantId, branchId: input.branchId, doctorId, serviceId: input.serviceId, startsAt: input.startsAt, endsAt, holdExpiresAt: expiresAt,
        quotedPriceMinor: day.service?.price_minor ?? null, paymentMode: effectivePaymentMode(policy),
      });
      return { holdId: id, doctorId, startsAt: input.startsAt, endsAt, expiresAt, otpRequired: policy.otpRequired };
    });
  }
}
