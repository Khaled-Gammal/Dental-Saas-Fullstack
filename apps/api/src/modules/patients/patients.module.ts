import { Module } from '@nestjs/common';
import { PatientDirectory } from './patient-directory';
import { PatientsController } from './patients.controller';
import { PatientsRepository } from './patients.repository';
import { PatientsService } from './patients.service';

/** Patients (SRS 8.2/8.11: standard module). Other modules use `PatientDirectory` from `index.ts`, never the repository. */
@Module({
  controllers: [PatientsController],
  providers: [PatientsService, PatientsRepository, PatientDirectory],
  exports: [PatientDirectory],
})
export class PatientsModule {}
