import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import {
  Amendment, ChartEntries, EditPlan, EditPlanItem, LinkAppointment, NewPlan, NewPlanItem, NewPrescription, NewProcedure, NewRecall, OpenVisit,
  PlanStatus, RecallContact, RecallDismiss, RecallsQuery, VisitNotes,
} from './clinical.schemas';
import { PlansService } from './plans.service';
import { RecallsService } from './recalls.service';
import { VisitsService } from './visits.service';

const id = new ParseUUIDPipe();
type Body<T extends z.ZodTypeAny> = z.infer<T>;

/**
 * The doctor's visit (SRS VISIT-001…004). Reading needs clinical:read (checked in the service, so clinical:write alone
 * reads too); writing needs clinical:write and the visit to be the member's own (or an owner).
 */
@ApiTags('clinical')
@ApiBearerAuth()
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Post()
  @RequirePermission('clinical:write')
  open(@Body(new ZodBody(OpenVisit)) body: Body<typeof OpenVisit>) {
    return this.visits.open(body);
  }

  @Get(':id')
  get(@Param('id', id) visitId: string) {
    return this.visits.get(visitId);
  }

  @Patch(':id')
  @RequirePermission('clinical:write')
  saveNotes(@Param('id', id) visitId: string, @Body(new ZodBody(VisitNotes)) body: Body<typeof VisitNotes>) {
    return this.visits.saveNotes(visitId, body);
  }

  @Post(':id/finalize') @HttpCode(200)
  @RequirePermission('clinical:write')
  finalize(@Param('id', id) visitId: string) {
    return this.visits.finalize(visitId);
  }

  @Post(':id/amendments')
  @RequirePermission('clinical:write')
  amend(@Param('id', id) visitId: string, @Body(new ZodBody(Amendment)) body: Body<typeof Amendment>) {
    return this.visits.amend(visitId, body);
  }

  /** treatments:write:own (or owner) is checked against the visit's doctor in the service. */
  @Post(':id/procedures')
  addProcedure(@Param('id', id) visitId: string, @Body(new ZodBody(NewProcedure)) body: Body<typeof NewProcedure>) {
    return this.visits.addProcedure(visitId, body);
  }

  @Delete(':id/procedures/:procedureId')
  removeProcedure(@Param('id', id) visitId: string, @Param('procedureId', id) procedureId: string) {
    return this.visits.removeProcedure(visitId, procedureId);
  }

  @Post(':id/prescriptions')
  @RequirePermission('clinical:write')
  prescribe(@Param('id', id) visitId: string, @Body(new ZodBody(NewPrescription)) body: Body<typeof NewPrescription>) {
    return this.visits.prescribe(visitId, body);
  }
}

@ApiTags('clinical')
@ApiBearerAuth()
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly visits: VisitsService) {}

  /** One prescription with what its printout needs (VISIT-004). */
  @Get(':id')
  get(@Param('id', id) prescriptionId: string) {
    return this.visits.prescription(prescriptionId);
  }
}

/** The clinical parts of a patient record: visits, chart, plans, follow-ups. */
@ApiTags('clinical')
@ApiBearerAuth()
@Controller('patients')
export class PatientClinicalController {
  constructor(private readonly visits: VisitsService, private readonly plans: PlansService, private readonly recalls: RecallsService) {}

  @Get(':id/visits')
  @RequirePermission('patients:read')
  visitsOf(@Param('id', id) patientId: string) {
    return this.visits.forPatient(patientId);
  }

  @Get(':id/chart')
  @RequirePermission('patients:read')
  chart(@Param('id', id) patientId: string) {
    return this.visits.chart(patientId);
  }

  @Post(':id/chart')
  @RequirePermission('clinical:write')
  addChart(@Param('id', id) patientId: string, @Body(new ZodBody(ChartEntries)) body: Body<typeof ChartEntries>) {
    return this.visits.addChartEntries(patientId, body);
  }

  @Get(':id/plans')
  @RequirePermission('patients:read')
  plansOf(@Param('id', id) patientId: string) {
    return this.plans.forPatient(patientId);
  }

