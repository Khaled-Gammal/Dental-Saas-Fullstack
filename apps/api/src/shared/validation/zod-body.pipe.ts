import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

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
        errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}
