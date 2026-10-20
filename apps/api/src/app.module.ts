import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, loadConfig } from './config';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { ClinicSetupModule } from './modules/clinic-setup/clinic-setup.module';
import { BillingModule } from './modules/billing';
import { FinanceModule } from './modules/finance';
import { ReportsModule } from './modules/reports';
import { ClinicalModule } from './modules/clinical';
import { IdentityModule } from './modules/identity/identity.module';
import { GalleryModule } from './modules/gallery/gallery.module';
import { ClinicDataModule } from './modules/clinic-data/clinic-data.module';
import { LandingModule } from './modules/landing/landing.module';
import { MediaModule } from './modules/media';
import { PatientsModule } from './modules/patients';
import { PlatformModule } from './modules/platform/platform.module';
import { PublicSiteModule } from './modules/public-site/public-site.module';
import { SchedulingModule } from './modules/scheduling';
import { StaffModule } from './modules/staff/staff.module';
import { WebsiteModule } from './modules/website/website.module';
import { AuditModule } from './shared/audit/audit.module';
import { DatabaseModule } from './shared/database/database.module';
import { ProblemDetailsFilter } from './shared/errors/problem-details.filter';
import { NotificationsModule } from './shared/notifications/notifications.module';
import { AccessLogMiddleware } from './shared/observability/access-log.middleware';
import { PlansModule } from './shared/plans/plans.module';
import { RateLimitModule } from './shared/rate-limit/rate-limit.module';
import { RedisModule } from './shared/redis/redis.module';
import { StorageModule } from './shared/storage/storage.module';

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
        // a client may pass its own id for tracing, but only a safe one: it is echoed in headers, bodies and logs
        idGenerator: (req: Request) => { const h = req.headers['x-request-id']; return typeof h === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(h) ? h : randomUUID(); },
      },
    }),
    DatabaseModule,
    AuditModule,
    StorageModule,
    RedisModule,
    RateLimitModule,
    NotificationsModule,
    PlansModule,
    AuthModule,
    IdentityModule,
    HealthModule,
    PublicSiteModule,
    ClinicSetupModule,
    WebsiteModule,
    SchedulingModule,
    PatientsModule,
    ClinicalModule,
    BillingModule,
    FinanceModule,
    ReportsModule,
    MediaModule,
    GalleryModule,
    StaffModule,
    PlatformModule,
    LandingModule,
    ClinicDataModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // every route (Express 5 wildcard syntax). Middleware of global modules (ClsModule) runs before the root module's, so the id exists
    consumer.apply(AccessLogMiddleware).forRoutes('{*splat}');
  }
}
