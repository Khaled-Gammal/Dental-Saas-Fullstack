import { describe, expect, it } from 'vitest';
import { todayIn } from '../booking';

describe('todayIn', () => {
  const lateCairoEvening = new Date('2026-12-16T21:30:00Z'); // 23:30 in Cairo (UTC+2 in winter), already the 17th in Riyadh (UTC+3)
  it('is the calendar date in the given zone, not the server or browser zone', () => {
    expect(todayIn('Africa/Cairo', lateCairoEvening)).toBe('2026-12-16');
    expect(todayIn('Asia/Riyadh', lateCairoEvening)).toBe('2026-12-17');
  });
  it('falls back to Cairo for an unknown zone', () => {
    expect(todayIn('Mars/Base', lateCairoEvening)).toBe('2026-12-16');
  });
});
