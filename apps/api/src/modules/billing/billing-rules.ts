import { Err } from '../../shared/errors/app-error';

/** The methods reception offers (SRS PAY-001). `online` and `insurance` exist in the database for later. */
export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'wallet', 'instapay'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** A transfer, wallet or InstaPay payment carries its reference; card may (approval code); cash never does. */
export const REFERENCE_REQUIRED: readonly PaymentMethod[] = ['bank_transfer', 'wallet', 'instapay'];

export function cleanReference(method: PaymentMethod, reference: string | null | undefined): string | null {
  const ref = reference?.trim() || null;
  if (method === 'cash') return null;
  if (!ref && REFERENCE_REQUIRED.includes(method)) throw Err.badRequest('reference_required', 'Enter the transfer, wallet or InstaPay reference');
  return ref;
}

/** Tax on issue (BILLING-002): basis points of the taxable amount, half up to the minor unit — the database does the same. */
export const taxOf = (taxableMinor: number, rateBp: number) => Math.floor((taxableMinor * rateBp + 5000) / 10000);

/**
 * CLR-05: the owner reverses any payment; a member with `payments:reverse` reverses only a payment they received
 * themselves, on the same clinic day. (Once cash days exist, also only while that day is open.)
 */
export function canReverse(a: { isOwner: boolean; memberId: string; can: (p: string) => boolean },
  p: { received_by: string | null; paid_on: string }, today: string): boolean {
  if (a.isOwner) return true;
  return a.can('payments:reverse') && p.received_by === a.memberId && p.paid_on === today;
}

/** An invoice line for a procedure: the service name, the tooth when there is one, its recorded price. */
export function procedureLine(p: { service_ar: string | null; service_en: string | null; tooth_code: number | null; surfaces: string[] }): string {
  const name = p.service_ar || p.service_en || 'خدمة';
  if (!p.tooth_code) return name;
  return `${name} — سن ${p.tooth_code}${p.surfaces.length ? ` (${p.surfaces.join('')})` : ''}`;
}

/** A service line's price: the service price, within its range, or the price typed for a service priced on consultation (CLR-16). */
export function servicePrice(s: { price_minor: number; price_max_minor: number | null }, requested?: number): number {
  const min = s.price_minor, max = s.price_max_minor ?? s.price_minor;
  if (min === 0) {
    if (requested === undefined) throw Err.badRequest('price_required', 'This service is priced on consultation; enter the price');
    return requested;
  }
  const price = requested ?? min;
  if (price < min || price > max) throw Err.badRequest('price_out_of_range', 'The price must be within the service price range; a lower price is a discount', { min, max });
  return price;
}

export type DiscountStatus = 'none' | 'within_limit' | 'pending' | 'approved' | 'rejected';
/**
 * DISC-002 (CLR-02): all discounts on an invoice, as a share of its gross (quantity × unit price), against the
 * applier's role limit — a percentage and, when set, an amount cap. Over the limit waits for approval. Owners have none.
 */
export function discountDecision(t: { gross: number; total: number }, limit: { bp: number; minor: number | null }, unlimited: boolean): DiscountStatus {
  if (t.total <= 0) return 'none';
  if (unlimited) return 'within_limit';
  const withinShare = t.total * 10000 <= limit.bp * t.gross; // no rounding: 10 % of 1000.00 is exactly 100.00
  const withinCap = limit.minor === null || t.total <= limit.minor;
  return withinShare && withinCap ? 'within_limit' : 'pending';
}

/** PAY-004: a schedule must cover exactly what is owed, with dates in order. */
export function checkSchedule(balance: number, items: { dueDate: string; amountMinor: number }[]): string | null {
  if (!items.length || items.length > 60) return 'installments_count';
  if (items.reduce((s, i) => s + i.amountMinor, 0) !== balance) return 'installments_total_mismatch';
  for (let k = 1; k < items.length; k++) if (items[k]!.dueDate <= items[k - 1]!.dueDate) return 'installments_dates';
  return null;
}
