import { Module } from '@nestjs/common';
import { MediaModule } from '../media';
import { WebsiteModule } from '../website/website.module';
import { BranchesController } from './branches.controller';
import { BranchesRepository } from './branches.repository';
import { BranchesService } from './branches.service';
import { CalendarController } from './calendar/calendar.controller';
import { CalendarRepository } from './calendar/calendar.repository';
import { CalendarService } from './calendar/calendar.service';
import { DoctorsController } from './doctors/doctors.controller';
import { DoctorsRepository } from './doctors/doctors.repository';
import { DoctorsService } from './doctors/doctors.service';
import { OnboardingController, OnboardingRepository } from './onboarding.controller';
import { ProfileController } from './profile/profile.controller';
import { ProfileRepository } from './profile/profile.repository';
import { ProfileService } from './profile/profile.service';
import { ServicesController } from './services/services.controller';
import { ServicesRepository } from './services/services.repository';
import { ServicesService } from './services/services.service';

/** Clinic setup (wizard): profile, branches + hours, doctors + schedules, services, calendar (holidays, time off, rooms, booking rules), onboarding checklist. Standard module, SRS 8.11. */
@Module({
  imports: [WebsiteModule, MediaModule], // doctor/service edits purge the public site's cache; records carry images
  controllers: [BranchesController, ProfileController, OnboardingController, DoctorsController, ServicesController, CalendarController],
  providers: [
    BranchesService, BranchesRepository, ProfileService, ProfileRepository, OnboardingRepository,
    DoctorsService, DoctorsRepository, ServicesService, ServicesRepository, CalendarService, CalendarRepository,
  ],
  exports: [BranchesService],
})
export class ClinicSetupModule {}
