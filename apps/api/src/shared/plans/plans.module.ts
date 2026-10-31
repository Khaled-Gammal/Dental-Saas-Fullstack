import { Global, Module } from '@nestjs/common';
import { PlanLimits } from './plan-limits.service';
import { ClinicPlanController } from './plans.controller';

/** Plan limits and feature flags, read from the clinic's subscription. Global: any write path may need them. */
@Global()
@Module({ controllers: [ClinicPlanController], providers: [PlanLimits], exports: [PlanLimits] }) // Phase 1D: GET /clinic/plan
export class PlansModule {}
