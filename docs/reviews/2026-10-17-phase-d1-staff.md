# Phase D1 review — staff invitations, members, access changes, password reset (2026-10-17)

Scope: SRS ACCESS-001, ACCESS-002, ACCESS-005, AUTH-102 and the rest of AUDIT-003 (`docs/roadmap.md`, Phase D1).
Defaults accepted for CLR-06, 10, 11, 13, 14, 15, 16 (recorded in SRS §0.5 and Part C). Branch: `v4/phase-d1-staff`
(on top of `v4/phase-c-security`).

## What changed

| Requirement | Change | Where |
| --- | --- | --- |
| ACCESS-001 | Owner invites by email with a role, all branches or a list, optional job title and the doctor record the person will sign in as. Link `#/invite/<token>` (32 random bytes; only the SHA-256 is stored), valid 7 days, single use. New person: name + password, email proven by the link. Existing account: its own password (same lockout as sign-in; a wrong password does not use the link). Resend issues a new link (the old one dies); revoke. One open invitation per email; expired ones are revoked automatically when inviting again. Plan `staff` seats = active members + open invitations | `modules/staff` (`StaffService`, `InvitationAcceptance`), identity `Accounts`; migration 0017 `open_invitation()`; dashboard `screens/staff/*`, `screens/accept-invite.tsx` |
| ACCESS-002 | List members (role, branches, job title, linked doctor, status); change role, branches, job title; disable/enable (enable takes a seat again). A clinic always keeps one active owner (API `last_owner` + trigger) | `PATCH /staff/members/:id`; trigger `tenant_members_keep_owner` |
| ACCESS-005 | Access tokens carry the member's `access_version`. `JwtAuthGuard` checks it and the member status on every request (`member_access_state()`, one PK lookup). A stale token answers `401 access_changed` (the dashboard refreshes and gets the new rights); a disabled member gets `401 access_revoked` and cannot refresh | `auth/jwt-auth.guard.ts`, `session.service.ts`, 0017 |
| AUTH-102 | `POST /auth/password/forgot` (always 202), `POST /auth/password/reset` (email code + new password, 204). Every session of the account ends | identity `PasswordResetService`; dashboard Forgot / Reset screens |
| AUDIT-003 | Audit triggers on clinic, booking settings, branches, hours, holidays, rooms, doctors (+ branches, schedules, time off), services (+ doctors), members, member branches, invitations (token hash recorded as "changed" only), roles. The invitee is the actor when joining | 0017 |

Navigation: a **Team** item (فريق العمل) shown only with `staff:manage`.

### Fixed along the way

- `audit_row_change()` (0013) would have blocked a tenant hard delete: audit rows written while the clinic row is
  being deleted fail their foreign key. It now does nothing when `app.allow_hard_delete = on` (the flag the tenant
  deletion flow already uses).

## Migration and its risks

`20261027000017_staff_access` — **Low**: additive columns, a unique partial index on open invitations (it would fail
only if a clinic already had two open invitations for one email; none exist, invitations had no API), new triggers
and definer functions. Every member's existing access token becomes stale once (no `av` claim), which the dashboard
handles with one silent refresh. More `audit_log` rows: setup screens such as weekly hours write one row per changed
line. Applied to the test and dev databases. Kysely types regenerated (3 new columns).

## Tests (run 2026-10-17)

| Suite | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | passed |
| Database tests | **233 checks passed** (new `17_staff_access.sql`: 18 checks: last owner, access version, invitation links, one open invitation per email, audit without secrets) |
| API e2e + unit | **15 suites, 169 tests passed** (new `staff.e2e-spec.ts`, 14 cases: permission, invite/accept/reuse, weak password, branch-limited invitee, change applies on next request + refresh, disable, existing account joins a second clinic, password reset, last owner, resend/revoke, doctor link once, plan seats, cross-clinic) |
| Dashboard unit | 44 passed (new `staff-model.test.ts`, router tests for `#/staff` and `#/invite/<token>`) |
| Website unit | 20 passed |

**Not done: the browser check.** Your dev servers were already running (with the new code; the new endpoints answered
on `localhost:4000`), but the connected Chrome could not open `http://localhost:5173` (error page; it was also
reported as a different browser than the one selected, so it is probably not on this machine). The screens are
covered by typecheck, lint and unit tests only.

## Not done / follow-ups

- Doctor time off and holidays screens (APPT-005) — next sub-phase D2.
- `invitation_by_token()` (0001) is now unused (replaced by `open_invitation()`); kept, harmless.
- The dashboard strings were added in Arabic and English because the dictionary is still bilingual; Phase F removes
  the English half.
- Clinic B in the demo seed has only the owner role (the seed predates provisioning); real clinics get all five.
