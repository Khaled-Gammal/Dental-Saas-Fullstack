/** Pure helpers of the billing screens (SRS PAY-004, DISC-*). Unit-tested; no React. */

/** Adds whole months, keeping the day or the last day of a shorter month. */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * PAY-004: a proposed monthly schedule for what is owed. Equal installments in whole pounds; the remainder (and
 * any piastres) goes on the last one, so the total is always exact. The screen lets the user edit it before saving.
 */
export function proposeSchedule(balanceMinor: number, count: number, firstDate: string): { dueDate: string; amountMinor: number }[] {
  if (count < 1 || balanceMinor <= 0) return [];
  const each = Math.floor(balanceMinor / count / 100) * 100;
  return Array.from({ length: count }, (_, k) => ({
    dueDate: addMonthsIso(firstDate, k),
    amountMinor: k === count - 1 ? balanceMinor - each * (count - 1) : each,
  }));
}

/** The share a discount is of the gross, in percent with one decimal, for showing against a limit. */
export const sharePercent = (discountMinor: number, grossMinor: number) => (grossMinor > 0 ? Math.round((discountMinor * 1000) / grossMinor) / 10 : 0);
