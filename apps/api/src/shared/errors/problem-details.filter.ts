import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

/** RFC 9457 problem+json body. `code` is stable for the frontend; `detail` is human-readable. */
interface Problem {
  [extra: string]: unknown;
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  errors?: unknown;
}

/** PostgreSQL error codes our rules raise, mapped to HTTP. */
const PG: Record<string, { status: number; code: string; title: string }> = {
  '23P01': { status: 409, code: 'slot_taken', title: 'This time is already booked' },
  '23505': { status: 409, code: 'conflict', title: 'Already exists' },
  '23514': { status: 422, code: 'rule_violation', title: 'Not allowed by the business rules' },
  '23503': { status: 422, code: 'invalid_reference', title: 'Refers to something that does not exist' },
  '23502': { status: 422, code: 'missing_field', title: 'A required field is missing' },
  '42501': { status: 403, code: 'forbidden', title: 'Not allowed' },
  P0002: { status: 404, code: 'not_found', title: 'Not found' },
  '55P03': { status: 409, code: 'busy', title: 'Another user is changing this right now, try again' },
};

/** Specific constraints get specific codes, so the UI can say exactly what is wrong. */
const CONSTRAINTS: Record<string, { status: number; code: string; title: string }> = {
  branch_hours_no_overlap: { status: 409, code: 'hours_overlap', title: 'Two shifts on the same day overlap' },
  branches_tenant_id_slug_key: { status: 409, code: 'branch_slug_taken', title: 'Another branch already uses this address' },
  sites_theme_primary_hex: { status: 400, code: 'invalid_color', title: 'Colour must look like #1d6fd8' },
  branches_main_is_active: { status: 409, code: 'main_branch_inactive', title: 'The main branch cannot be deactivated; make another branch main first' },
  branches_one_main: { status: 409, code: 'busy', title: 'Another user is changing this right now, try again' },
  services_tenant_catalog_code: { status: 409, code: 'service_already_added', title: 'This catalogue service is already on your price list' },
  doctor_schedules_no_overlap: { status: 409, code: 'schedule_overlap', title: 'The doctor is already scheduled at that time' },
  appointments_no_doctor_overlap: { status: 409, code: 'slot_taken', title: 'That time was just taken; pick another slot' },
  appointments_no_room_overlap: { status: 409, code: 'room_taken', title: 'The room is already booked at that time' },
  appointments_open_code: { status: 409, code: 'busy', title: 'Another user is changing this right now, try again' },
  gallery_items_one_featured: { status: 409, code: 'busy', title: 'Another user is changing this right now, try again' },
  gallery_items_published_described: { status: 400, code: 'alt_required', title: 'Describe the photo (alt text or caption) before publishing it' },
  gallery_items_featured_published: { status: 400, code: 'featured_requires_published', title: 'Only a published photo can be featured' },
  gallery_items_branch_fk: { status: 400, code: 'branch_not_found', title: 'Branch not found' },
  invitations_one_open_per_email: { status: 409, code: 'invitation_pending', title: 'This email already has an open invitation; resend it instead' },
  tenant_members_tenant_id_user_id_key: { status: 409, code: 'already_member', title: 'This person is already a member of the clinic' },
  doctors_member_unique: { status: 409, code: 'doctor_already_linked', title: 'This doctor already has a login' },
  holidays_one_per_scope_date: { status: 409, code: 'holiday_exists', title: 'This day is already closed for this branch' },
  rooms_branch_id_name_key: { status: 409, code: 'room_name_taken', title: 'This branch already has a room with this name' },
  doctor_time_off_max_length: { status: 400, code: 'time_off_too_long', title: 'Time off can last at most a year' },
  tenant_settings_reminder_offsets: { status: 400, code: 'invalid_reminders', title: 'Up to four reminders, between 15 minutes and 7 days before' },
  // clinical workflow (Phase D4): rules the database keeps whatever the caller
  visits_finalized: { status: 409, code: 'visit_finalized', title: 'The visit is final; add an amendment instead' },
  visits_never_deleted: { status: 409, code: 'visit_kept', title: 'Clinical visits are never deleted' },
  visit_amendments_reason: { status: 400, code: 'amendment_reason_required', title: 'Give the reason for the amendment' },
  visit_amendments_visit_final: { status: 409, code: 'visit_not_final', title: 'The visit is still a draft; edit the notes directly' },
  treatment_plans_transition: { status: 409, code: 'invalid_transition', title: 'The plan cannot move to that status' },
  treatment_plans_closed: { status: 409, code: 'plan_closed', title: 'The plan is closed' },
  treatment_plans_locked: { status: 409, code: 'plan_locked', title: 'The acceptance of a plan is not changed' },
  treatment_plan_items_locked: { status: 409, code: 'plan_locked', title: 'Items of an accepted plan are fixed; cancel an item instead' },
  treatment_plan_items_status: { status: 409, code: 'invalid_item_status', title: 'The plan item cannot move to that status' },
  treatment_plan_items_tooth: { status: 400, code: 'invalid_tooth', title: 'Use an FDI tooth number (11–48, 51–85)' },
  visit_procedures_billed: { status: 409, code: 'procedure_billed', title: 'The procedure is on an invoice' },
  visit_procedures_price_range: { status: 400, code: 'price_out_of_range', title: 'The price must be within the service price range' },
  visit_procedures_plan_not_accepted: { status: 409, code: 'plan_not_accepted', title: 'Record the patient’s acceptance of the plan first' },
  visit_procedures_plan_item_closed: { status: 409, code: 'plan_item_closed', title: 'The plan item is already done or cancelled' },
  visit_procedures_fixed: { status: 409, code: 'procedure_fixed', title: 'Record another procedure instead' },
  tooth_records_visit_patient: { status: 400, code: 'visit_mismatch', title: 'The visit belongs to another patient' },
  prescriptions_visit_match: { status: 400, code: 'prescription_mismatch', title: 'The prescription does not match its visit' },
  prescriptions_issued: { status: 409, code: 'prescription_issued', title: 'An issued prescription is not changed; issue a correction' },
  patients_merge_self: { status: 400, code: 'merge_self', title: 'Choose another record to merge into this one' },
  patients_already_merged: { status: 409, code: 'already_merged', title: 'One of the records is already merged' },
  prescriptions_replaced_once: { status: 409, code: 'prescription_already_corrected', title: 'This prescription was already corrected' },
};

