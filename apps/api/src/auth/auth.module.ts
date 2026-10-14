import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { TokenService } from './token.service';

/** Access tokens and the global guards. Other modules sign tokens through the exported TokenService. */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({ secret: cfg.JWT_SECRET }), // TTL, issuer and algorithm are set by TokenService
    }),
  ],
  controllers: [AuthController],
  providers: [
    TokenService,
    // order matters: authenticate first, then check permissions
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [TokenService],
})
export class AuthModule {}
