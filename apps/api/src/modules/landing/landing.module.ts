import { Module } from '@nestjs/common';
import { PublicLandingController } from './landing.controller';
import { LandingRepository } from './landing.repository';
import { LandingService } from './landing.service';

/**
 * The platform landing page (H7; SRS LND-02, LND-04): the plans offered to new clinics, and the contact form whose
 * requests the platform panel lists.
 */
@Module({
  controllers: [PublicLandingController],
  providers: [LandingService, LandingRepository],
  exports: [LandingService], // sign-up records «اشترك الآن»
})
export class LandingModule {}
