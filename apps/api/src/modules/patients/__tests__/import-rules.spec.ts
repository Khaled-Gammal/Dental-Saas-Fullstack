import { importDate, importGender, importPhone, parseImportRow } from '../import-rules';

const today = '2026-10-31';

describe('reading a patient row from Excel/CSV (Phase 2A, ONB-03)', () => {
  it('phones as spreadsheets leave them: lost leading 0, no plus, Arabic digits, spaces', () => {
    expect(importPhone('1012345678')).toBe('+201012345678'); // Excel stored 01012345678 as a number
    expect(importPhone('201012345678')).toBe('+201012345678');
    expect(importPhone('٠١٠١٢٣٤٥٦٧٨')).toBe('+201012345678');
    expect(importPhone('010 1234-5678')).toBe('+201012345678');
    expect(importPhone('+966 50 123 4567')).toBe('+966501234567');
    expect(importPhone('12345')).toBeNull();
  });
  it('gender in Arabic or English; blank is unknown, anything else is an error', () => {
    expect([importGender('ذكر'), importGender('أنثى'), importGender('F'), importGender(' Male ')]).toEqual(['male', 'female', 'female', 'male']);
    expect(importGender('')).toBeNull();
    expect(importGender('؟')).toBeUndefined();
    expect(importGender('constructor')).toBeUndefined();
    expect(importGender('__proto__')).toBeUndefined();
  });
  it('birth dates: ISO, slashes, day first; impossible or future dates are errors', () => {
    expect(importDate('1990-03-15', today)).toBe('1990-03-15');
    expect(importDate('15/3/1990', today)).toBe('1990-03-15');
    expect(importDate('١٥-٠٣-١٩٩٠', today)).toBe('1990-03-15');
    expect(importDate('1990/3/5', today)).toBe('1990-03-05');
    expect(importDate('31/2/1990', today)).toBeUndefined();
    expect(importDate('1/1/2030', today)).toBeUndefined();
    expect(importDate('3/15/1990', today)).toBeUndefined(); // month first is not how Egypt writes it
    expect(importDate('', today)).toBeNull();
    expect(importDate('1990-03-15 00:00:00', today)).toBe('1990-03-15'); // a date cell exported with its time
  });
  it('a good row becomes a record; spaces are tidied; the second phone is dropped when it repeats the first', () => {
    const r = parseImportRow({ fullName: '  محمد   أحمد ', phone: '01012345678', phoneAlt: '+201012345678', email: ' Mo@Example.COM ', gender: 'ذكر', dateOfBirth: '1/2/1985', city: 'القاهرة' }, today);
    expect(r.errors).toEqual([]);
    expect(r.patient).toMatchObject({ full_name: 'محمد أحمد', phone: '+201012345678', phone_alt: null, email: 'mo@example.com', gender: 'male', date_of_birth: '1985-02-01', city: 'القاهرة', notes: null });
    expect(parseImportRow({ fullName: 'منى', phone: '01012345678', notes: 'سطر  أول\r\nسطر ثان ' }, today).patient?.notes).toBe('سطر أول\nسطر ثان');
  });
  it('every problem of a row is reported, not just the first', () => {
    const r = parseImportRow({ fullName: 'م', phone: '', email: 'not-an-email', gender: 'x', dateOfBirth: '2/30/1990', notes: 'x'.repeat(2001) }, today);
    expect(r.patient).toBeNull();
    expect(r.errors).toEqual([
      { field: 'fullName', code: 'invalid' }, { field: 'phone', code: 'required' }, { field: 'email', code: 'invalid' },
      { field: 'gender', code: 'invalid' }, { field: 'dateOfBirth', code: 'invalid' }, { field: 'notes', code: 'too_long' },
    ]);
  });
});
