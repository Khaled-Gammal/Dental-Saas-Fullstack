import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AuthEventsRepository } from './auth-events.repository';
import { DevLoginController } from './dev-login.controller';
import { IdentityController } from './identity.controller';
import { IdentityRepository } from './identity.repository';
import { LoginService } from './login.service';
import { OtpRepository } from './otp.repository';
import { OtpService } from './otp.service';
import { SessionCookie } from './session-cookie';
import { SessionService } from './session.service';
import { SignupService } from './signup.service';

/**
 * Sign-up, phone verification, login, sessions (SRS 4.2). Standard module (SRS 8.11):
 * controllers (HTTP edge) -> services (one use case each) -> repositories (all SQL).
 */
@Module({
  imports: [AuthModule],
  controllers: [IdentityController, DevLoginController],
  providers: [
    SignupService, LoginService, SessionService, OtpService,
    IdentityRepository, OtpRepository, AuthEventsRepository, SessionCookie,
  ],
  exports: [OtpService, SessionService], // OtpService is reused by booking confirmation and password reset
})
export class IdentityModule {}
