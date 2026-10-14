import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesRepository } from './branches.repository';
import { BranchesService } from './branches.service';

/** Standard NestJS module (controller -> service -> repository). See SRS 8.11. */
@Module({
  controllers: [BranchesController],
  providers: [BranchesService, BranchesRepository],
  exports: [BranchesService],
})
export class ClinicSetupModule {}
