import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Tx } from '@dental/db';
import { hasPermission } from '../../auth/permissions';
import { AuditLog } from '../../shared/audit/audit-log';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { dateInZone, safeTimeZone } from '../../shared/time/clinic-time';
import { checkSchedule } from './billing-rules';
import { BillingRepository } from './billing.repository';
import type { DiscountInput, NewPlanInput } from './billing.schemas';
import { BillingService } from './billing.service';

const PAYABLE = ['issued', 'partially_paid'];

/**
 * Discounts with limits and approval (SRS DISC-001…003, CLR-02), installment plans (PAY-004) and waivers/write-offs
 * (PAY-006, CLR-12). The database derives every amount, refuses issuing a pending discount, self-approval, a
 * schedule that does not add up and any edit of an adjustment; this service checks who may act.
 */
@Injectable()
export class MoneyControlsService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: BillingRepository,
    private readonly billing: BillingService,
    private readonly audit: AuditLog,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private can(p: string) { return hasPermission(this.cls.get('permissions'), p); }
  private member(): string {
    const m = this.cls.get('memberId');
    if (!m) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    return m;
  }

  // ---------- discounts ----------
  /** DISC-001: on the whole invoice (lineId null) or one line; null removes it. Measured against the limit right away. */
  setDiscount(invoiceId: string, lineId: string | null, d: DiscountInput | null) {
    return this.db.run(async (tx) => {
      await this.draft(tx, invoiceId);
      if (lineId) {
        if (!(await this.repo.setLineDiscount(tx, invoiceId, lineId, d))) throw Err.notFound('line_not_found', 'Line not found');
      } else {
        await this.repo.setInvoiceDiscount(tx, invoiceId, d);
      }
      await this.billing.reevaluateDiscount(tx, invoiceId);
      return this.billing.view(tx, invoiceId);
    });
  }

  pending() {
    return this.db.run((tx) => this.repo.pendingDiscounts(tx));
  }

  /** DISC-003: the owner (discounts:approve) decides, never on their own request; the decision is audited. */
  decide(invoiceId: string, approve: boolean, note: string | null) {
    return this.db.run(async (tx, tenantId) => {
      const inv = await this.draft(tx, invoiceId);
      const full = (await this.repo.get(tx, invoiceId))!;
      if (full.discount_status !== 'pending') throw Err.conflict('discount_not_pending', 'There is no discount waiting for approval');
      if (full.discount_requested_by === this.member()) throw Err.forbidden('self_approval', 'A discount is approved by someone else');
      await this.repo.setDiscountStatus(tx, inv.id, { status: approve ? 'approved' : 'rejected', decidedBy: this.member(), note });
      await this.audit.record(tx, tenantId, {
        action: approve ? 'invoice.discount_approved' : 'invoice.discount_rejected', entityType: 'invoice', entityId: invoiceId, changes: { note: !!note },
      });
      return this.billing.view(tx, invoiceId);
    });
  }

  limits() {
    return this.db.run((tx) => this.repo.roleLimits(tx));
  }

  /** DISC-002: limits are settings the owner changes, not code. */
  setLimit(roleId: string, bp: number, minor: number | null) {
    return this.db.run(async (tx) => {
      if (!(await this.repo.setRoleLimit(tx, roleId, bp, minor))) throw Err.notFound('role_not_found', 'Role not found');
      return this.repo.roleLimits(tx);
    });
  }

  // ---------- installment plans ----------
  /** PAY-004: the open balance split into dated installments (proposed by the screen, edited, then saved here). */
  createPlan(invoiceId: string, input: NewPlanInput) {
    return this.db.run(async (tx, tenantId) => {
      const inv = await this.repo.lock(tx, invoiceId);
      if (!inv) throw Err.notFound('invoice_not_found', 'Invoice not found');
      if (!PAYABLE.includes(inv.status)) throw Err.conflict('invoice_not_payable', 'Only an issued, unpaid invoice is put on installments');
      const full = (await this.repo.get(tx, invoiceId))!;
      const plan = await this.repo.plan(tx, invoiceId);
      if (plan?.status === 'active') throw Err.conflict('plan_exists', 'This invoice already has an installment plan');
      const problem = checkSchedule(full.balance_minor, input.installments);
      if (problem) throw Err.badRequest(problem, 'The installments must add up to the balance, with dates in order', { balance: full.balance_minor });
      await this.repo.createPlan(tx, tenantId, {
        patientId: inv.patient_id, invoiceId, currency: inv.currency, total: full.total_minor, down: full.total_minor - full.balance_minor,
        notes: input.notes ?? null, createdBy: this.member(), installments: input.installments,
      });
      return this.billing.view(tx, invoiceId);
    });
  }

  /** Moving an unpaid installment's date (audited by the database); amounts stay as agreed. */
  moveInstallment(installmentId: string, dueDate: string) {
    return this.db.run(async (tx) => {
      const ins = await this.repo.installment(tx, installmentId);
      if (!ins) throw Err.notFound('installment_not_found', 'Installment not found');
      if (!['due', 'partially_paid'].includes(ins.status) || ins.plan_status !== 'active') throw Err.conflict('installment_closed', `This installment is ${ins.status}`);
      await this.repo.moveInstallment(tx, installmentId, dueDate);
      return this.billing.view(tx, ins.invoice_id!);
    });
  }

  /** Installments unpaid after their due date (PAY-004 acceptance 2: shown the day after). */
  overdue() {
    return this.db.run(async (tx, tenantId) => {
      const tz = safeTimeZone((await this.repo.clinic(tx, tenantId)).timezone);
      const today = dateInZone(Date.now(), tz);
      return { today, items: await this.repo.overdue(tx, today) };
    });
  }

  // ---------- waivers and write-offs (CLR-12: owner only) ----------
  writeOff(invoiceId: string, amountMinor: number, reason: string) {
    return this.db.run(async (tx, tenantId) => {
      const inv = await this.repo.lock(tx, invoiceId);
      if (!inv) throw Err.notFound('invoice_not_found', 'Invoice not found');
      if (!PAYABLE.includes(inv.status)) throw Err.conflict('invoice_not_payable', 'Only an open invoice is written off');
      const full = (await this.repo.get(tx, invoiceId))!;
      if (amountMinor > full.balance_minor) throw Err.badRequest('amount_exceeds_balance', 'The amount is more than what is owed', { balance: full.balance_minor });
      await this.repo.addAdjustment(tx, tenantId, { invoiceId, installmentId: null, kind: 'write_off', amountMinor, reason, createdBy: this.member() });
      return this.billing.view(tx, invoiceId);
    });
  }

  waive(installmentId: string, reason: string) {
    return this.db.run(async (tx, tenantId) => {
      const ins = await this.repo.installment(tx, installmentId);
      if (!ins) throw Err.notFound('installment_not_found', 'Installment not found');
      if (!['due', 'partially_paid'].includes(ins.status)) throw Err.conflict('installment_closed', `This installment is ${ins.status}`);
      await this.repo.addAdjustment(tx, tenantId, {
        invoiceId: ins.invoice_id!, installmentId, kind: 'waiver', amountMinor: ins.amount_minor - ins.paid_minor, reason, createdBy: this.member(),
      });
      return this.billing.view(tx, ins.invoice_id!);
    });
  }

  private async draft(tx: Tx, id: string) {
    const inv = await this.repo.lock(tx, id);
    if (!inv) throw Err.notFound('invoice_not_found', 'Invoice not found');
    if (inv.status !== 'draft') throw Err.conflict('invoice_locked', 'Discounts change only on a draft');
    return inv;
  }
}
