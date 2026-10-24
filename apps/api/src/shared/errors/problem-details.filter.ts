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
  // billing (Phase E1)
  tenants_currency_locked: { status: 409, code: 'currency_locked', title: 'The currency is fixed once an invoice is issued' },
  invoices_locked: { status: 409, code: 'invoice_locked', title: 'The invoice is issued; it cannot change' },
  invoices_empty: { status: 400, code: 'invoice_empty', title: 'Add at least one line before issuing' },
  invoices_check2: { status: 400, code: 'amount_exceeds_balance', title: 'The amount is more than what is owed' },
  invoices_clinic_currency: { status: 400, code: 'currency_mismatch', title: 'The invoice must be in the clinic currency' },
  payments_reference_required: { status: 400, code: 'reference_required', title: 'Enter the transfer, wallet or InstaPay reference' },
  payments_not_reversible: { status: 409, code: 'payment_not_reversible', title: 'Only a payment with no refunds can be reversed' },
  refunds_exceed_payment: { status: 400, code: 'refund_exceeds_payment', title: 'Refunds cannot exceed the payment' },
  refunds_payment_not_refundable: { status: 409, code: 'payment_not_refundable', title: 'This payment cannot be refunded' },
  // discounts, installments, adjustments (Phase E2)
  invoices_discount_pending: { status: 409, code: 'discount_pending_approval', title: 'The discount waits for approval' },
  invoices_discount_self_approval: { status: 403, code: 'self_approval', title: 'A discount is approved by someone else' },
  invoices_discount_le_subtotal: { status: 400, code: 'discount_exceeds_subtotal', title: 'The discount is more than the subtotal' },
  invoices_discount_reason: { status: 400, code: 'discount_reason_required', title: 'Give the reason for the discount' },
  invoice_items_discount_reason: { status: 400, code: 'discount_reason_required', title: 'Give the reason for the discount' },
  invoice_items_line_total_minor_check: { status: 400, code: 'discount_exceeds_subtotal', title: 'The discount is more than the line' },
  payment_plans_one_active_per_invoice: { status: 409, code: 'plan_exists', title: 'This invoice already has an installment plan' },
  installments_check: { status: 400, code: 'amount_exceeds_installment', title: 'The amount is more than what is left of the installment' },
  balance_adjustments_exceeds_balance: { status: 400, code: 'amount_exceeds_balance', title: 'The amount is more than what is owed' },
  balance_adjustments_invoice_open: { status: 409, code: 'invoice_not_payable', title: 'Only an open invoice is adjusted' },
  balance_adjustments_installment: { status: 409, code: 'installment_closed', title: 'Only an unpaid installment is waived' },
  patients_merge_self: { status: 400, code: 'merge_self', title: 'Choose another record to merge into this one' },
  patients_already_merged: { status: 409, code: 'already_merged', title: 'One of the records is already merged' },
  // expenses and the cash day (Phase E3)
  expenses_future: { status: 400, code: 'date_in_future', title: 'An expense is not dated in the future' },
  payments_future: { status: 400, code: 'date_in_future', title: 'A payment is not dated in the future' },
  expenses_locked: { status: 409, code: 'expense_locked', title: 'A recorded expense is not edited; void it and record it again' },
  expenses_self_approval: { status: 403, code: 'self_approval', title: 'An expense is approved by someone else' },
  // the platform admin panel (Phase H5): the platform_*() functions check these
  platform_admin_only: { status: 401, code: 'platform_session_required', title: 'Sign in to the platform panel' },
  platform_trial_range: { status: 400, code: 'trial_out_of_range', title: 'A trial ends after today and within a year' },
  platform_not_trialing: { status: 409, code: 'not_trialing', title: 'The clinic is not on a trial' },
  platform_status: { status: 409, code: 'clinic_status', title: 'The clinic is not in a state that allows this' },
  platform_clinic_missing: { status: 404, code: 'clinic_not_found', title: 'Clinic not found' },
  platform_trial_ended: { status: 409, code: 'trial_ended', title: 'The trial has ended: extend it or activate the subscription' },
  platform_already_active: { status: 409, code: 'already_active', title: 'The subscription is already active' },
  platform_cycle: { status: 400, code: 'validation_failed', title: 'A subscription is monthly or yearly' },
  platform_plan_missing: { status: 404, code: 'subscription_plan_not_found', title: 'Plan not found' },
  lead_not_found: { status: 404, code: 'lead_not_found', title: 'Request not found' },
  // data export and clinic deletion (Phase H8)
  data_exports_one_open: { status: 409, code: 'export_in_progress', title: 'An export of this clinic is already being prepared' },
  clinic_owner_only: { status: 403, code: 'owner_only', title: 'Only the clinic owner can do this' },
  tenants_suspension_reason: { status: 400, code: 'reason_required', title: 'Give the reason (3 characters at least)' },
  // custom roles (Phase H4): the service checks these first; the database is the last word
  roles_owner_fixed: { status: 409, code: 'owner_role_fixed', title: 'The owner role keeps every permission' },
  roles_permission_unknown: { status: 400, code: 'permission_unknown', title: 'This permission cannot be given to a role' },
  roles_archived: { status: 409, code: 'role_archived', title: 'This role is archived' },
  roles_tenant_name_ar: { status: 409, code: 'role_name_taken', title: 'A role with this name exists' },
  tenant_members_tenant_id_role_id_fkey: { status: 409, code: 'role_in_use', title: 'Members or invitations still have this role' },
  invitations_tenant_id_role_id_fkey: { status: 409, code: 'role_in_use', title: 'Members or invitations still have this role' },
  // the supporting document (Phase H2): the service checks these first; the database is the last word under races
  expenses_document_fixed: { status: 409, code: 'expense_has_document', title: 'This expense already has its document' },
  expenses_document_private: { status: 400, code: 'file_not_found', title: 'File not found' },
  expenses_file: { status: 409, code: 'expense_has_document', title: 'This expense already has its document' },
  expenses_void_complete: { status: 400, code: 'void_reason_required', title: 'Give the reason for voiding' },
  expenses_reference_required: { status: 400, code: 'reference_required', title: 'Enter the transfer, wallet or InstaPay reference' },
  expense_categories_tenant_id_name_key: { status: 409, code: 'category_name_taken', title: 'A category with this name exists' },
  cash_session_closed: { status: 409, code: 'session_closed', title: 'The cash day is closed; the owner can reopen it' },
  cash_sessions_one_per_day: { status: 409, code: 'session_already_open', title: 'Today’s cash session already exists' },
  cash_sessions_one_open_per_branch: { status: 409, code: 'another_session_open', title: 'Another cash session of this branch is open; close it first' },
  cash_sessions_difference_note: { status: 400, code: 'difference_note_required', title: 'Explain the difference between the counted and the expected cash' },
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
