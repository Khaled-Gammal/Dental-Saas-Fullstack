import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients';
import { InvoicesController, MoneyControlsController, PatientBillingController, PaymentsController } from './billing.controllers';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { MoneyControlsService } from './money-controls.service';

/**
 * Billing (SRS BILLING-*, PAY-001…003, PAY-005): invoices from procedures or services, issue with a gap-free number,
 * void, payments by method with references, reversals and refunds. Patients are read through `PatientDirectory`.
 */
@Module({
  imports: [PatientsModule],
  controllers: [InvoicesController, PaymentsController, PatientBillingController, MoneyControlsController],
  providers: [BillingService, BillingRepository, MoneyControlsService],
})
export class BillingModule {}
