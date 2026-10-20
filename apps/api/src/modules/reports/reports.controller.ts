import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { ReportQuery } from './reports.schemas';
import { ReportsService } from './reports.service';

type Q = z.infer<typeof ReportQuery>;

/**
 * Reports (SRS REPORT-001…005). Rights are checked in the service because they depend on the report and the period:
 * reports:read sees all; reports:read:daily (reception) today's revenue only; reports:read:own (doctors) their own
 * attendance and performance.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** REPORT-006: the signed-in member's home figures (every member; blocks follow their rights) */
  @Get('home')
  home() {
    return this.reports.home();
  }

  @Get('branches')
  branches() {
    return this.reports.branches();
  }

  @Get('revenue')
  revenue(@Query(new ZodBody(ReportQuery)) q: Q) {
    return this.reports.revenue(q);
  }

  @Get('expenses')
  expenses(@Query(new ZodBody(ReportQuery)) q: Q) {
    return this.reports.expenses(q);
  }

  @Get('attendance')
  attendance(@Query(new ZodBody(ReportQuery)) q: Q) {
    return this.reports.attendance(q);
  }

  @Get('outstanding')
  outstanding(@Query(new ZodBody(ReportQuery)) q: Q) {
    return this.reports.outstanding(q);
  }

  @Get('performance')
  performance(@Query(new ZodBody(ReportQuery)) q: Q) {
    return this.reports.performance(q);
  }

  /** statistics for the overview: a period against the one before, a chart series, what is owed now (reports:read) */
  @Get('stats')
  stats(@Query(new ZodBody(ReportQuery)) q: Q) {
    return this.reports.stats(q);
  }
}
