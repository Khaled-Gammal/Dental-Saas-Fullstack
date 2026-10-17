import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { EditInvoice, InvoicesQuery, NewInvoice, NewLine, NewPayment, NewRefund, Reverse, VoidInvoice } from './billing.schemas';
import { BillingService } from './billing.service';

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
