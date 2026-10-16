# Phase 2 — Backend hardening

## What changed

- **Plan limits** — `shared/plans/PlanLimits` (global module) reads `plans.limits` through the clinic's live subscription
  and is the only place limits are enforced. `assertCanAdd(tx, tenantId, resource, countUsed)` runs inside the write
  transaction under a namespaced advisory lock, so two concurrent adds cannot both pass. Enforced on branch create,
  doctor create and on **reactivation** (PATCH `isActive: true`, make-main of an inactive branch): a deactivated row frees
  its seat, taking it back is checked again. No live subscription fails closed (`subscription_inactive`).
  Migration `20261020000007_plan_doctor_limit.sql` adds `doctors` to the plan JSON (Basic 3, Pro 15); `staff` stays
  reserved for members. Errors: 403 `plan_limit_reached` with `{ resource, limit, used }` (dashboard text added).
- **Observability** — `AccessLogMiddleware`: one structured line per request on `close` (so aborted requests show up as
  `aborted: true`), route pattern not raw path, tenant/user from the CLS store, `X-Request-Id` on every response and
  `requestId` in every problem body. Client-supplied `x-request-id` is accepted only when it matches `[A-Za-z0-9._-]{8,64}`.
- **Read-permission convention** — setup data that is public on the clinic website (branches, doctors, services, profile,
  onboarding) is readable by any member; writes keep `branches:write` / `settings:write`. `branches:read` remains in the
  seeded roles as a reserved permission name.
- Tests: plan limit on create and on reactivation, request-id round trip, read convention (`onboarding.e2e-spec.ts`).

## Review findings fixed

| Severity | Finding | Fix |
|---|---|---|
| High | No live subscription meant *unlimited* (failed open). | `subscription_inactive` 403. |
| High | Reactivating a deactivated branch/doctor bypassed the limit. | `lock()` returns `is_active`; update/make-main re-check when flipping to active. |
| Medium | Doctors were counted against the `staff` key (members). | Separate `doctors` key, migration + seed. |
| Medium | Middleware-order comment wrong; middleware would crash without CLS. | Correct reasoning in the comment; `isActive()` guard. |
| Medium | Client-controlled request id reached logs unvalidated. | Validated shape or a fresh UUID. |
| Low | Aborted requests unlogged; raw 404 paths in logs; `getHeader` cast; advisory-lock namespace; test that did not exercise the change. | All fixed. |

## Left for later

- `staff` limit on invitations/members (when the members module arrives).
- Plan usage shown on the Overview (`used/limit` per resource) — needs a small `GET /clinic/plan` endpoint.
- Metrics (RED) export; logs are structured JSON in production already.
