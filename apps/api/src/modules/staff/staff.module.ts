import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InvitationAcceptance } from './invitation-acceptance.service';
import { InvitationsController, StaffController } from './staff.controller';
import { StaffRepository } from './staff.repository';
import { StaffService } from './staff.service';

/**
 * Clinic members and invitations (SRS 8.2 `tenancy`; ACCESS-001/002/005). Standard module (SRS 8.11). Uses identity
 * only through its exported services (Accounts, SessionService, SessionCookie).
 */
@Module({
  imports: [IdentityModule],
  controllers: [StaffController, InvitationsController],
  providers: [StaffService, InvitationAcceptance, StaffRepository],
})
export class StaffModule {}
