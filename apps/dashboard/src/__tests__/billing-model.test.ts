import { describe, expect, it } from 'vitest';
import { addMonthsIso, proposeSchedule, sharePercent } from '../billing-model';

describe('proposeSchedule (PAY-004)', () => {
  it('splits into equal whole pounds, the remainder on the last, monthly from the first date', () => {
    const s = proposeSchedule(100050, 3, '2031-01-31');
    expect(s.map((x) => x.amountMinor)).toEqual([33300, 33300, 33450]);
    expect(s.reduce((a, x) => a + x.amountMinor, 0)).toBe(100050);
    expect(s.map((x) => x.dueDate)).toEqual(['2031-01-31', '2031-02-28', '2031-03-31']);
  });
  it('one installment is the whole balance; nothing to split gives nothing', () => {
    expect(proposeSchedule(5000, 1, '2031-05-01')).toEqual([{ dueDate: '2031-05-01', amountMinor: 5000 }]);
    expect(proposeSchedule(0, 3, '2031-05-01')).toEqual([]);
  });
});

describe('helpers', () => {
  it('adds months and shows a share', () => {
    expect(addMonthsIso('2031-12-15', 1)).toBe('2032-01-15');
    expect(sharePercent(15000, 100000)).toBe(15);
    expect(sharePercent(1, 3)).toBe(33.3);
  });
});
