import { z } from 'zod';
import { ISO_DATE } from '../../shared/time/clinic-time';

/** REPORT-001…005: a period (default: the month so far; reception: today) and optionally one branch. */
export const ReportQuery = z.object({
  from: z.string().regex(ISO_DATE).optional(), to: z.string().regex(ISO_DATE).optional(), branchId: z.string().uuid().optional(),
}).strict();

export type ReportQueryInput = z.infer<typeof ReportQuery>;
