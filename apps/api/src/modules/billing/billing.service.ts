import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Tx } from '@dental/db';
import { hasPermission } from '../../auth/permissions';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { dateInZone, safeTimeZone } from '../../shared/time/clinic-time';
import { PatientDirectory } from '../patients';
import { AuditLog } from '../../shared/audit/audit-log';
import { canReverse, cleanReference, discountDecision, procedureLine, servicePrice, taxOf } from './billing-rules';
import { BillingRepository } from './billing.repository';
import type { InvoicesQueryInput, InvoiceTotalsQueryInput, NewInvoiceInput, NewLineInput, NewPaymentInput, NewRefundInput, ServiceLineInput } from './billing.schemas';

const invoiceNotFound = () => Err.notFound('invoice_not_found', 'Invoice not found');
const PAYABLE = ['issued', 'partially_paid'];

/**
 * Invoices and payments (SRS BILLING-001…005, PAY-001…003, PAY-005). The database derives every total, numbers the
 * invoice, locks what is issued and keeps recorded money immutable; this service checks who may act, turns a request
 * into rows, and answers with the whole invoice. Every write is audited by the database triggers (AUDIT-001).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: BillingRepository,
    private readonly patients: PatientDirectory,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditLog,
  ) {}

  private can(p: string) { return hasPermission(this.cls.get('permissions'), p); }
  private member(): string {
    const m = this.cls.get('memberId');
    if (!m) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    return m;
  }

  /** invoices:read, or invoices:read:own for a patient the doctor treats or has booked. */
  private async assertReadsPatient(tx: Tx, patientId: string) {
    if (this.can('invoices:read')) return;
    if (this.can('invoices:read:own')) {
      const doctorId = await this.repo.doctorOfMember(tx, this.member());
      if (doctorId && (await this.repo.doctorTreats(tx, doctorId, patientId))) return;
    }
    throw Err.forbidden('missing_permission', 'Missing permission: invoices:read');
  }

  /** BILLING-005 at check-in: the outstanding balance of the day's patients, for whoever may see them (as forPatient). */
  balances(patientIds: string[]) {
    return this.db.run(async (tx) => {
      if (this.can('invoices:read')) return this.repo.balances(tx, patientIds, null);
      const doctorId = this.can('invoices:read:own') ? await this.repo.doctorOfMember(tx, this.member()) : null;
      if (!doctorId) throw Err.forbidden('missing_permission', 'Missing permission: invoices:read');
      return this.repo.balances(tx, patientIds, doctorId);
    });
  }

  list(q: InvoicesQueryInput) {
    if (!this.can('invoices:read')) throw Err.forbidden('missing_permission', 'Missing permission: invoices:read');
    return this.db.run((tx) => this.repo.list(tx, q));
  }

  /** Redesign R7: the totals row of the invoice list (the same filters, every page), in the clinic currency. */
  totals(q: InvoiceTotalsQueryInput) {
    if (!this.can('invoices:read')) throw Err.forbidden('missing_permission', 'Missing permission: invoices:read');
    return this.db.run(async (tx, tenantId) => {
      const [clinic, totals] = await Promise.all([this.repo.clinic(tx, tenantId), this.repo.totals(tx, q)]);
      return { currency: clinic.currency, ...totals };
    });
  }

  /** Redesign R5: everything done and not billed yet, per patient and branch, so no finished work is forgotten. */
  unbilled(limit: number) {
    if (!this.can('invoices:read')) throw Err.forbidden('missing_permission', 'Missing permission: invoices:read');
    return this.db.run(async (tx, tenantId) => {
      const [clinic, items] = await Promise.all([this.repo.clinic(tx, tenantId), this.repo.unbilledByPatient(tx, limit)]);
      return { currency: clinic.currency, items };
    });
  }

  /** A patient's money at a glance (BILLING-005): balance, invoices, and what is still to bill. */
  forPatient(patientId: string) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.patients.exists(tx, tenantId, patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      await this.assertReadsPatient(tx, patientId);
      const [clinic, balance, invoices, unbilled] = await Promise.all([
        this.repo.clinic(tx, tenantId), this.repo.balance(tx, patientId), this.repo.list(tx, { patientId, limit: 200 }), this.repo.unbilledProcedures(tx, patientId),
      ]);
      return { currency: clinic.currency, balance_minor: balance, invoices, unbilled };
    });
  }

  get(id: string) {
    return this.db.run((tx) => this.view(tx, id));
  }

  /** BILLING-001: a draft from unbilled procedures and/or service lines, in the clinic currency. */
  create(input: NewInvoiceInput) {
    return this.db.run(async (tx, tenantId) => {
      if (!(await this.patients.exists(tx, tenantId, input.patientId))) throw Err.notFound('patient_not_found', 'Patient not found');
      if (!(await this.repo.branchExists(tx, input.branchId))) throw Err.badRequest('branch_not_found', 'Branch not found');
      if (!input.procedureIds.length && !input.lines.length) throw Err.badRequest('invoice_empty', 'Add at least one procedure or line');
      const clinic = await this.repo.clinic(tx, tenantId);
      const id = await this.repo.create(tx, tenantId, {
        patientId: input.patientId, branchId: input.branchId, currency: clinic.currency, notes: input.notes ?? null, dueDate: input.dueDate ?? null, createdBy: this.member(),
      });
      await this.addProcedures(tx, tenantId, id, input.patientId, input.procedureIds);
      for (const l of input.lines) await this.addServiceLine(tx, tenantId, id, l);
      return this.view(tx, id);
    });
  }

  edit(id: string, f: { notes?: string | null; dueDate?: string | null }) {
    return this.db.run(async (tx) => {
      await this.draft(tx, id);
      await this.repo.update(tx, id, { ...(f.notes !== undefined && { notes: f.notes }), ...(f.dueDate !== undefined && { due_date: f.dueDate }) });
      return this.view(tx, id);
    });
  }

  addLine(id: string, line: NewLineInput) {
    return this.db.run(async (tx, tenantId) => {
      const inv = await this.draft(tx, id);
      if ('procedureId' in line) await this.addProcedures(tx, tenantId, id, inv.patient_id, [line.procedureId]);
      else await this.addServiceLine(tx, tenantId, id, line);
      await this.reevaluateDiscount(tx, id);
      return this.view(tx, id);
    });
  }

  removeLine(id: string, lineId: string) {
    return this.db.run(async (tx) => {
      await this.draft(tx, id);
      if (!(await this.repo.removeLine(tx, id, lineId))) throw Err.notFound('line_not_found', 'Line not found');
      await this.reevaluateDiscount(tx, id);
      return this.view(tx, id);
    });
  }

  /** A draft is thrown away; an issued invoice is voided instead (BILLING-003). */
  remove(id: string) {
    return this.db.run(async (tx) => {
      await this.draft(tx, id);
      await this.repo.remove(tx, id);
    });
  }

  /** BILLING-002: the database numbers it ({prefix}-{year}-{sequence}, gap-free), sets the date and tax, and locks it. */
  issue(id: string) {
    return this.db.run(async (tx) => {
      await this.draft(tx, id);
      await this.repo.issue(tx, id);
      return this.view(tx, id);
    });
  }

  /** BILLING-003: with a reason, only when nothing is paid (refund or reverse first). */
  void(id: string, reason: string) {
    return this.db.run(async (tx) => {
      const inv = await this.repo.lock(tx, id);
      if (!inv) throw invoiceNotFound();
      if (inv.status === 'draft') throw Err.conflict('invoice_draft', 'A draft is deleted, not voided');
      if (inv.status === 'void') throw Err.conflict('invoice_void', 'The invoice is already void');
      const full = (await this.repo.get(tx, id))!;
      if (full.paid_minor > 0) throw Err.conflict('invoice_has_payments', 'Refund or reverse the payments before voiding');
      await this.repo.update(tx, id, { status: 'void', void_reason: reason, voided_at: new Date(), voided_by: this.member() });
      return this.view(tx, id);
    });
  }

  /**
   * PAY-001: the signed-in member is always the receiver; amount ≤ balance and one payment per idempotency key (the
   * database holds both under concurrency). Recorded now; dating a payment back waits for the cash days (Phase E3).
   */
  pay(id: string, input: NewPaymentInput) {
    return this.db.run(async (tx, tenantId) => {
      const again = await this.repo.byIdempotencyKey(tx, input.idempotencyKey);
      if (again) {
        if (again.invoice_id !== id) throw Err.conflict('idempotency_key_reused', 'This key was used for another payment');
        return this.view(tx, id); // the same request again: one payment
      }
      const inv = await this.repo.lock(tx, id);
      if (!inv) throw invoiceNotFound();
      if (!PAYABLE.includes(inv.status)) throw Err.conflict('invoice_not_payable', inv.status === 'paid' ? 'The invoice is fully paid' : 'Only an issued invoice is paid', { status: inv.status });
      const full = (await this.repo.get(tx, id))!;
      if (input.amountMinor > full.balance_minor) throw Err.badRequest('amount_exceeds_balance', 'The amount is more than what is owed', { balance: full.balance_minor });
      if (input.installmentId) {
        // PAY-004: an installment of this invoice's plan, still open, and not more than what is left of it
        const ins = await this.repo.installment(tx, input.installmentId);
        if (!ins || ins.invoice_id !== id || ins.plan_status !== 'active') throw Err.badRequest('installment_invoice_mismatch', 'This installment is not on this invoice');
        if (!['due', 'partially_paid'].includes(ins.status)) throw Err.conflict('installment_closed', `This installment is ${ins.status}`);
        if (input.amountMinor > ins.amount_minor - ins.paid_minor) throw Err.badRequest('amount_exceeds_installment', 'The amount is more than what is left of the installment', { left: ins.amount_minor - ins.paid_minor });
      }
      await this.repo.addPayment(tx, tenantId, {
        installmentId: input.installmentId ?? null,
        invoiceId: id, patientId: inv.patient_id, branchId: inv.branch_id, amountMinor: input.amountMinor, currency: inv.currency, method: input.method,
        reference: cleanReference(input.method, input.reference), notes: input.notes ?? null, idempotencyKey: input.idempotencyKey, receivedBy: this.member(),
      });
      return this.view(tx, id);
    });
  }

  /** One payment, for its receipt (BILLING-004). */
  payment(id: string) {
    return this.db.run(async (tx) => {
      const p = await this.repo.payment(tx, id);
      if (!p) throw Err.notFound('payment_not_found', 'Payment not found');
      await this.assertReadsPatient(tx, p.patient_id);
      const inv = p.invoice_id ? await this.repo.get(tx, p.invoice_id) : null;
      return { ...p, invoice: inv };
    });
  }

  /** PAY-003 + CLR-05: entered in error; the owner any time, the receiver on the same clinic day. Kept visible. */
  reverse(paymentId: string, reason: string) {
    return this.db.run(async (tx, tenantId) => {
      const p = await this.repo.lockPayment(tx, paymentId);
      if (!p) throw Err.notFound('payment_not_found', 'Payment not found');
      if (p.status !== 'succeeded' || Number(p.refunded_minor) > 0) throw Err.conflict('payment_not_reversible', 'Only a payment with no refunds can be reversed');
      const tz = safeTimeZone((await this.repo.clinic(tx, tenantId)).timezone);
      const today = dateInZone(Date.now(), tz);
      const actor = { isOwner: this.can('*'), memberId: this.member(), can: (x: string) => this.can(x) };
      if (!canReverse(actor, { received_by: p.received_by, paid_on: dateInZone(new Date(p.paid_at!).getTime(), tz) }, today)) {
        throw Err.forbidden('reversal_not_allowed', 'Only the person who received it can reverse it, on the same day; ask the owner');
      }
      await this.repo.reverse(tx, paymentId, actor.memberId, reason);
      return this.view(tx, p.invoice_id!);
    });
  }

  /** PAY-005 + CLR-05: money returned; the method is recorded and may differ from the payment's. */
  refund(paymentId: string, input: NewRefundInput) {
    return this.db.run(async (tx, tenantId) => {
      const p = await this.repo.lockPayment(tx, paymentId);
      if (!p) throw Err.notFound('payment_not_found', 'Payment not found');
      // review R11: checked after the payment lock, so a concurrent twin waits and then sees the first refund
      if (input.idempotencyKey) {
        const again = await this.repo.refundByIdempotencyKey(tx, input.idempotencyKey);
        if (again) {
          if (again.payment_id !== paymentId) throw Err.conflict('idempotency_key_reused', 'This key was used for another refund');
          return this.view(tx, p.invoice_id!); // the same request again: one refund
        }
      }
      if (!['succeeded', 'partially_refunded'].includes(p.status)) throw Err.conflict('payment_not_refundable', 'This payment cannot be refunded', { status: p.status });
      const full = (await this.repo.payment(tx, paymentId))!;
      if (input.amountMinor > full.amount_minor - full.refunded_minor) throw Err.badRequest('refund_exceeds_payment', 'Refunds cannot exceed the payment');
      await this.repo.addRefund(tx, tenantId, {
        paymentId, amountMinor: input.amountMinor, method: input.method, reason: input.reason,
        reference: input.method === 'cash' ? null : input.reference?.trim() || null, createdBy: this.member(), idempotencyKey: input.idempotencyKey ?? null,
      });
      return this.view(tx, p.invoice_id!);
    });
  }

  /**
   * DISC-002: after any change to a draft's discounts or lines, the discounts are measured again against the limit
   * of the member making the change; an earlier approval does not cover a different discount.
   */
  async reevaluateDiscount(tx: Tx, id: string): Promise<void> {
    const inv = await this.repo.get(tx, id);
    if (!inv || inv.status !== 'draft') return;
    const totals = await this.repo.discountTotals(tx, id);
    const member = this.member();
    const status = discountDecision(totals, await this.repo.roleLimit(tx, member), this.can('*'));
    if (status === 'none') {
      if (inv.discount_status !== 'none') await this.repo.setDiscountStatus(tx, id, { status: 'none', requestedBy: null });
      return;
    }
    await this.repo.setDiscountStatus(tx, id, { status, requestedBy: member });
    if (status === 'pending' && inv.discount_status !== 'pending') {
      await this.audit.record(tx, this.cls.get('tenantId')!, { action: 'invoice.discount_requested', entityType: 'invoice', entityId: id, changes: { total_minor: totals.total, gross_minor: totals.gross } });
    }
  }

  // ---------- helpers ----------
  async view(tx: Tx, id: string) {
    const inv = await this.repo.get(tx, id);
    if (!inv) throw invoiceNotFound();
    await this.assertReadsPatient(tx, inv.patient_id);
    const [lines, payments, plan, adjustments] = await Promise.all([this.repo.lines(tx, id), this.repo.paymentsOf(tx, id), this.repo.plan(tx, id), this.repo.adjustments(tx, id)]);
    const clinic = await this.repo.clinic(tx, this.cls.get('tenantId')!);
    // a draft shows the tax it will get when issued (the database computes the real one)
    const taxPreview = inv.status === 'draft' ? taxOf(inv.subtotal_minor - inv.discount_minor, clinic.tax_rate_bp) : inv.tax_minor;
    const tz = safeTimeZone(clinic.timezone);
    const today = dateInZone(Date.now(), tz);
    const actor = { isOwner: this.can('*'), memberId: this.cls.get('memberId') ?? '', can: (x: string) => this.can(x) };
    return {
      ...inv, lines, plan, adjustments, tax_rate_bp: clinic.tax_rate_bp, tax_preview_minor: taxPreview,
      payments: payments.map((p) => ({
        ...p,
        can: {
          reverse: p.status === 'succeeded' && p.refunded_minor === 0 && canReverse(actor, { received_by: p.received_by, paid_on: dateInZone(new Date(p.paid_at!).getTime(), tz) }, today),
          refund: this.can('payments:refund') && ['succeeded', 'partially_refunded'].includes(p.status),
        },
      })),
      can: {
        edit: inv.status === 'draft' && this.can('invoices:write'),
        issue: inv.status === 'draft' && this.can('invoices:write'),
        void: ['issued', 'partially_paid', 'paid'].includes(inv.status) && inv.paid_minor === 0 && this.can('invoices:void'),
        pay: PAYABLE.includes(inv.status) && this.can('payments:write'),
        discount: inv.status === 'draft' && this.can('discounts:apply'),
        decideDiscount: inv.status === 'draft' && inv.discount_status === 'pending' && this.can('discounts:approve') && inv.discount_requested_by !== actor.memberId,
        plan: PAYABLE.includes(inv.status) && this.can('payments:write') && (!plan || plan.status !== 'active'),
        adjust: PAYABLE.includes(inv.status) && this.can('payments:adjust'),
      },
    };
  }

  private async draft(tx: Tx, id: string) {
    const inv = await this.repo.lock(tx, id);
    if (!inv) throw invoiceNotFound();
    if (inv.status !== 'draft') throw Err.conflict('invoice_locked', 'The invoice is issued; it cannot change');
    return inv;
  }

  private async addProcedures(tx: Tx, tenantId: string, invoiceId: string, patientId: string, ids: string[]) {
    if (!ids.length) return;
    const found = await this.repo.unbilledProcedures(tx, patientId, ids);
    if (found.length !== new Set(ids).size) throw Err.badRequest('procedure_not_billable', 'A procedure is another patient\'s or already billed');
    for (const p of found) {
      await this.repo.addLine(tx, tenantId, invoiceId, {
        serviceId: p.service_id, procedureId: p.id, doctorId: p.doctor_id, description: procedureLine(p), toothCode: p.tooth_code, quantity: 1, unitPriceMinor: p.price_minor,
      });
    }
  }

  private async addServiceLine(tx: Tx, tenantId: string, invoiceId: string, l: ServiceLineInput) {
    let description = l.description ?? null;
    let unit = l.unitPriceMinor;
    if (l.serviceId) {
      const s = await this.repo.service(tx, l.serviceId);
      if (!s) throw Err.badRequest('service_not_found', 'Service not found');
      description ??= s.name_ar || s.name_en || 'خدمة';
      unit = servicePrice(s, l.unitPriceMinor);
    }
    await this.repo.addLine(tx, tenantId, invoiceId, {
      serviceId: l.serviceId ?? null, procedureId: null, doctorId: null, description: description!, toothCode: null, quantity: l.quantity, unitPriceMinor: unit!,
    });
  }
}
