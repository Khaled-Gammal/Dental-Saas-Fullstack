import { heartbeatStatus, heartbeatWriter } from '../heartbeat';

describe('worker heartbeat (Phase 1B)', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  it('fresh within the limit, stale after it, missing or garbled is down', () => {
    expect(heartbeatStatus(String(now - 30_000), now, 600_000)).toEqual({ ok: true, lastBeatAt: '2026-10-31T11:59:30.000Z', ageSeconds: 30 });
    expect(heartbeatStatus(String(now - 601_000), now, 600_000).ok).toBe(false);
    expect(heartbeatStatus(null, now, 600_000)).toEqual({ ok: false, lastBeatAt: null, ageSeconds: null });
    expect(heartbeatStatus('soon', now, 600_000).ok).toBe(false);
  });
  it('writes at most once per interval; a failed write is retried on the next job', async () => {
    let t = 0;
    const writes: string[] = [];
    let fail = false;
    const beat = heartbeatWriter(async (v) => { writes.push(v); if (fail) throw new Error('redis down'); }, 15_000, () => t);
    beat(); t = 5_000; beat();
    expect(writes).toEqual(['0']);
    t = 16_000; fail = true; beat();
    await new Promise((r) => setTimeout(r, 0));
    fail = false; t = 17_000; beat();
    expect(writes).toEqual(['0', '16000', '17000']);
  });
});
