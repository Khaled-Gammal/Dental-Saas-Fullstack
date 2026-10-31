import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { PatientsService } from './patients.service';
import { PatientImportService } from './patient-import.service';
import { CreatePatient, DuplicatesQuery, ImportBody, ListQuery, MedicalHistoryBody, MergeBody, MergePreviewQuery, UpdatePatient } from './patients.schemas';

const id = new ParseUUIDPipe();

/** Patient records (SRS DSH-03). The HTTP edge: validation and the role checks that need no data. */
@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly importer: PatientImportService,
  ) {}

  @Get()
  @RequirePermission('patients:read')
  list(@Query(new ZodBody(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.patients.list(q);
  }

  /** Possible duplicates before creating a record (SRS PATIENT-002). Declared before ':id'. */
  @Get('duplicates')
  @RequirePermission('patients:read')
  duplicates(@Query(new ZodBody(DuplicatesQuery)) q: z.infer<typeof DuplicatesQuery>) {
    return this.patients.duplicates(q);
  }

  /**
   * Phase 2A (SRS ONB-03): import patients from the clinic's Excel/CSV file, up to 1,000 rows a request. `dryRun: true`
   * reports what would happen (new / duplicate / invalid, per row) and writes nothing; `dryRun: false` creates the new
   * ones in one transaction. Re-sending a batch creates nothing twice: those rows are duplicates by then.
   */
  @Post('import')
  @HttpCode(200)
  // a bulk change to the clinic's records: patients:write and the clinic's settings (the owner by default), not
  // every member who may add a patient at the desk
  @RequirePermission('patients:write', 'settings:write')
  import(@Body(new ZodBody(ImportBody)) body: z.infer<typeof ImportBody>) {
    return this.importer.run(body);
  }

  @Get(':id')
  @RequirePermission('patients:read')
  get(@Param('id', id) patientId: string) {
    return this.patients.get(patientId);
  }

  @Post()
  @RequirePermission('patients:write')
  create(@Body(new ZodBody(CreatePatient)) body: z.infer<typeof CreatePatient>) {
    return this.patients.create(body);
  }

  @Patch(':id')
  @RequirePermission('patients:write')
  update(@Param('id', id) patientId: string, @Body(new ZodBody(UpdatePatient)) body: z.infer<typeof UpdatePatient>) {
    return this.patients.update(patientId, body);
  }

  /** Replaces the medical history (allergies, conditions, medications, flags, notes). Clinical data. */
  @Put(':id/medical-history')
  @RequirePermission('clinical:write')
  saveMedicalHistory(@Param('id', id) patientId: string, @Body(new ZodBody(MedicalHistoryBody)) body: z.infer<typeof MedicalHistoryBody>) {
    return this.patients.saveMedicalHistory(patientId, body);
  }

  /** Earlier versions of the medical history (SRS PATIENT-005). Needs clinical:read (checked in the service). */
  @Get(':id/medical-history/versions')
  @RequirePermission('patients:read')
  historyVersions(@Param('id', id) patientId: string) {
    return this.patients.historyVersions(patientId);
  }

  /** What merging another record into this one would do (SRS PATIENT-003). */
  @Get(':id/merge-preview')
  @RequirePermission('patients:merge')
  mergePreview(@Param('id', id) patientId: string, @Query(new ZodBody(MergePreviewQuery)) q: z.infer<typeof MergePreviewQuery>) {
    return this.patients.mergePreview(patientId, q.other);
  }

  /** Moves everything of the other record to this one; not reversible from the dashboard. */
  @Post(':id/merge') @HttpCode(200)
  @RequirePermission('patients:merge')
  merge(@Param('id', id) patientId: string, @Body(new ZodBody(MergeBody)) body: z.infer<typeof MergeBody>) {
    return this.patients.merge(patientId, body.mergedId);
  }

  /** Who viewed or changed this record (DSH-15). Owners only by default. */
  @Get(':id/activity')
  @RequirePermission('audit:read')
  activity(@Param('id', id) patientId: string) {
    return this.patients.activity(patientId);
  }
}
