import { Inject, Injectable } from '@nestjs/common';
import { bookableDates, type BookingPolicy } from '../domain/booking-policy';
import { safeTimeZone } from '../../../shared/time/clinic-time';
import { CLOCK, SCHEDULING_REPOSITORY, type BookingOptions, type Clock, type SchedulingRepository, type TenantScope } from './ports';

export interface BookingOptionsView extends BookingOptions {
  policy: Pick<BookingPolicy, 'otpRequired' | 'minNoticeMinutes' | 'maxDaysAhead' | 'slotStepMinutes' | 'timezone'>;
  dates: { first: string; last: string };
}

/** Everything the website's booking wizard needs to start: branches, bookable services, doctors and the clinic's rules. */
@Injectable()
export class GetBookingOptions {
  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly repo: SchedulingRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(scope: TenantScope): Promise<BookingOptionsView> {
    return scope.run(async (tx) => {
      const policy = await this.repo.policy(tx);
      const timezone = safeTimeZone(policy.timezone);
      const options = await this.repo.options(tx);
      const { otpRequired, minNoticeMinutes, maxDaysAhead, slotStepMinutes } = policy;
      return { ...options, policy: { otpRequired, minNoticeMinutes, maxDaysAhead, slotStepMinutes, timezone }, dates: bookableDates(this.clock.now().getTime(), { ...policy, timezone }) };
    });
  }
}
