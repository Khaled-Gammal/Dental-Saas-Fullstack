import { z } from 'zod';
import { normalizePhone } from '../../shared/phone';

const Text = (max: number) => z.string().trim().max(max).transform((v) => v || undefined).optional();

/**
 * LND-04: a clinic asks for a call. Name and phone are required; the rest helps the call. `website` is a honeypot:
 * the form hides it, so only a bot fills it in.
 */
export const NewLead = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'phone' });
    return p ?? '';
  }),
  email: z.string().trim().toLowerCase().max(254).email().optional().or(z.literal('').transform(() => undefined)),
  clinicName: Text(150),
  city: Text(80),
  message: Text(2000),
  planCode: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/).optional(),
  source: z.string().trim().regex(/^[a-z0-9_:.-]{1,100}$/).optional(),
  website: z.string().max(500).optional(),
}).strict();
export type NewLeadInput = z.infer<typeof NewLead>;
