import { describe, expect, it } from 'vitest';
import { errorText } from '../i18n';
import { fieldIssueText } from '../validation-text';

describe('API errors in Arabic (L10N-003)', () => {
  it('says each field rule in Arabic, never the English message', () => {
    const say = (i: Parameters<typeof fieldIssueText>[0]) => fieldIssueText(i, 'ar');
    expect(say({ path: 'fullName', message: 'String must contain at least 2 character(s)', rule: 'too_small', minimum: 2, kind: 'string' })).toBe('الاسم: 2 أحرف على الأقل');
    expect(say({ path: 'lines.0.unitPriceMinor', message: 'x', rule: 'too_small', minimum: 1, kind: 'number' })).toBe('السعر: لا يقل عن 0.01');
    expect(say({ path: 'email', message: 'Invalid email', rule: 'invalid_string', kind: 'email' })).toBe('البريد الإلكتروني: بريد إلكتروني غير صحيح');
    expect(say({ path: 'fullName', message: 'Required', rule: 'required' })).toBe('الاسم: مطلوب');
    expect(say({ path: 'somethingNew', message: 'x', rule: 'invalid_enum_value' })).toBe('أحد الحقول: اختيار غير صالح');
    expect(say({ path: '', message: "Unrecognized key(s) in object: 'x'", rule: 'unrecognized_keys' })).toBe('بيانات غير متوقعة في الطلب');
    expect(say({ path: 'x', message: 'Expected number, received string' })).toBe('أحد الحقول: قيمة غير صالحة'); // an older API without `rule`
  });
  it('an unknown error code shows Arabic for its status, not the server’s English', () => {
    expect(errorText('session_closed', 409, 'ar')).toBe('خزنة هذا اليوم مقفلة. يمكن لصاحب العيادة إعادة فتحها.');
    expect(errorText('brand_new_code', 409, 'ar')).toBe('تغيّرت البيانات أثناء ذلك. حدّث الصفحة وحاول مرة أخرى.');
    expect(errorText('brand_new_code', 502, 'ar')).toBe('حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل.');
    expect(errorText('brand_new_code', 418, 'ar')).toBe('تعذّر تنفيذ الطلب. راجع البيانات وحاول مرة أخرى.');
    expect(errorText('brand_new_code', undefined, 'ar')).toBe('حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل.');
  });
});
