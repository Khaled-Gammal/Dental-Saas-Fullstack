import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import {
  BalancesQuery,
  Decision, Discount, EditInvoice, InvoicesQuery, InvoiceTotalsQuery, UnbilledQuery, MoveInstallment, NewInvoice, NewLine, NewPayment, NewPlan, NewRefund, Rejection, Reverse, RoleLimit, VoidInvoice, Waive, WriteOff,
} from './billing.schemas';
import { BillingService } from './billing.service';
import { MoneyControlsService } from './money-controls.service';

const id = new ParseUUIDPipe();
type Body<T extends z.ZodTypeAny> = z.infer<T>;

/** Invoices (SRS BILLING-*). Reading: invoices:read, or invoices:read:own for the doctor's patients (checked in the service). */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermission('invoices:read')
  list(@Query(new ZodBody(InvoicesQuery)) q: Body<typeof InvoicesQuery>) {
    return this.billing.list(q);
  }

  /** Redesign R7: the list's totals. Declared before `:id` so "totals" is not read as an invoice id. */
  @Get('totals')
  @RequirePermission('invoices:read')
  totals(@Query(new ZodBody(InvoiceTotalsQuery)) q: Body<typeof InvoiceTotalsQuery>) {
    return this.billing.totals(q);
  }

  /** The unbilled work (redesign R5). Declared before `:id` so "unbilled" is not read as an invoice id. */
  @Get('unbilled')
  @RequirePermission('invoices:read')
  unbilled(@Query(new ZodBody(UnbilledQuery)) q: Body<typeof UnbilledQuery>) {
    return this.billing.unbilled(q.limit);
  }

  @Post()
  @RequirePermission('invoices:write')
  create(@Body(new ZodBody(NewInvoice)) body: Body<typeof NewInvoice>) {
    return this.billing.create(body);
  }

  @Get(':id')
  get(@Param('id', id) invoiceId: string) {
    return this.billing.get(invoiceId);
  }

  @Patch(':id')
  @RequirePermission('invoices:write')
  edit(@Param('id', id) invoiceId: string, @Body(new ZodBody(EditInvoice)) body: Body<typeof EditInvoice>) {
    return this.billing.edit(invoiceId, body);
  }

  @Delete(':id') @HttpCode(204)
  @RequirePermission('invoices:write')
  remove(@Param('id', id) invoiceId: string) {
    return this.billing.remove(invoiceId);
  }

  @Post(':id/lines')
  @RequirePermission('invoices:write')
  addLine(@Param('id', id) invoiceId: string, @Body(new ZodBody(NewLine)) body: Body<typeof NewLine>) {
    return this.billing.addLine(invoiceId, body);
  }

  @Delete(':id/lines/:lineId')
  @RequirePermission('invoices:write')
  removeLine(@Param('id', id) invoiceId: string, @Param('lineId', id) lineId: string) {
    return this.billing.removeLine(invoiceId, lineId);
  }

  @Post(':id/issue') @HttpCode(200)
  @RequirePermission('invoices:write')
  issue(@Param('id', id) invoiceId: string) {
    return this.billing.issue(invoiceId);
  }

  @Post(':id/void') @HttpCode(200)
  @RequirePermission('invoices:void')
  void(@Param('id', id) invoiceId: string, @Body(new ZodBody(VoidInvoice)) body: Body<typeof VoidInvoice>) {
    return this.billing.void(invoiceId, body.reason);
  }

  @Post(':id/payments')
  @RequirePermission('payments:write')
  pay(@Param('id', id) invoiceId: string, @Body(new ZodBody(NewPayment)) body: Body<typeof NewPayment>) {
    return this.billing.pay(invoiceId, body);
  }
}

/** Payments (SRS PAY-*): receipt, reversal (CLR-05: owner, or the receiver the same day) and refunds. */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly billing: BillingService) {}

  @Get(':id')
  get(@Param('id', id) paymentId: string) {
    return this.billing.payment(paymentId);
  }

  @Post(':id/reverse') @HttpCode(200)
  @RequirePermission('payments:reverse')
  reverse(@Param('id', id) paymentId: string, @Body(new ZodBody(Reverse)) body: Body<typeof Reverse>) {
    return this.billing.reverse(paymentId, body.reason);
  }

  @Post(':id/refunds')
  @RequirePermission('payments:refund')
  refund(@Param('id', id) paymentId: string, @Body(new ZodBody(NewRefund)) body: Body<typeof NewRefund>) {
    return this.billing.refund(paymentId, body);
  }
}

