import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Db } from '@dental/db';
import { APP_CONFIG, type AppConfig } from '../../config';
import { TenantDb } from './tenant-db.service';
import { DB, PLATFORM_DB } from './tokens';

export { DB, PLATFORM_DB };

/**
 * The platform panel's URL with the API's database: only the credentials differ. The tests point DATABASE_URL at the
 * test database, and the panel must follow it there.
 */
export function platformUrl(cfg: Pick<AppConfig, 'DATABASE_URL' | 'DATABASE_PLATFORM_URL'>): string {
  const u = new URL(cfg.DATABASE_PLATFORM_URL);
  u.pathname = new URL(cfg.DATABASE_URL).pathname;
  return u.toString();
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [APP_CONFIG],
      // connects as app_user: no RLS bypass, every clinic query goes through TenantDb
      useFactory: (cfg: AppConfig): Db => createDb(cfg.DATABASE_URL, { applicationName: 'dental-api' }),
    },
    {
      provide: PLATFORM_DB,
      inject: [APP_CONFIG],
      // review R11: connects as app_platform — the platform_*() functions and the platform audit log, no clinic data.
      // Small pool: a handful of admins.
      useFactory: (cfg: AppConfig): Db => createDb(platformUrl(cfg), { max: 3, applicationName: 'dental-platform' }),
    },
    TenantDb,
  ],
  exports: [DB, PLATFORM_DB, TenantDb],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db, @Inject(PLATFORM_DB) private readonly platformDb: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.db.destroy(), this.platformDb.destroy()]);
  }
}