  @Post(':id/plans')
  @RequirePermission('patients:read')
  createPlan(@Param('id', id) patientId: string, @Body(new ZodBody(NewPlan)) body: Body<typeof NewPlan>) {
    return this.plans.create(patientId, body);
  }

  @Get(':id/recalls')
  @RequirePermission('patients:read')
  recallsOf(@Param('id', id) patientId: string) {
    return this.recalls.forPatient(patientId);
  }

  @Post(':id/recalls')
  @RequirePermission('patients:write')
  addRecall(@Param('id', id) patientId: string, @Body(new ZodBody(NewRecall)) body: Body<typeof NewRecall>) {
    return this.recalls.create(patientId, body);
  }
}

/** Treatment plans (TPLAN-*). Writers: the plan's doctor (treatments:write:own) or an owner, checked in the service. */
@ApiTags('clinical')
@ApiBearerAuth()
@Controller('plans')
@RequirePermission('patients:read')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get(':id')
  get(@Param('id', id) planId: string) {
    return this.plans.get(planId);
  }

  @Patch(':id')
  edit(@Param('id', id) planId: string, @Body(new ZodBody(EditPlan)) body: Body<typeof EditPlan>) {
    return this.plans.edit(planId, body);
  }

  @Post(':id/status') @HttpCode(200)
  setStatus(@Param('id', id) planId: string, @Body(new ZodBody(PlanStatus)) body: Body<typeof PlanStatus>) {
    return this.plans.setStatus(planId, body.to);
  }

  @Post(':id/items')
  addItem(@Param('id', id) planId: string, @Body(new ZodBody(NewPlanItem)) body: Body<typeof NewPlanItem>) {
    return this.plans.addItem(planId, body);
  }

  @Patch(':id/items/:itemId')
  editItem(@Param('id', id) planId: string, @Param('itemId', id) itemId: string, @Body(new ZodBody(EditPlanItem)) body: Body<typeof EditPlanItem>) {
    return this.plans.editItem(planId, itemId, body);
  }

  @Delete(':id/items/:itemId')
  removeItem(@Param('id', id) planId: string, @Param('itemId', id) itemId: string) {
    return this.plans.removeItem(planId, itemId);
  }

  @Post(':id/items/:itemId/cancel') @HttpCode(200)
  cancelItem(@Param('id', id) planId: string, @Param('itemId', id) itemId: string) {
    return this.plans.cancelItem(planId, itemId);
  }

  /** APPT-007: link the booked appointment to the planned item (reception or the plan's writer). */
  @Post(':id/items/:itemId/schedule') @HttpCode(200)
  scheduleItem(@Param('id', id) planId: string, @Param('itemId', id) itemId: string, @Body(new ZodBody(LinkAppointment)) body: Body<typeof LinkAppointment>) {
    return this.plans.scheduleItem(planId, itemId, body.appointmentId);
  }
}

/** The follow-up list (VISIT-005): read by members who read patients, worked by members who write them. */
@ApiTags('clinical')
@ApiBearerAuth()
@Controller('recalls')
export class RecallsController {
  constructor(private readonly recalls: RecallsService) {}

  @Get()
  @RequirePermission('patients:read')
  list(@Query(new ZodBody(RecallsQuery)) q: Body<typeof RecallsQuery>) {
    return this.recalls.list(q.view, q.limit);
  }

  @Post(':id/contact') @HttpCode(200)
  @RequirePermission('patients:write')
  contact(@Param('id', id) recallId: string, @Body(new ZodBody(RecallContact)) body: Body<typeof RecallContact>) {
    return this.recalls.contact(recallId, body.note);
  }

  @Post(':id/book') @HttpCode(200)
  @RequirePermission('patients:write')
  book(@Param('id', id) recallId: string, @Body(new ZodBody(LinkAppointment)) body: Body<typeof LinkAppointment>) {
    return this.recalls.book(recallId, body.appointmentId);
  }

  @Post(':id/dismiss') @HttpCode(200)
  @RequirePermission('patients:write')
  dismiss(@Param('id', id) recallId: string, @Body(new ZodBody(RecallDismiss)) body: Body<typeof RecallDismiss>) {
    return this.recalls.dismiss(recallId, body.reason ?? null);
  }
}
