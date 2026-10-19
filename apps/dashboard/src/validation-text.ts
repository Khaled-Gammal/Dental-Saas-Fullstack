/**
 * Field problems from the API in Arabic (L10N-003). The API sends the Zod rule and its limits next to an English
 * message meant for developers; this turns the rule into Arabic and never shows the English. Pure; unit-tested.
 */
import { t, tOr, type Lang } from './i18n';

export interface FieldIssue { path: string; message: string; rule?: string; minimum?: number; maximum?: number; kind?: string }

/** "المبلغ: لا يقل عن 0.01" — the field's label (or «أحد الحقول») and what is wrong with it. */
export function fieldIssueText(i: FieldIssue, lang: Lang): string {
  const field = i.path.split('.').filter((s) => !/^\d+$/.test(s)).pop() ?? '';
  const money = field.endsWith('Minor');
  const n = (v: number | undefined) => String(v === undefined ? '' : money ? v / 100 : v);
  const fill = (key: Parameters<typeof t>[0], v?: number) => t(key, lang).replace('{n}', n(v));
  let rule: string;
  switch (i.rule) {
    case 'required': rule = t('v_required', lang); break;
    case 'too_small':
      rule = i.kind === 'string' ? (i.minimum !== undefined && i.minimum <= 1 ? t('v_required', lang) : fill('v_min_chars', i.minimum))
        : i.kind === 'number' || i.kind === 'bigint' ? fill('v_min_number', i.minimum)
        : i.kind === 'array' ? t('v_min_items', lang) : t('v_invalid', lang);
      break;
    case 'too_big':
      rule = i.kind === 'string' ? fill('v_max_chars', i.maximum)
        : i.kind === 'number' || i.kind === 'bigint' ? fill('v_max_number', i.maximum)
        : i.kind === 'array' ? fill('v_max_items', i.maximum) : t('v_invalid', lang);
      break;
    case 'invalid_string': rule = t(i.kind === 'email' ? 'v_email' : 'v_format', lang); break;
    case 'invalid_enum_value': case 'invalid_literal': case 'invalid_union': case 'invalid_union_discriminator': rule = t('v_choice', lang); break;
    case 'unrecognized_keys': return t('v_unexpected', lang);
    default: rule = t('v_invalid', lang);
  }
  return `${field ? tOr(`vf_${field}`, lang, t('v_field', lang)) : t('v_field', lang)}: ${rule}`;
}
