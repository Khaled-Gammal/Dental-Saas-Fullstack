import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

/**
 * Reports (SRS REPORT-001…005): revenue and collections, expenses, attendance, outstanding balances, branch and doctor
 * performance. Read-only; the sums come from database functions that run under the caller's row-level security.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportsRepository],
})
export class ReportsModule {}
