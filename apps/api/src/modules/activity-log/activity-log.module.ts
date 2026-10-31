import { Module } from '@nestjs/common';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogRepository } from './activity-log.repository';
import { ActivityLogService } from './activity-log.service';

/** Phase 2D: the clinic's activity log screen (reads audit_log; the writing is AuditLog's and the database triggers'). */
@Module({ controllers: [ActivityLogController], providers: [ActivityLogService, ActivityLogRepository] })
export class ActivityLogModule {}
