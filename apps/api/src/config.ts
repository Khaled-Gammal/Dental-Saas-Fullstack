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
  // 'dev' writes texts to the log/Mailpit only. Nothing sends SMS today (decision D-01: email codes); a real provider
  // is a deferred, paid integration (docs/roadmap.md).
  SMS_PROVIDER: z.enum(['dev']).default('dev'),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  REFRESH_RACE_GRACE_MS: z.coerce.number().int().min(0).default(10_000),
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).default(90),
  // the Next.js website, reached from the API to purge its cache after a publish
  WEB_INTERNAL_URL: z.string().default('http://localhost:3000'),
  REVALIDATE_SECRET: z.string().min(16).default('dev-only-revalidate-secret'),
  // Which proxy hops may set X-Forwarded-For (Express "trust proxy"): 'loopback' when the website runs on the same host;
  // a subnet or list ("loopback, 10.0.0.0/8") when it runs in another container; a hop count ("1"); or true/false.
  // The public booking throttles are per client IP, so this must match the deployment.
  TRUST_PROXY: z.string().default('loopback').transform((v): boolean | number | string => (v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v)),
  // public address of this API: signed media links in the dashboard point here
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  // Object storage for uploads. 'local' keeps files on disk (development and tests); 's3' is any S3-compatible service
  // (Cloudflare R2, AWS S3, MinIO, SeaweedFS ...). Production refuses 'local'.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default(path.resolve(__dirname, '../../../.storage')),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default('dental-dev'),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // signs short-lived links to private media (dashboard previews of unpublished images)
  MEDIA_URL_SECRET: z.string().min(16).default('dev-only-media-url-secret'),
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
      c.STORAGE_DRIVER === 'local' && 'STORAGE_DRIVER=local keeps uploads on one machine; use s3 (R2, S3 or another S3-compatible service)',
      c.STORAGE_DRIVER === 's3' && !(c.S3_ENDPOINT && c.S3_ACCESS_KEY && c.S3_SECRET_KEY) && 'S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY are required for STORAGE_DRIVER=s3',
      ...(['JWT_SECRET', 'OTP_SECRET', 'BOOKING_CODE_SECRET', 'REVALIDATE_SECRET', 'MEDIA_URL_SECRET'] as const)
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
  /** Staff invitation links (SRS AUTH-08 / ACCESS-001). */
  invitationTtlDays: 7,
  signupPlan: 'pro',
  userAgentMaxLength: 300,
} as const;

/**
 * The platform admin panel (H5): sign-in is password + an emailed code every time; the session is a short-lived token
 * in an httpOnly cookie scoped to /platform (SameSite=Strict), never readable by JavaScript.
 */
export const PLATFORM_POLICY = {
  sessionSeconds: 60 * 60,
  cookie: { name: 'pt', path: '/platform' },
  codeSubject: 'رمز الدخول إلى لوحة إدارة المنصة',
} as const;

/**
 * The platform landing page (H7; LND-02, LND-04): the public plans are cached briefly, and the contact form is
 * throttled per visitor address and per phone number. Platform admins get an email for each new request.
 */
export const LANDING_POLICY = {
  plansCacheSeconds: 300,
  throttle: { leadIp: [5, 60 * 60], leadPhone: [3, 24 * 60 * 60] },
  notifySubject: 'طلب تواصل جديد من عيادة',
} as const;

/** Image uploads: what is accepted and what is produced. */
export const MEDIA_POLICY = {
  maxUploadBytes: 10 * 1024 * 1024,
  acceptedFormats: ['jpeg', 'png', 'webp'] as const,
  maxInputPixels: 40_000_000, // ~ a 7300 x 5500 photo; bigger is refused before decoding
  webpQuality: 80, // WebP renditions at the purpose's widths, never upscaled
  signedUrlSeconds: 15 * 60,
  /**
   * What an upload is for decides its stored kind, the smallest accepted side and the rendition widths:
   * gallery photos are shown large; doctor/service/branch photos as cards; a logo is small and often wide and short.
   */
  purposes: {
    gallery: { kind: 'gallery', minSide: 200, widths: [480, 960, 1600] },
    photo: { kind: 'image', minSide: 200, widths: [320, 640, 1280] },
    logo: { kind: 'logo', minSide: 48, widths: [128, 256, 512] },
  },
} as const;

/**
 * Clinical documents and images of a patient (SRS PATIENT-004, NFR-03). Stored exactly as uploaded (an X-ray must not
 * be re-compressed), always private, opened only through links valid for 5 minutes and bound to the member.
 */
export const CLINICAL_FILE_POLICY = {
  maxUploadBytes: 20 * 1024 * 1024,
  linkSeconds: 5 * 60,
  kinds: ['xray', 'clinical_photo', 'document'] as const,
} as const;
export type ClinicalFileKind = (typeof CLINICAL_FILE_POLICY.kinds)[number];

/** An expense's supporting document (EXP-001): PDF or image, private, same checks and link lifetime as clinical files. */
export const EXPENSE_FILE_POLICY = {
  maxUploadBytes: 20 * 1024 * 1024,
  linkSeconds: 5 * 60,
} as const;

export type MediaPurpose = keyof typeof MEDIA_POLICY.purposes;
export type MediaKind = (typeof MEDIA_POLICY.purposes)[MediaPurpose]['kind'];

/** Background job schedule. */
export const WORKER_POLICY = {
  outboxEveryMs: 5_000,
  notificationsEveryMs: 30_000,
  releaseHoldsEveryMs: 60_000,
  noShowEveryMs: 5 * 60_000,
  /** H5: a trial that ended without activation suspends the clinic (owner 2026-10-20) */
  expireTrialsEveryMs: 15 * 60_000,
  purgeAuthCron: '15 3 * * *',
  purgeImagesCron: '45 3 * * *',
  timezone: 'Africa/Cairo',
} as const;
