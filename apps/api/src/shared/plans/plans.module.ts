import { Global, Module } from '@nestjs/common';
import { PlanLimits } from './plan-limits.service';

/** Plan limits and feature flags, read from the clinic's subscription. Global: any write path may need them. */
@Global()
@Module({ providers: [PlanLimits], exports: [PlanLimits] })
export class PlansModule {}