const RESERVED = new Set(['message', 'code', 'errors', 'statusCode', 'error', 'type', 'title', 'status', 'detail', 'instance']);
function extras(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([k]) => !RESERVED.has(k)));
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const problem = this.toProblem(exception);
    problem.instance = req.originalUrl;
    const rid = res.getHeader('X-Request-Id');
    problem.requestId = typeof rid === 'string' ? rid : undefined;
    if (typeof problem.retryAfter === 'number') res.setHeader('Retry-After', String(problem.retryAfter)); // 429s
    if (problem.status >= 500) this.logger.error(`[${problem.requestId}] ${exception instanceof Error ? exception.stack : String(exception)}`);
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(e: unknown): Problem {
    if (e instanceof AppError) {
      return {
        type: 'about:blank',
        title: HttpStatus[e.status]?.replace(/_/g, ' ').toLowerCase() ?? 'error',
        status: e.status,
        code: e.code,
        detail: e.message,
        ...extras(e.extras), // e.g. retryAfter, or the phone to verify on phone_not_verified
      };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const body = e.getResponse() as string | { message?: unknown; code?: string; errors?: unknown };
      const message = typeof body === 'string' ? body : body.message;
      return {
        type: 'about:blank',
        title: HttpStatus[status]?.replace(/_/g, ' ').toLowerCase() ?? 'error',
        status,
        code: (typeof body === 'object' && body.code) || HttpStatus[status]?.toLowerCase() || 'error',
        detail: Array.isArray(message) ? message.join('; ') : (message as string | undefined),
        errors: typeof body === 'object' ? body.errors : undefined,
        // extra fields a use case attaches (e.g. phone_not_verified carries the phone to verify)
        ...(typeof body === 'object' ? extras(body as Record<string, unknown>) : {}),
      };
    }
    const pgCode = (e as { code?: string })?.code;
    const constraint = (e as { constraint?: string })?.constraint;
    if (pgCode && (PG[pgCode] || (constraint && CONSTRAINTS[constraint]))) {
      const m = (constraint && CONSTRAINTS[constraint]) || PG[pgCode];
      // the database message names tables and constraints: log it, never send it
      this.logger.warn(`${pgCode} ${(e as Error).message}`);
      return { type: 'about:blank', title: m.title, status: m.status, code: m.code, detail: m.title };
    }
    return { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal' };
  }
}
