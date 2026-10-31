import { WORKER_POLICY } from '../../config';

/**
 * Phase 1B (monitoring): the worker proves it is alive by writing the time to Redis after each job that completes (the
 * outbox relay runs every 5 s); GET /health/worker reads it, so an uptime monitor notices a worker that died or hangs — the
 * API alone keeps answering /health while no reminder or receipt goes out.
 */
export const HEARTBEAT_KEY = WORKER_POLICY.heartbeatKey;

export interface HeartbeatStatus { ok: boolean; lastBeatAt: string | null; ageSeconds: number | null }

export function heartbeatStatus(raw: string | null, now = Date.now(), staleAfterMs: number = WORKER_POLICY.heartbeatStaleMs): HeartbeatStatus {
  const at = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(at)) return { ok: false, lastBeatAt: null, ageSeconds: null };
  const age = Math.max(0, now - at);
  return { ok: age <= staleAfterMs, lastBeatAt: new Date(at).toISOString(), ageSeconds: Math.round(age / 1000) };
}

/** Throttled writer for the worker: at most one Redis write per `everyMs`, errors ignored (a heartbeat must never fail a job). */
export function heartbeatWriter(write: (value: string) => Promise<unknown>, everyMs: number = WORKER_POLICY.heartbeatEveryMs, now: () => number = Date.now) {
  let last = -Infinity;
  return (): void => {
    const t = now();
    if (t - last < everyMs) return;
    last = t;
    write(String(t)).catch(() => { last = -Infinity; /* retried on the next job */ });
  };
}
