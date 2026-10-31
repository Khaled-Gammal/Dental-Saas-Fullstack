import { randomBytes, scryptSync } from 'node:crypto';
import { DUMMY_HASH, hashPassword, needsRehash, verifyPassword } from '../crypto';

/** A hash as stored before the pepper (review R11): scrypt of the password itself. */
function legacyHash(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return `scrypt$16384$8$1$${b64(salt)}$${b64(key)}`;
}

describe('password hashing with a pepper (review R11)', () => {
  const before = process.env.PASSWORD_PEPPER;
  afterEach(() => { if (before === undefined) delete process.env.PASSWORD_PEPPER; else process.env.PASSWORD_PEPPER = before; });

  it('new hashes are peppered and verify only the right password', async () => {
    const h = await hashPassword('Secret123');
    expect(h.startsWith('pscrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('Secret123', h)).toBe(true);
    expect(await verifyPassword('Secret124', h)).toBe(false);
    expect(needsRehash(h)).toBe(false);
  });

  it('a copy of the hash is useless without the pepper', async () => {
    process.env.PASSWORD_PEPPER = 'first-pepper-for-the-test-0000000000';
    const h = await hashPassword('Secret123');
    process.env.PASSWORD_PEPPER = 'other-pepper-for-the-test-000000000';
    expect(await verifyPassword('Secret123', h)).toBe(false);
  });

  it('hashes made before the pepper still verify, and are marked for replacement', async () => {
    const old = legacyHash('Secret123');
    expect(await verifyPassword('Secret123', old)).toBe(true);
    expect(await verifyPassword('Wrong1234', old)).toBe(false);
    expect(needsRehash(old)).toBe(true);
  });

  it('nothing else verifies; the dummy hash never matches', async () => {
    expect(await verifyPassword('Secret123', null)).toBe(false);
    expect(await verifyPassword('Secret123', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('', DUMMY_HASH)).toBe(false);
  });
});