/** A patient's balance, invoices and unbilled work (BILLING-005). */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('patients')
export class PatientBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get(':id/billing')
  @RequirePermission('patients:read')
  billingOf(@Param('id', id) patientId: string) {
    return this.billing.forPatient(patientId);
  }
}

/** Discounts (DISC-*), installment plans (PAY-004), waivers and write-offs (PAY-006). */
@ApiTags('billing')
@ApiBearerAuth()
@Controller()
export class MoneyControlsController {
  constructor(private readonly controls: MoneyControlsService) {}

  @Put('invoices/:id/discount')
  @RequirePermission('discounts:apply')
  setInvoiceDiscount(@Param('id', id) invoiceId: string, @Body(new ZodBody(Discount)) body: Body<typeof Discount>) {
    return this.controls.setDiscount(invoiceId, null, body);
  }

  @Delete('invoices/:id/discount')
  @RequirePermission('discounts:apply')
  clearInvoiceDiscount(@Param('id', id) invoiceId: string) {
    return this.controls.setDiscount(invoiceId, null, null);
  }

  @Put('invoices/:id/lines/:lineId/discount')
  @RequirePermission('discounts:apply')
  setLineDiscount(@Param('id', id) invoiceId: string, @Param('lineId', id) lineId: string, @Body(new ZodBody(Discount)) body: Body<typeof Discount>) {
    return this.controls.setDiscount(invoiceId, lineId, body);
  }

  @Delete('invoices/:id/lines/:lineId/discount')
  @RequirePermission('discounts:apply')
  clearLineDiscount(@Param('id', id) invoiceId: string, @Param('lineId', id) lineId: string) {
    return this.controls.setDiscount(invoiceId, lineId, null);
  }

  @Post('invoices/:id/discount/approve') @HttpCode(200)
  @RequirePermission('discounts:approve')
  approve(@Param('id', id) invoiceId: string, @Body(new ZodBody(Decision)) body: Body<typeof Decision>) {
    return this.controls.decide(invoiceId, true, body.note ?? null);
  }

  @Post('invoices/:id/discount/reject') @HttpCode(200)
  @RequirePermission('discounts:approve')
  reject(@Param('id', id) invoiceId: string, @Body(new ZodBody(Rejection)) body: Body<typeof Rejection>) {
    return this.controls.decide(invoiceId, false, body.note);
  }

  /** The approval queue (DISC-003). */
  @Get('discounts/pending')
  @RequirePermission('discounts:approve')
  pending() {
    return this.controls.pending();
  }

  /** Each role's limit (DISC-002); read by approvers, set by the owner. */
  @Get('discounts/limits')
  @RequirePermission('discounts:approve')
  limits() {
    return this.controls.limits();
  }

  @Patch('discounts/limits/:roleId')
  @RequirePermission('staff:manage')
  setLimit(@Param('roleId', id) roleId: string, @Body(new ZodBody(RoleLimit)) body: Body<typeof RoleLimit>) {
    return this.controls.setLimit(roleId, body.maxDiscountBp, body.maxDiscountMinor);
  }

  @Post('invoices/:id/plan')
  @RequirePermission('payments:write')
  createPlan(@Param('id', id) invoiceId: string, @Body(new ZodBody(NewPlan)) body: Body<typeof NewPlan>) {
    return this.controls.createPlan(invoiceId, body);
  }

  @Patch('installments/:id')
  @RequirePermission('payments:write')
  moveInstallment(@Param('id', id) installmentId: string, @Body(new ZodBody(MoveInstallment)) body: Body<typeof MoveInstallment>) {
    return this.controls.moveInstallment(installmentId, body.dueDate);
  }

  @Get('installments/overdue')
  @RequirePermission('invoices:read')
  overdue() {
    return this.controls.overdue();
  }

  @Post('invoices/:id/write-off')
  @RequirePermission('payments:adjust')
  writeOff(@Param('id', id) invoiceId: string, @Body(new ZodBody(WriteOff)) body: Body<typeof WriteOff>) {
    return this.controls.writeOff(invoiceId, body.amountMinor, body.reason);
  }

  @Post('installments/:id/waive') @HttpCode(200)
  @RequirePermission('payments:adjust')
  waive(@Param('id', id) installmentId: string, @Body(new ZodBody(Waive)) body: Body<typeof Waive>) {
    return this.controls.waive(installmentId, body.reason);
  }
}

/** BILLING-005 at check-in: `GET /balances?patientIds=a,b` — invoices:read, or invoices:read:own for the doctor's patients. */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('balances')
export class BalancesController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermission('patients:read')
  balances(@Query(new ZodBody(BalancesQuery)) q: Body<typeof BalancesQuery>) {
    return this.billing.balances(q.patientIds);
  }
}
