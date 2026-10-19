import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients';
import { ClinicalAccess } from './clinical-access';
import { PatientClinicalController, PlansController, PrescriptionsController, RecallsController, VisitsController } from './clinical.controllers';
import { PlansRepository } from './plans.repository';
import { PlansService } from './plans.service';
import { RecallsRepository } from './recalls.repository';
import { RecallsService } from './recalls.service';
import { VisitsRepository } from './visits.repository';
import { VisitsService } from './visits.service';

/**
 * Clinical workflow (SRS VISIT-*, CHART-001, TPLAN-*, AUDIT-002): visits with finalize/amend, procedures,
 * prescriptions, the dental chart, treatment plans and the follow-up list. Patients are read through
 * `PatientDirectory`; appointment status follows visits through database triggers.
 */
@Module({
  imports: [PatientsModule],
  controllers: [VisitsController, PrescriptionsController, PatientClinicalController, PlansController, RecallsController],
  providers: [ClinicalAccess, VisitsService, VisitsRepository, PlansService, PlansRepository, RecallsService, RecallsRepository],
})
export class ClinicalModule {}
