import { ageOn, auditChanges, classifySearch, cleanList, cleanTags, decodeCursor, encodeCursor, escapeLike, NEEDS_REVIEW, mergeConflicts, unionList } from '../patient-rules';

describe('classifySearch', () => {
  it('empty is the full list', () => {
    expect(classifySearch('')).toEqual({ kind: 'all' });
    expect(classifySearch('   ')).toEqual({ kind: 'all' });
    expect(classifySearch(undefined)).toEqual({ kind: 'all' });
  });
  it('a full Egyptian mobile in any spelling is one exact number', () => {
    for (const q of ['01012345678', '+201012345678', '201012345678', '010 1234 5678', '٠١٠١٢٣٤٥٦٧٨']) {
      expect(classifySearch(q)).toEqual({ kind: 'phone', e164: '+201012345678' });
    }
  });
  it('the start of a local number becomes an E.164 prefix', () => {
    expect(classifySearch('0101')).toEqual({ kind: 'phonePrefix', prefix: '+20101' });
    expect(classifySearch('+2010')).toEqual({ kind: 'phonePrefix', prefix: '+2010' });
  });
  it('a short number is a file number (or a phone prefix)', () => {
    expect(classifySearch('42')).toEqual({ kind: 'fileOrPhone', fileNo: 42, prefix: '+42' });
    expect(classifySearch('١٢')).toEqual({ kind: 'fileOrPhone', fileNo: 12, prefix: '+12' });
  });
  it('anything with letters is a name, whitespace collapsed', () => {
    expect(classifySearch('  أحمد   صلاح ')).toEqual({ kind: 'name', text: 'أحمد صلاح' });
    expect(classifySearch('Omar 2')).toEqual({ kind: 'name', text: 'Omar 2' });
  });
});

describe('escapeLike', () => {
  it('makes wildcards literal', () => expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b'));
});

describe('keyset cursor', () => {
  it('round-trips and rejects junk', () => {
    const at = new Date('2026-10-16T10:00:00.123Z');
    const id = '70000000-0000-0000-0000-0000000000a1';
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ createdAt: at, id });
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe('ageOn', () => {
  it('counts whole years, birthday not yet reached', () => {
    expect(ageOn('2010-10-17', '2026-10-16')).toBe(15);
    expect(ageOn('2010-10-16', '2026-10-16')).toBe(16);
    expect(ageOn(null, '2026-10-16')).toBeNull();
  });
});

describe('auditChanges', () => {
  it('keeps old/new for plain fields and hides free text', () => {
    const before = { full_name: 'Omar', phone: '+201011111111', notes: 'old note', city: null };
    const after = { full_name: 'Omar Khaled', phone: '+201011111111', notes: 'new note', city: 'Cairo' };
    expect(auditChanges(before, after)).toEqual({ full_name: ['Omar', 'Omar Khaled'], notes: true, city: [null, 'Cairo'] });
  });
  it('medical lists are never logged by value', () => {
    expect(auditChanges({ allergies: [] }, { allergies: ['penicillin'] })).toEqual({ allergies: true });
  });
  it('nothing changed, nothing logged', () => {
    expect(auditChanges({ tags: ['vip'] }, { tags: ['vip'] })).toEqual({});
  });
});

describe('cleaning lists', () => {
  it('tags: trimmed, unique, review tag stripped', () => {
    expect(cleanTags([' vip ', 'vip', '', NEEDS_REVIEW, 'ortho'])).toEqual(['vip', 'ortho']);
  });
  it('medical items: unique case-insensitively', () => {
    expect(cleanList(['Penicillin', 'penicillin ', ' ', 'Latex'])).toEqual(['Penicillin', 'Latex']);
  });
});

describe('merge rules (PATIENT-003, CLR-15)', () => {
  it('lists the fields where both records differ; empty values and case differences are not conflicts', () => {
    const a: Record<string, string | null> = { full_name: 'Hala Samir', phone: '+201077700001', email: null, city: 'Cairo', notes: 'x' };
    const b = { full_name: 'HALA SAMIR', phone: '+201077700002', email: 'h@x.test', city: '', notes: 'y' };
    expect(mergeConflicts(a, b, ['full_name', 'phone', 'email', 'city', 'notes'])).toEqual([
      { field: 'phone', survivor: '+201077700001', merged: '+201077700002' }, { field: 'notes', survivor: 'x', merged: 'y' },
    ]);
  });
  it('combines lists without losing an item or repeating one', () => {
    expect(unionList(['Penicillin'], ['penicillin ', 'Latex'])).toEqual(['Penicillin', 'Latex']);
    expect(unionList([], ['سكري'])).toEqual(['سكري']);
  });
});
