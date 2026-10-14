import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesRepository } from './branches.repository';
import { BranchesService } from './branches.service';
import { OnboardingController, OnboardingRepository } from './onboarding.controller';
import { ProfileController } from './profile/profile.controller';
import { ProfileRepository } from './profile/profile.repository';
import { ProfileService } from './profile/profile.service';

/** Clinic setup (wizard): profile, branches + hours, onboarding checklist. Standard module, SRS 8.11. */
@Module({
  controllers: [BranchesController, ProfileController, OnboardingController],
  providers: [BranchesService, BranchesRepository, ProfileService, ProfileRepository, OnboardingRepository],
  exports: [BranchesService],
})
export class ClinicSetupModule {}
