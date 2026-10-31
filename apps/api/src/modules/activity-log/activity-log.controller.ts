import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { ActivityQuery } from './activity-log.schemas';
import { ActivityLogService } from './activity-log.service';

/** Phase 2D: the clinic's activity log (DSH-15). For whoever the owner gives `audit:read`. */
@ApiTags('clinic')
@ApiBearerAuth()
@Controller('activity-log')
@RequirePermission('audit:read')
export class ActivityLogController {
  constructor(private readonly log: ActivityLogService) {}

  @Get()
  list(@Query(new ZodBody(ActivityQuery)) q: z.infer<typeof ActivityQuery>) {
    return this.log.list(q);
  }

  /** The members who may appear in it (the filter). */
  @Get('actors')
  actors() {
    return this.log.actors();
  }
}
