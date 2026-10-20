import { describe, expect, it } from 'vitest';
import { timeLabel, timeOptions } from '../time-model';

describe('the time field (redesign R5)', () => {
  it('labels a 24-hour time in Arabic with ص/م', () => {
    expect(timeLabel('00:00')).toBe('12:00 ص');
    expect(timeLabel('09:05')).toBe('9:05 ص');
    expect(timeLabel('12:00')).toBe('12:00 م');
    expect(timeLabel('17:30')).toBe('5:30 م');
    expect(timeLabel('23:55')).toBe('11:55 م');
    expect(timeLabel('')).toBe('');
  });

  it('lists the day in steps, keeping the values as HH:MM', () => {
    const five = timeOptions(5);
    expect(five).toHaveLength(288);
    expect(five[0]).toEqual({ value: '00:00', label: '12:00 ص' });
    expect(five.at(-1)).toEqual({ value: '23:55', label: '11:55 م' });
    expect(timeOptions(15).map((o) => o.value).slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
  });

  it('keeps a saved time that falls between steps, in its place', () => {
    const values = timeOptions(5, '17:07').map((o) => o.value);
    expect(values).toHaveLength(289);
    expect(values.slice(values.indexOf('17:05'), values.indexOf('17:05') + 3)).toEqual(['17:05', '17:07', '17:10']);
    expect(timeOptions(5, '17:05')).toHaveLength(288);
    expect(timeOptions(5, '')).toHaveLength(288);
  });
});
