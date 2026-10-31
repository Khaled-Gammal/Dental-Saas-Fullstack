import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators';
import { TenantDb } from '../database/tenant-db.service';
import { PlanLimits } from './plan-limits.service';

@ApiTags('clinic')
@ApiBearerAuth()
@Controller('clinic/plan')
export class ClinicPlanController {
  constructor(
    private readonly db: TenantDb,
    private readonly plans: PlanLimits,
  ) {}

  /**
   * Phase 1D (BIL-01): the clinic's plan, subscription status, limits, features and current usage — the dashboard's
   * "your plan" card. For whoever manages the clinic's settings (the owner by default).
   */
  @Get()
  @RequirePermission('settings:write')
  get() {
    return this.db.run((tx, tenantId) => this.plans.summary(tx, tenantId));
  }
}
