import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from '@dental/db';
import { TenantDb } from '../../shared/database/tenant-db.service';

export interface OnboardingStatus {
  profile: boolean;
  branches: boolean;
  hours: boolean;
  doctors: boolean;
  services: boolean;
  published: boolean;
  /** the draft differs from what visitors see: show a Publish button */
  pendingChanges: boolean;
}

/** Setup checklist, derived from the data itself (nothing to keep in sync), in ONE query. */
@Injectable()
export class OnboardingRepository {
  constructor(private readonly db: TenantDb) {}

  status(): Promise<OnboardingStatus> {
    return this.db.run(async (tx) => {
      const { rows } = await sql<OnboardingStatus>`
        select
          coalesce((select t.primary_phone is not null and coalesce(t.about_ar, t.about_en) is not null from tenants t), false) as profile,
          exists (select 1 from branches where is_active)                          as branches,
          exists (select 1 from branch_hours h join branches b on b.id = h.branch_id where b.is_active) as hours,
          exists (select 1 from doctors where is_active)                           as doctors,
          exists (select 1 from services where is_active)                          as services,
          exists (select 1 from sites where status = 'published')                  as published,
          coalesce((select published_theme is distinct from draft_theme from sites), false) as pending_changes`.execute(tx);
      const r = rows[0] as OnboardingStatus & { pending_changes?: boolean };
      return { profile: r.profile, branches: r.branches, hours: r.hours, doctors: r.doctors, services: r.services, published: r.published, pendingChanges: !!r.pending_changes };
    });
  }
}

@ApiTags('clinic')
@ApiBearerAuth()
@Controller('clinic/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingRepository) {}

  @Get()
  status() {
    return this.onboarding.status();
  }
}
