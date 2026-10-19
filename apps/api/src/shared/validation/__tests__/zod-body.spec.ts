import type { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../zod-body.pipe';

const errorsOf = (schema: z.ZodTypeAny, body: unknown) => {
  try {
    new ZodBody(schema).transform(body);
  } catch (e) {
    return ((e as BadRequestException).getResponse() as { errors: Record<string, unknown>[] }).errors;
  }
  throw new Error('expected a validation error');
};

describe('validation issues carry a rule the dashboard can say in Arabic (L10N-003)', () => {
  const S = z.object({ fullName: z.string().min(2), age: z.number().max(120), email: z.string().email(), kind: z.enum(['a', 'b']) }).strict();
  it('names the rule and its limit, keeps the English message for developers', () => {
    const errs = errorsOf(S, { fullName: 'x', age: 130, email: 'nope', kind: 'c', extra: 1 });
    expect(errs).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'fullName', rule: 'too_small', minimum: 2, kind: 'string', message: expect.any(String) }),
      expect.objectContaining({ path: 'age', rule: 'too_big', maximum: 120, kind: 'number' }),
      expect.objectContaining({ path: 'email', rule: 'invalid_string', kind: 'email' }),
      expect.objectContaining({ path: 'kind', rule: 'invalid_enum_value' }),
      expect.objectContaining({ path: '', rule: 'unrecognized_keys' }),
    ]));
  });
  it('a missing field is "required"', () => {
    expect(errorsOf(S, { age: 1, email: 'a@b.co', kind: 'a' })).toEqual([expect.objectContaining({ path: 'fullName', rule: 'required' })]);
  });
});
