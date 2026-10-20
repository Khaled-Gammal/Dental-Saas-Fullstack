/** An expense's supporting document (EXP-001): its storage key and its signed links (the "expense:" scope). */
import { PrivateFileSigner } from '../../shared/storage/private-files';

/** Storage key of an expense document (server-generated only). */
export const expenseKey = (tenantId: string, fileId: string) => `t/${tenantId}/expenses/${fileId}`;

/** A 5-minute link to one expense document for one signed-in user. */
export class ExpenseFileSigner extends PrivateFileSigner {
  constructor(secret: string, baseUrl: string) {
    super(secret, baseUrl, 'expense', 'expense-files');
  }
}
export const EXPENSE_FILE_SIGNER = Symbol('EXPENSE_FILE_SIGNER');
