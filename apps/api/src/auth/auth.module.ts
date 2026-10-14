import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({ secret: cfg.JWT_SECRET, signOptions: { expiresIn: '15m', issuer: 'dental-saas' } }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    // order matters: authenticate first, then check permissions
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AuthModule {}
