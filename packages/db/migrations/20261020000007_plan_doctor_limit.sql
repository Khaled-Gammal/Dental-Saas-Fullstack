-- migrate:up
-- Plan limits enforced by the API (shared/plans): `branches` and `doctors` count active rows;
-- `staff` stays reserved for clinic members (checked when invitations arrive).
UPDATE plans SET limits = limits || '{"doctors":3}'  WHERE code = 'basic' AND NOT limits ? 'doctors';
UPDATE plans SET limits = limits || '{"doctors":15}' WHERE code = 'pro'   AND NOT limits ? 'doctors';

-- migrate:down
UPDATE plans SET limits = limits - 'doctors' WHERE code IN ('basic', 'pro');
