import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { PatientsService } from './patients.service';
import { CreatePatient, ListQuery, MedicalHistoryBody, UpdatePatient } from './patients.schemas';

const id = new ParseUUIDPipe();

/** Patient records (SRS DSH-03). The HTTP edge: validation and the role checks that need no data. */
@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @RequirePermission('patients:read')
  list(@Query(new ZodBody(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.patients.list(q);
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

  /** Who viewed or changed this record (DSH-15). Owners only by default. */
  @Get(':id/activity')
  @RequirePermission('audit:read')
  activity(@Param('id', id) patientId: string) {
    return this.patients.activity(patientId);
  }
}
