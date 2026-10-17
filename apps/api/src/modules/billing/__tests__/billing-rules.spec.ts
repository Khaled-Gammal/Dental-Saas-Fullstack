import type { AppError } from '../../../shared/errors/app-error';
import { canReverse, cleanReference, procedureLine, servicePrice, taxOf } from '../billing-rules';

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as AppError).code; } return null; };

describe('cleanReference (PAY-001)', () => {
  it('requires it for transfer, wallet and InstaPay; keeps it for card; drops it for cash', () => {
    expect(code(() => cleanReference('wallet', '  '))).toBe('reference_required');
    expect(code(() => cleanReference('bank_transfer', undefined))).toBe('reference_required');
    expect(cleanReference('instapay', ' IP-1 ')).toBe('IP-1');
    expect(cleanReference('card', null)).toBeNull();
    expect(cleanReference('cash', 'ignored')).toBeNull();
  });
});

describe('taxOf (BILLING-002)', () => {
  it('rounds half up to the piastre, like the database', () => {
    expect(taxOf(25, 1400)).toBe(4); // 3.5 -> 4
    expect(taxOf(100000, 1400)).toBe(14000);
    expect(taxOf(100000, 0)).toBe(0);
  });
});

describe('canReverse (CLR-05)', () => {
  const member = (perms: string[], isOwner = false) => ({ isOwner, memberId: 'm1', can: (p: string) => perms.includes(p) });
  it('the owner reverses any payment', () => {
    expect(canReverse(member([], true), { received_by: 'other', paid_on: '2031-01-01' }, '2031-02-01')).toBe(true);
  });
  it('the receiver reverses only their own entry, only the same clinic day', () => {
    expect(canReverse(member(['payments:reverse']), { received_by: 'm1', paid_on: '2031-02-01' }, '2031-02-01')).toBe(true);
    expect(canReverse(member(['payments:reverse']), { received_by: 'm1', paid_on: '2031-01-31' }, '2031-02-01')).toBe(false);
    expect(canReverse(member(['payments:reverse']), { received_by: 'm2', paid_on: '2031-02-01' }, '2031-02-01')).toBe(false);
    expect(canReverse(member([]), { received_by: 'm1', paid_on: '2031-02-01' }, '2031-02-01')).toBe(false);
  });
});

describe('lines', () => {
  it('describe a procedure by service and tooth', () => {
    expect(procedureLine({ service_ar: 'حشو تجميلي', service_en: null, tooth_code: 36, surfaces: ['O', 'D'] })).toBe('حشو تجميلي — سن 36 (OD)');
    expect(procedureLine({ service_ar: 'كشف', service_en: null, tooth_code: null, surfaces: [] })).toBe('كشف');
  });
  it('price a service within its range (CLR-16)', () => {
    expect(servicePrice({ price_minor: 30000, price_max_minor: null })).toBe(30000);
    expect(code(() => servicePrice({ price_minor: 80000, price_max_minor: 120000 }, 50000))).toBe('price_out_of_range');
    expect(code(() => servicePrice({ price_minor: 0, price_max_minor: null }))).toBe('price_required');
  });
});
