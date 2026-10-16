import { z } from 'zod';

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time as HH:MM');
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const Slot = z.object({ branchId: z.string().uuid(), weekday: z.number().int().min(0).max(6), starts: Time, ends: Time })
  .refine((s) => minutes(s.ends) > minutes(s.starts), { message: 'end must be after start' });

/**
 * A doctor's week: a flat list of (branch, weekday, from, to). Checked here for overlaps across ALL branches
 * on the same weekday (a doctor cannot be in two places at once); the database's EXCLUDE constraint is the final guard.
 */
export const DoctorSchedule = z.object({ slots: z.array(Slot).max(7 * 4) }).superRefine((v, ctx) => {
  const byDay = new Map<number, { s: number; e: number }[]>();
  for (const x of v.slots) byDay.set(x.weekday, [...(byDay.get(x.weekday) ?? []), { s: minutes(x.starts), e: minutes(x.ends) }]);
  for (const [weekday, ranges] of byDay) {
    ranges.sort((a, b) => a.s - b.s);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].s < ranges[i - 1].e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `overlapping times on weekday ${weekday}`, path: ['slots'] });
        return;
      }
    }
  }
});
export type DoctorScheduleInput = z.infer<typeof DoctorSchedule>;

export const toScheduleRows = (v: DoctorScheduleInput) =>
  v.slots.map((s) => ({ branch_id: s.branchId, weekday: s.weekday, starts_at: s.starts, ends_at: s.ends }));
