import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PatientsModule } from '../patients';
import { CONSENT_FILE_SIGNER, ConsentFileSigner } from './consent-files';
import { ConsentFileLinkController, ConsentTemplatesController, PatientConsentsController } from './consents.controller';
import { ConsentsRepository } from './consents.repository';
import { ConsentsService } from './consents.service';

/**
 * Patient consents (H9, SRS DSH-16, NFR-16; owner 2026-10-20): the clinic's consent texts (versioned, starter drafts
 * reviewed before use) and the consents patients or guardians sign on screen or on paper. Visits warn when a treatment
 * that needs a consent has none (clinical/visits.repository.ts).
 */
@Module({
  imports: [PatientsModule],
  controllers: [ConsentTemplatesController, PatientConsentsController, ConsentFileLinkController],
  providers: [
    ConsentsService, ConsentsRepository,
    { provide: CONSENT_FILE_SIGNER, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => new ConsentFileSigner(cfg.MEDIA_URL_SECRET, cfg.API_PUBLIC_URL) },
  ],
})
export class ConsentsModule {}
