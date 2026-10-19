import { Module } from '@nestjs/common';
import { CashService } from './cash.service';
import { ExpensesService } from './expenses.service';
import { CashController, ExpensesController } from './finance.controllers';
import { FinanceRepository } from './finance.repository';

/**
 * Clinic money outside patient invoices (SRS EXP-001…004, CASH-001…004): expenses with approval and the daily cash
 * box. Expenses never touch a patient's balance; the cash day reads payments and refunds but never writes them.
 */
@Module({
  controllers: [ExpensesController, CashController],
  providers: [ExpensesService, CashService, FinanceRepository],
})
export class FinanceModule {}
