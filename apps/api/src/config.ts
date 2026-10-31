import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Every app reads the single .env in the repo root.
loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

const DEV_OTP_SECRET = 'dev-only-otp-secret-change-me';
const DEV_PASSWORD_PEPPER = 'dev-only-password-pepper-change-me-in-production';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_WORKER_URL: z.string().min(1),
  /**
   * Review R11: the platform admin panel's own connection (role app_platform), the only role allowed to call the
   * platform_*() functions. Its database name is ignored: the panel always uses the API's database (DATABASE_URL).
   */
  DATABASE_PLATFORM_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  BOOKING_CODE_SECRET: z.string().min(16),
  DEV_LOGIN_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  DASHBOARD_URL: z.string().default('http://localhost:5173'),
  /** review R11: the platform's landing page, linked from the "trial ending" email (optional: without it, no link) */
  LANDING_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  ROOT_DOMAIN: z.string().default('lvh.me'),
  OTP_SECRET: z.string().min(16).default(DEV_OTP_SECRET),
  /** review R11: mixed into every password hash (identity/crypto.ts); set once per environment, never changed */
  PASSWORD_PEPPER: z.string().min(16).default(DEV_PASSWORD_PEPPER),
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
  /** Phase 1B: error tracking (Sentry). Unset = off. The same project can serve the API and the worker (tag "service"). */
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /** defaults to NODE_ENV; e.g. "staging" for a staging server that also runs with NODE_ENV=production */
  SENTRY_ENVIRONMENT: z.preprocess(emptyToUndefined, z.string().optional()),
  /** the deployed version (a git sha or tag), so an error is tied to the release that introduced it */
  SENTRY_RELEASE: z.preprocess(emptyToUndefined, z.string().optional()),
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
      dbUser(c.DATABASE_PLATFORM_URL) === dbUser(c.DATABASE_URL) && 'DATABASE_PLATFORM_URL must use its own role (app_platform), not the API\'s',
      !c.RATE_LIMIT_ENABLED && 'RATE_LIMIT_ENABLED must be true',
      c.STORAGE_DRIVER === 'local' && 'STORAGE_DRIVER=local keeps uploads on one machine; use s3 (R2, S3 or another S3-compatible service)',
      c.STORAGE_DRIVER === 's3' && !(c.S3_ENDPOINT && c.S3_ACCESS_KEY && c.S3_SECRET_KEY) && 'S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY are required for STORAGE_DRIVER=s3',
      ...(['JWT_SECRET', 'OTP_SECRET', 'BOOKING_CODE_SECRET', 'REVALIDATE_SECRET', 'MEDIA_URL_SECRET', 'PASSWORD_PEPPER'] as const)
        .filter((k) => c[k] === DEV_OTP_SECRET || c[k].startsWith('dev-only') || c[k].length < 32)
        .map((k) => `${k} must be a long random value (not the development one)`),
    ].filter(Boolean);
    if (problems.length) throw new Error(`Refusing to start in production:\n  ${problems.join('\n  ')}`);
  }
  return c;
}

/**
 * The password pepper for identity/crypto.ts, read where it is used (the hashing helpers are plain functions, also
 * called by test helpers outside the Nest container). loadConfig() refuses the development value in production.
 */
export const passwordPepper = (): string => process.env.PASSWORD_PEPPER || DEV_PASSWORD_PEPPER;

const dbUser = (url: string) => { try { return decodeURIComponent(new URL(url).username); } catch { return url; } };

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
  subscribeSubject: 'طلب اشتراك من عيادة جديدة',
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
    /** Phase 2C-2: a before/after case's images — patient images, their own kind, served uncached (consent can be withdrawn) */
    case: { kind: 'case', minSide: 200, widths: [480, 960] },
    /** Phase 2C-3: the site's share image (made into a 1200×630 JPEG when shared); wide, so 600 px at least */
    share: { kind: 'image', minSide: 600, widths: [640, 1280] },
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
/**
 * Data export and clinic deletion (H8, NFR-08; owner 2026-10-20). The owner asks for an export (password again); the
 * worker builds one ZIP, kept 7 days, downloaded through a short signed link. Deletion keeps the data 90 days (in
 * the database: request_clinic_deletion), then the worker erases it.
 */
export const DATA_POLICY = {
  exportKeepDays: 7,
  exportsPerDay: 3,
  linkSeconds: 5 * 60,
  /** an export still 'running' after this long was cut off (a restart): it is marked failed */
  staleExportMinutes: 120,
  /** rows read per query while exporting a table */
  pageRows: 5_000,
  readySubject: 'نسخة بيانات عيادتك جاهزة',
  deletionSubject: 'طلب حذف العيادة',
} as const;

/**
 * Phase 2B (owner 2026-10-31): subscriptions are paid outside the system and recorded by the platform. When a paid
 * period runs out the clinic is past due (keeps working, warned); after `graceDays` it is suspended as unpaid. Owners
 * are reminded `remindDays` and 1 day before the end, when it ends, and the day before the suspension.
 */
export const BILLING_POLICY = {
  graceDays: 7,
  remindDays: 7,
} as const;

export const WORKER_POLICY = {
  outboxEveryMs: 5_000,
  notificationsEveryMs: 30_000,
  releaseHoldsEveryMs: 60_000,
  noShowEveryMs: 5 * 60_000,
  /** H5: a trial that ended without activation suspends the clinic (owner 2026-10-20) */
  expireTrialsEveryMs: 15 * 60_000,
  purgeAuthCron: '15 3 * * *',
  purgeImagesCron: '45 3 * * *',
  /** H8: data exports are built one at a time on their own queue; old ones expire and closed clinics are erased nightly */
  buildExportsEveryMs: 30_000,
  expireExportsCron: '0 4 * * *',
  purgeClinicsCron: '30 4 * * *',
  timezone: 'Africa/Cairo',
  /**
   * Phase 1B: the worker writes the time here after each completed job (at most every 15 s); GET /health/worker fails once it is
   * older than 10 minutes. Not 1-2 minutes: a nightly purge can hold the single maintenance slot for a few minutes.
   */
  heartbeatKey: 'dental:worker:heartbeat',
  heartbeatEveryMs: 15_000,
  heartbeatStaleMs: 10 * 60_000,
} as const;
