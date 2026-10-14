import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/** Validates a request body with a Zod schema: @Body(new ZodBody(schema)) */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

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
