import { cancelBlock, changeDeadline, MAX_PATIENT_RESCHEDULES, rescheduleBlock, statusAfterMove, type SelfServiceState } from '../self-service';

const H = 3_600_000;
const startsAt = new Date('2026-12-10T15:00:00Z');
const s = (o: Partial<SelfServiceState> = {}): SelfServiceState => ({ status: 'confirmed', startsAt, patientReschedules: 0, onlineDoctor: true, ...o });
const at = (hoursBefore: number) => startsAt.getTime() - hoursBefore * H;

describe('what a patient may do from their link (Phase 2E)', () => {
  it('cancel or move until the clinic\'s window before the visit', () => {
    expect(cancelBlock(s(), at(13), 12)).toBeNull();
    expect(cancelBlock(s(), at(12), 12)).toBeNull(); // exactly at the deadline: still allowed
    expect(cancelBlock(s(), at(11.9), 12)).toBe('too_late');
    expect(rescheduleBlock(s(), at(11.9), 12)).toBe('too_late');
    expect(changeDeadline(startsAt, 12).toISOString()).toBe('2026-12-10T03:00:00.000Z');
  });
  it('a window of 0: until the visit starts', () => {
    expect(cancelBlock(s(), at(0.1), 0)).toBeNull();
    expect(cancelBlock(s(), at(0), 0)).toBe('started');
  });
  it('only a booking still ahead (pending or confirmed)', () => {
    for (const status of ['cancelled', 'checked_in', 'completed', 'no_show', 'in_progress', 'held', 'expired'] as const) expect(cancelBlock(s({ status }), at(48), 12)).toBe('not_active');
    expect(cancelBlock(s({ status: 'pending' }), at(48), 12)).toBeNull();
  });
  it('moved at most a fixed number of times; then cancel only', () => {
    expect(rescheduleBlock(s({ patientReschedules: MAX_PATIENT_RESCHEDULES - 1 }), at(48), 12)).toBeNull();
    expect(rescheduleBlock(s({ patientReschedules: MAX_PATIENT_RESCHEDULES }), at(48), 12)).toBe('limit');
    expect(cancelBlock(s({ patientReschedules: MAX_PATIENT_RESCHEDULES }), at(48), 12)).toBeNull();
  });
  it('a doctor who no longer takes website bookings: cancel only (call to move)', () => {
    expect(rescheduleBlock(s({ onlineDoctor: false }), at(48), 12)).toBe('not_online');
    expect(cancelBlock(s({ onlineDoctor: false }), at(48), 12)).toBeNull();
  });
  it('after a move: as the clinic confirms website bookings', () => {
    expect(statusAfterMove('confirmed', true)).toBe('confirmed');
    expect(statusAfterMove('confirmed', false)).toBe('pending');
    expect(statusAfterMove('pending', false)).toBe('pending');
    expect(statusAfterMove('pending', true)).toBe('confirmed');
  });
});
