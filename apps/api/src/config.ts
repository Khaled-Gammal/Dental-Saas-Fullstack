import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Every app reads the single .env in the repo root.
loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

const DEV_OTP_SECRET = 'dev-only-otp-secret-change-me';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_WORKER_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  BOOKING_CODE_SECRET: z.string().min(16),
  DEV_LOGIN_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  DASHBOARD_URL: z.string().default('http://localhost:5173'),
  ROOT_DOMAIN: z.string().default('lvh.me'),
  OTP_SECRET: z.string().min(16).default(DEV_OTP_SECRET),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  MAIL_FROM: z.string().default('Dental SaaS <no-reply@lvh.me>'),
  // 'dev' writes texts to the log/Mailpit only. Production refuses to start with it.
  SMS_PROVIDER: z.enum(['dev']).default('dev'),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  REFRESH_RACE_GRACE_MS: z.coerce.number().int().min(0).default(10_000),
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).default(90),
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment (copy .env.example to .env in the repo root):\n${issues}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    const problems = [
      c.DEV_LOGIN_ENABLED && 'DEV_LOGIN_ENABLED must be false',
      !c.RATE_LIMIT_ENABLED && 'RATE_LIMIT_ENABLED must be true',
      c.SMS_PROVIDER === 'dev' && 'SMS_PROVIDER=dev cannot send real texts; configure a real provider',
      ...(['JWT_SECRET', 'OTP_SECRET', 'BOOKING_CODE_SECRET'] as const)
        .filter((k) => c[k] === DEV_OTP_SECRET || c[k].startsWith('dev-only') || c[k].length < 32)
        .map((k) => `${k} must be a long random value (not the development one)`),
    ].filter(Boolean);
    if (problems.length) throw new Error(`Refusing to start in production:\n  ${problems.join('\n  ')}`);
  }
  return c;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Security and session policy in one place (not secrets, so not in .env).
 * Changing a number here changes it everywhere it is enforced.
 */
export const AUTH_POLICY = {
  accessTtlSeconds: 15 * 60,
  refreshTtlDays: 30,
  refreshCookie: { name: 'rt', path: '/auth' },
  otp: {
    ttlMinutes: 5,
    maxAttempts: 5, // must stay <= the CHECK (attempts <= 5) on otp_codes
    sendsPerWindow: 3,
    sendWindowMinutes: 10,
  },
  // per account+IP stops guessing without letting a stranger lock someone out; per account stops distributed guessing
  login: { perAccountIp: 10, perAccount: 50, windowSeconds: 15 * 60 },
  // per-IP abuse limits on the public auth endpoints: [requests, window in seconds]
  throttle: {
    slug: [120, 60],
    signup: [10, 60 * 60],
    otpResend: [10, 10 * 60],
    otpVerify: [30, 10 * 60],
    login: [30, 60],
  },
  signupPlan: 'pro',
  userAgentMaxLength: 300,
} as const;

/** Background job schedule. */
export const WORKER_POLICY = {
  releaseHoldsEveryMs: 60_000,
  purgeAuthCron: '15 3 * * *',
  timezone: 'Africa/Cairo',
} as const;
