import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Every app reads the single .env in the repo root.
loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

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
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment (copy .env.example to .env in the repo root):\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DEV_LOGIN_ENABLED) {
    throw new Error('DEV_LOGIN_ENABLED must be false in production');
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
