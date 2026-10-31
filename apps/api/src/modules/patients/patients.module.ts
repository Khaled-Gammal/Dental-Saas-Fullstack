import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { CLINICAL_FILE_SIGNER, ClinicalFileSigner } from './clinical-files';
import { PatientDirectory } from './patient-directory';
import { ClinicalFileLinkController, PatientFilesController } from './patient-files.controller';
import { PatientFilesRepository } from './patient-files.repository';
import { PatientFilesService } from './patient-files.service';
import { PatientsController } from './patients.controller';
import { PatientsRepository } from './patients.repository';
import { PatientsService } from './patients.service';
import { PatientImportService } from './patient-import.service';

/**
 * Patients (SRS 8.2/8.11: standard module): records, medical history (with versions), clinical documents. Other modules
 * use `PatientDirectory` from `index.ts`, never the repository.
 */
@Module({
  controllers: [PatientsController, PatientFilesController, ClinicalFileLinkController],
  providers: [
    PatientsService, PatientsRepository, PatientDirectory, PatientImportService, PatientFilesService, PatientFilesRepository,
    // its own key domain ("clinical:" in the MAC), so a website-image link can never be replayed as a clinical one
    { provide: CLINICAL_FILE_SIGNER, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => new ClinicalFileSigner(cfg.MEDIA_URL_SECRET, cfg.API_PUBLIC_URL) },
  ],
  exports: [PatientDirectory],
})
export class PatientsModule {}
