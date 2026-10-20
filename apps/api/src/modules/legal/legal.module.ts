import { Module } from '@nestjs/common';
import { LegalController, PublicLegalController } from './legal.controller';
import { LegalService } from './legal.service';

/**
 * The platform's legal documents (H6, NFR-15): reading the current versions, what a member still has to accept, and
 * recording acceptances. Sign-up, invitations and sessions use the exported LegalService; the platform panel publishes.
 */
@Module({
  controllers: [PublicLegalController, LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
