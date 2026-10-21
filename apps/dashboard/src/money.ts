import { fmtNumber } from './util';

let clinicCurrency = 'EGP';

/**
 * The signed-in clinic's currency (CLR-09, L10N-005), recorded by the shell from the clinic profile. Amounts and
 * labels without an explicit currency follow it, so no screen hard-codes the pound.
 */
export function setClinicCurrency(currency: string | null | undefined): void {
  clinicCurrency = currency || 'EGP';
}

/** "ج.م" for the Egyptian pound, otherwise the ISO code (as on invoices). */
export const currencyLabel = (currency = clinicCurrency): string => (currency === 'EGP' ? 'ج.م' : currency);

/**
 * Minor units as "1,250.50 ج.م" in the clinic currency (whole amounts without decimals). Stored values are never
 * changed by display.
 */
export function money(minor: number, currency = clinicCurrency): string {
  const major = minor / 100;
  const n = Number.isInteger(major) ? fmtNumber(major) : major.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${currencyLabel(currency)}`;
}
