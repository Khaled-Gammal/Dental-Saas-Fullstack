/**
 * Field problems from the API in Arabic (L10N-003). The API sends the Zod rule and its limits next to an English
 * message meant for developers; this turns the rule into Arabic and never shows the English. Pure; unit-tested.
 */
import { validationFieldLabel } from './labels';

export interface FieldIssue { path: string; message: string; rule?: string; minimum?: number; maximum?: number; kind?: string }

/** "المبلغ: لا يقل عن 0.01" — the field's label (or «أحد الحقول») and what is wrong with it. */
export function fieldIssueText(i: FieldIssue): string {
  const field = i.path.split('.').filter((s) => !/^\d+$/.test(s)).pop() ?? '';
  const money = field.endsWith('Minor');
  const n = (v: number | undefined) => String(v === undefined ? '' : money ? v / 100 : v);
  const fill = (key: string, v?: number) => key.replace('{n}', n(v));
  let rule: string;
  switch (i.rule) {
    case 'required': rule = 'مطلوب'; break;
    case 'too_small':
      rule = i.kind === 'string' ? (i.minimum !== undefined && i.minimum <= 1 ? 'مطلوب' : fill('{n} أحرف على الأقل', i.minimum))
        : i.kind === 'number' || i.kind === 'bigint' ? fill('لا يقل عن {n}', i.minimum)
        : i.kind === 'array' ? 'عنصر واحد على الأقل' : 'قيمة غير صالحة';
      break;
    case 'too_big':
      rule = i.kind === 'string' ? fill('{n} حرفًا على الأكثر', i.maximum)
        : i.kind === 'number' || i.kind === 'bigint' ? fill('لا يزيد عن {n}', i.maximum)
        : i.kind === 'array' ? fill('{n} عناصر على الأكثر', i.maximum) : 'قيمة غير صالحة';
      break;
    case 'invalid_string': rule = i.kind === 'email' ? 'بريد إلكتروني غير صحيح' : 'الصيغة غير صحيحة'; break;
    case 'invalid_enum_value': case 'invalid_literal': case 'invalid_union': case 'invalid_union_discriminator': rule = 'اختيار غير صالح'; break;
    case 'unrecognized_keys': return 'بيانات غير متوقعة في الطلب';
    default: rule = 'قيمة غير صالحة';
  }
  return `${field ? (validationFieldLabel[field] ?? 'أحد الحقول') : 'أحد الحقول'}: ${rule}`;
}
