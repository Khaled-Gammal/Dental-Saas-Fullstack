# ARC-01: a verified clinic context (design, 2026-11-22)

Finding ARC-01 of `docs/database/schema-v3-audit.md`. The user chose the recommended answer to all three decisions in §7 (shared key; permissive, then enforce; ARC-3 after ARC-2). ARC-1 is built: `docs/reviews/2026-11-22-arc-01-phase-1-signed-context.md`.

## 1. The problem (reproduced 2026-11-22)

Every row-level-security policy compares `tenant_id` with `current_tenant_id()`. That reads the setting `app.tenant_id`, which the API sets at the start of each transaction (`packages/db/src/index.ts:42`). Any role can set a custom setting, the API role included:

```sql
-- as app_user, inside clinic A's request
SELECT set_config('app.tenant_id', resolve_tenant_by_host('clinic-b.lvh.me')::text, true);
SELECT * FROM patients;   -- clinic B's patients
```

So RLS stops a *forgotten filter*, but not *SQL injection*: one injection bug anywhere in the API reads every clinic. Today the only defence is that there is no unsafe raw SQL, which the audit checked and found true.

The same applies to:
- `app.member_id`: branch limits (`member_branch_ids()`) and the owner checks of 0070;
- `app.user_id` and `app.actor_type`: the audit trail and `request_clinic_deletion()`.

## 2. Goal and limits

**Goal:** SQL running as the API role cannot pick or change its clinic, member, user or actor. Only API code holding a secret the database role cannot read can set them.

**Not covered by the signing alone:**
- **The public website.** The API itself enters the clinic of whatever hostname a visitor names. An injection inside a public endpoint would therefore still land in that clinic, as `patient`. Closing that takes policies keyed on the verified actor (phase ARC-3).
- **Worker jobs** (`app_worker` is BYPASSRLS): that is WRK-01.
- **Settings that only matter inside one clinic** (`app.patient_merge`): handled in ARC-1 by moving them under the same proof.

## 3. Design

### 3.1 The key

- A new secret `TENANT_CONTEXT_KEY` (32+ random bytes) in the API's environment. It follows the pattern of `JWT_SECRET`: a dev default, and production refuses to start without its own value (`config.ts`).
- The same key in a new table `app_context_keys (id smallint, key bytea, retired_at)`.
  - Readable by `app_definer` only; `app_user`, `app_worker` and `app_platform` get nothing.
  - Written by an admin script, `pnpm db:context-key`, which reads the env value. A migration never contains it.
- Rotation: add the new key id, deploy the API with it, retire the old id.

### 3.2 Entering a context (one call per transaction, replacing today's `set_config` call)

`enter_context(p_tenant, p_member, p_user, p_actor, p_issued_at, p_key_id, p_sig)` is a SECURITY DEFINER function owned by `app_definer`, executable by `app_user`:

1. It checks `p_sig = hmac(tenant|member|user|actor|issued_at, key)`, where the API computed `p_sig` in Node.
2. It checks that `issued_at` is within 5 minutes. That limits replay; a signature is never visible to other sessions anyway, because it is a bound parameter and `pg_stat_activity` shows `$1`.
3. It sets the four settings transaction-locally, plus `app.ctx_proof = hmac(tenant|member|user|actor|pg_backend_pid()|transaction start, key)`.

The proof binds the context to this connection and this transaction. Changing any setting afterwards, or copying the proof into another transaction, makes it invalid. Forging one needs the key.

`enter_host_context(p_host, p_issued_at, p_key_id, p_sig)` does the same for the public website: the signature covers the hostname, the function resolves the clinic as `resolve_tenant_by_host()` does today, and the actor is `patient`. It is still one round trip, as now.

### 3.3 Reading the context

`current_tenant_id()`, `current_member_id()`, a new `current_user_id()` / `current_actor_type()`, `member_branch_ids()` and `audit_row_change()` all go through one verifier:

| The session… | Result |
|---|---|
| has a valid proof | the settings as entered |
| has no or a wrong proof, and its **login role** (`session_user`) already bypasses RLS (admin, worker, backup) | the plain settings. Such a session reads everything anyway. Migrations, seeds, the worker's `enterTenant` and the SQL test files (which `SET ROLE app_user` inside an admin session) keep working unchanged. |
| anything else | NULL: no clinic, so every policy hides every row. A forged or stale context fails closed. |

The check uses `session_user`, not `current_user`. A definer function called by the API still runs for an `app_user` login and still needs the proof, as `hard_delete_allowed()` does since 0046.

### 3.4 Policies and functions

