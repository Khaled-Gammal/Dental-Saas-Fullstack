import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, loadConfig } from './config';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { ClinicSetupModule } from './modules/clinic-setup/clinic-setup.module';
import { PublicSiteModule } from './modules/public-site/public-site.module';
import { DatabaseModule } from './shared/database/database.module';
import { ProblemDetailsFilter } from './shared/errors/problem-details.filter';
import { RedisModule } from './shared/redis/redis.module';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    // request context (tenant, user, request id) via AsyncLocalStorage
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => (req.headers['x-request-id'] as string) ?? randomUUID(),
      },
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    HealthModule,
    PublicSiteModule,
    ClinicSetupModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
