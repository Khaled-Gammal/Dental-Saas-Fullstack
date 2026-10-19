import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodIssue, ZodType, ZodTypeDef } from 'zod';

/**
 * One field problem. `message` stays English for developers; `rule` (the Zod issue code) and its limits let the
 * dashboard say it in Arabic (L10N-003) without parsing English.
 */
export function issue(i: ZodIssue): { path: string; message: string; rule: string; minimum?: number; maximum?: number; kind?: string } {
  const out: ReturnType<typeof issue> = { path: i.path.join('.'), message: i.message, rule: i.code };
  if (i.code === 'too_small') Object.assign(out, { minimum: Number(i.minimum), kind: i.type });
  if (i.code === 'too_big') Object.assign(out, { maximum: Number(i.maximum), kind: i.type });
  if (i.code === 'invalid_string') out.kind = typeof i.validation === 'string' ? i.validation : 'format';
  if (i.code === 'invalid_type' && i.received === 'undefined') out.rule = 'required';
  return out;
}

/** Validates a request body with a Zod schema: @Body(new ZodBody(schema)) */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  // input typed as unknown: schemas with .default()/.catch()/.transform() (input != output) still infer T
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        message: 'Invalid request body',
        code: 'validation_failed',
        errors: r.error.issues.map(issue),
      });
    }
    return r.data;
  }
}