`current_tenant_id()` becomes a non-inlinable definer function, so every `tenant_isolation` policy is recreated as `tenant_id = (SELECT current_tenant_id())`.
- That is evaluated once per statement as an InitPlan, and the index is still used (checked with EXPLAIN, §4).
- The branch policies already have this form.
- Functions that compare `tenant_id = current_tenant_id()` row by row read it once into a variable instead.

### 3.5 API changes

- `packages/db` `enterTenant()` signs and calls `enter_context`.
- `TenantDb.actAs()` enters again with the new user, instead of overwriting two settings.
- `runForHost()` calls `enter_host_context`.
- `KyselySchedulingRepository.enterTenant` (online-booking code check) uses the shared helper.

These are all the writers today (inventory, §5). Module code doesn't change: it already goes through `TenantDb`.

### 3.6 Rollout without downtime

A one-row setting `app_context_settings.mode`, writable by the admin role only:
- **`permissive`:** a signed context is verified as above, and an unsigned `app.tenant_id` is still accepted. The migration ships in this mode, so the old API keeps working while the new one deploys.
- **`enforce`:** only signed contexts count. It is switched on after the new API is live, with a one-line migration.

Rolling back means switching back to `permissive`, with no schema change.

## 4. Measured cost (PostgreSQL 16.14, `dental_test`, rolled-back spike)

| Reader | Per call |
|---|---|
| today: `current_tenant_id()` (inlined SQL) | 0.55 µs |
| verified, proof path (HMAC-SHA256 + key read) | 10.3 µs |
| verified, privileged shortcut (admin/worker) | 6.9 µs |

- A query pays about 10 µs once per table it reads, not per row. A typical request with 20 queries over 2–3 tables costs about 0.5 ms more.
- Row-level triggers that read the context pay about 10 µs per row: about 10 ms more for a 1,000-patient import.
- A forged switch to clinic B returned NULL.
- A policy `tenant_id = (SELECT f())` planned as an InitPlan with an Index Scan.

## 5. Inventory

| Context | Where |
|---|---|
| Written by the API | `packages/db/src/index.ts` (`enterTenant`); `tenant-db.service.ts` (`actAs`, `runForHost`); `kysely-scheduling.repository.ts:30` |
| Read in SQL | `current_tenant_id`, `current_member_id`, `member_branch_ids`, `acting_member_is_owner`, `audit_row_change` (user, actor), `gallery_items_consent_stamp` (member), `request_clinic_deletion` (user), `patient_merge_only` / `merge_patients` (`app.patient_merge`), plus 12 functions calling `current_tenant_id()`, 70 `tenant_isolation` policies and `tenant_self` on `tenants` |
| Public website | gallery, media and public-site reads; online booking (hold, details, confirm, release); self-service manage (view, slots, cancel, move) |

## 6. Phases (stop after each)

| Phase | What | Risk |
|---|---|---|
| **ARC-1** | Migration:<br>• key table;<br>• `enter_context`, `enter_host_context`;<br>• verified readers;<br>• policies on `(SELECT …)`;<br>• `app.patient_merge` under the proof;<br>• mode `permissive`.<br><br>API:<br>• signing in the four writers;<br>• `TENANT_CONTEXT_KEY` config;<br>• `pnpm db:context-key`;<br>• `db:test` and CI put the test key in.<br><br>Tests, with dblink as a real `app_user` login:<br>• a forged clinic, member or actor is refused;<br>• a stale, re-used or wrong-key signature is refused;<br>• a signed entry works;<br>• definer functions see the verified clinic only;<br>• the 44 existing files and the API e2e stay green. | Medium: every request path. Permissive keeps the old API working. |
| **ARC-2** | Switch to `enforce` (one-line migration).<br><br>• `05`/`43` (dblink as `app_user`) sign their entries;<br>• production checklist: provision the key before the API, then deploy, then enforce. | Low once ARC-1 is live |
| **ARC-3** | Public actor: RESTRICTIVE policies for `actor = patient` on clinical, money and staff tables, built from the booking and self-service inventory. Then a public-endpoint injection reaches only what the website already shows. | Medium: the booking flow must keep every row it needs |

## 7. Decisions for the user

1. **Signing:** a new `TENANT_CONTEXT_KEY` shared by the API and the database, as above *(recommended)*. The alternative, having the database verify the JWT access token itself, would put `JWT_SECRET` in the database and would not cover the paths that have no token (sign-up, invitation acceptance, signed links, the website).
2. **Rollout:** `permissive` first, then `enforce` *(recommended)*. The alternative is one cut-over, where the migration and the API must go live in the same minute.
3. **ARC-3** (public actor restrictions): run it right after ARC-2 *(recommended)*, or later.
