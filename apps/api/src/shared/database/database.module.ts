import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Db } from '@dental/db';
import { APP_CONFIG, type AppConfig } from '../../config';
import { TenantDb } from './tenant-db.service';
import { DB } from './tokens';

export { DB };



@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [APP_CONFIG],
      // connects as app_user: no RLS bypass, every clinic query goes through TenantDb
      useFactory: (cfg: AppConfig): Db => createDb(cfg.DATABASE_URL, { applicationName: 'dental-api' }),
    },
    TenantDb,
  ],
  exports: [DB, TenantDb],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
