import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { Accounts } from './accounts.service';
import { AuthEventsRepository } from './auth-events.repository';
import { PasswordResetService } from './password-reset.service';
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
 * Sign-up, email verification, login, password reset, sessions (SRS 4.2, AUTH-101/102). Standard module (SRS 8.11):
 * controllers (HTTP edge) -> services (one use case each) -> repositories (all SQL).
 */
@Module({
  imports: [AuthModule],
  controllers: [IdentityController, DevLoginController],
  providers: [
    SignupService, LoginService, SessionService, OtpService, PasswordResetService, Accounts,
    IdentityRepository, OtpRepository, AuthEventsRepository, SessionCookie,
  ],
  // OtpService: booking confirmation. Accounts + SessionService + SessionCookie: accepting a staff invitation.
  exports: [OtpService, SessionService, SessionCookie, Accounts],
})
export class IdentityModule {}
