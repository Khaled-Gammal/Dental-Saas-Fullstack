import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing with scrypt (built into Node, no native build step on Windows).
 * Stored format: scrypt$N$r$p$<salt b64>$<key b64>, so parameters can be raised later
 * without breaking existing hashes.
 */
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAXMEM = 64 * 1024 * 1024;

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
const unb64 = (s: string) => Buffer.from(s, 'base64');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${b64(salt)}$${b64(key)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, key] = parts;
  const expected = unb64(key);
  const actual = await scrypt(password, unb64(salt), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Used when the account does not exist, so a failed login takes the same time either way. */
export const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

/** Min 8 chars, at least one letter and one digit. Returns an error message or null. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 128) return 'Password is too long';
  // \p{L}: a letter in any script (Arabic-Indic digits are not letters); \p{Nd}: a digit in any script
  if (!/\p{L}/u.test(pw) || !/\p{Nd}/u.test(pw)) return 'Password needs at least one letter and one number';
  return null;
}

/** 6-digit one-time code and its keyed hash (the plain code is never stored). */
export function newOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Opaque refresh token for the cookie; only its SHA-256 is stored in refresh_tokens. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
