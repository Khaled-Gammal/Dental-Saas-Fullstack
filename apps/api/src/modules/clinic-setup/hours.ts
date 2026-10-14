import { z } from 'zod';

/** "HH:MM" 24h, 00:00-23:59. */
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time as HH:MM');
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const MAX_SHIFTS_PER_DAY = 3;

const Shift = z.object({ opens: Time, closes: Time })
  .refine((s) => toMinutes(s.closes) > toMinutes(s.opens), { message: 'closing time must be after opening time' });

const Day = z.object({
  weekday: z.number().int().min(0).max(6), // 0 = Sunday … 6 = Saturday
  shifts: z.array(Shift).max(MAX_SHIFTS_PER_DAY),
}).superRefine((d, ctx) => {
  const sorted = [...d.shifts].sort((a, b) => toMinutes(a.opens) - toMinutes(b.opens));
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i].opens) < toMinutes(sorted[i - 1].closes)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'shifts on the same day overlap', path: ['shifts'] });
      return;
    }
  }
});

/**
 * A whole week, replaced in one go. Days that are missing or have no shifts are closed.
 * The same rules exist in the database (CHECK closes_at > opens_at, EXCLUDE overlapping shifts);
 * checking here first gives the user a clear message instead of a constraint error.
 */
export const WeeklyHours = z.object({
  days: z.array(Day).max(7).refine((ds) => new Set(ds.map((d) => d.weekday)).size === ds.length, { message: 'each weekday once' }),
});
export type WeeklyHoursInput = z.infer<typeof WeeklyHours>;

/** Flat rows for branch_hours. */
export function toRows(input: WeeklyHoursInput) {
  return input.days.flatMap((d) => d.shifts.map((s) => ({ weekday: d.weekday, opens_at: s.opens, closes_at: s.closes })));
}
