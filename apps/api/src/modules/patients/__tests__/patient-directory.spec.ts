import { type AppError, Err } from '../../../shared/errors/app-error';
import { PatientDirectory } from '../patient-directory';

type Found = { id: string; is_blocked: boolean; email: string | null } | undefined;
function make(found: Found, planError?: AppError) {
  const calls: string[] = [];
  const repo = {
    findByPhoneAndName: async () => found,
    update: async () => { calls.push('update'); },
    addTag: async (_tx: unknown, _id: string, tag: string) => { calls.push(`tag:${tag}`); },
    countActive: async () => 2000,
    createFromBooking: async () => { calls.push('create'); return { id: 'new' }; },
  };
  const plan = { assertCanAdd: async () => { if (planError) throw planError; } };
  const audit = { record: async (_tx: unknown, _t: string, e: { action: string }) => { calls.push(e.action); } };
  const dir = new PatientDirectory(repo as never, plan as never, audit as never);
  return { dir, calls };
}
const input = { fullName: 'A', phone: '+201000000000', email: 'a@x.test', preferredBranchId: 'b' };

describe('PatientDirectory.matchOrCreateForBooking', () => {
  it('a blocked match is refused without creating anything', async () => {
    const { dir, calls } = make({ id: 'p', is_blocked: true, email: null });
    await expect(dir.matchOrCreateForBooking({} as never, 't', input)).rejects.toMatchObject({ code: 'booking_refused', status: 403 });
    expect(calls).toEqual([]);
  });
  it('a match with a different email keeps the one on file: flagged for review and audited (review R11)', async () => {
    const { dir, calls } = make({ id: 'p', is_blocked: false, email: 'old@x.test' });
    expect(await dir.matchOrCreateForBooking({} as never, 't', input)).toEqual({ id: 'p', created: false });
    expect(calls).toEqual(['tag:needs_review', 'patient.booking_contact_differs']);
  });
  it('the same email changes nothing', async () => {
    const { dir, calls } = make({ id: 'p', is_blocked: false, email: 'a@x.test' });
    await dir.matchOrCreateForBooking({} as never, 't', input);
    expect(calls).toEqual([]);
  });
  it('at the plan limit a new visitor is refused neutrally (the plan is not revealed)', async () => {
    const { dir, calls } = make(undefined, Err.forbidden('plan_limit_reached', 'Your plan allows 2000 patients'));
    await expect(dir.matchOrCreateForBooking({} as never, 't', input)).rejects.toMatchObject({ code: 'booking_refused' });
    expect(calls).toEqual([]);
  });
  it('under the limit a new record is created and audited', async () => {
    const { dir, calls } = make(undefined);
    expect(await dir.matchOrCreateForBooking({} as never, 't', input)).toEqual({ id: 'new', created: true });
    expect(calls).toEqual(['create', 'patient.create']);
  });
});
