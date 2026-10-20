import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { IdentityModule } from '../identity/identity.module';
import { ClinicDataController, ExportDownloadController } from './clinic-data.controller';
import { ClinicDataRepository } from './clinic-data.repository';
import { ClinicDataService } from './clinic-data.service';
import { EXPORT_FILE_SIGNER, ExportFileSigner } from './export-files';

/**
 * The clinic's data (H8, SRS NFR-08; owner 2026-10-20): the owner exports everything (built by the worker, see
 * worker/data-exports.ts) and deletes the clinic (kept 90 days for the platform to restore, then erased by the worker).
 */
@Module({
  imports: [IdentityModule],
  controllers: [ClinicDataController, ExportDownloadController],
  providers: [
    ClinicDataService, ClinicDataRepository,
    { provide: EXPORT_FILE_SIGNER, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => new ExportFileSigner(cfg.MEDIA_URL_SECRET, cfg.API_PUBLIC_URL) },
  ],
})
export class ClinicDataModule {}
