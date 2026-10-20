import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { CashService } from './cash.service';
import { EXPENSE_FILE_SIGNER, ExpenseFileSigner } from './expense-files';
import { ExpensesService } from './expenses.service';
import { CashController, ExpenseFileLinkController, ExpensesController } from './finance.controllers';
import { FinanceRepository } from './finance.repository';

/**
 * Clinic money outside patient invoices (SRS EXP-001…004, CASH-001…004): expenses with approval and the daily cash
 * box. Expenses never touch a patient's balance; the cash day reads payments and refunds but never writes them.
 */
@Module({
  controllers: [ExpensesController, CashController, ExpenseFileLinkController],
  providers: [
    ExpensesService, CashService, FinanceRepository,
    // its own key domain ("expense:" in the MAC), so a clinical or website-image link can never be replayed as an expense one
    { provide: EXPENSE_FILE_SIGNER, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => new ExpenseFileSigner(cfg.MEDIA_URL_SECRET, cfg.API_PUBLIC_URL) },
  ],
})
export class FinanceModule {}
