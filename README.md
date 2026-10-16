# Dental SaaS

Multi-tenant platform for dental clinics: a website per clinic, online booking, and a clinic dashboard.
Requirements, schema and architecture are in the SRS doc (sections 1–8).

| Part | Path | Local URL |
| --- | --- | --- |
| API (NestJS) + worker | `apps/api` | http://localhost:4000 · docs http://localhost:4000/docs |
| Landing + clinic websites (Next.js) | `apps/web` | http://lvh.me:3000 · http://clinic-a.lvh.me:3000 |
| Clinic dashboard (React 19 + Vite) | `apps/dashboard` | http://localhost:5173 |
| Database: migrations, seed, types, tests | `packages/db` | Postgres on `localhost:5433` |
| Mail inbox (Mailpit) | docker | http://localhost:8025 |
| File storage (MinIO, optional) | `docker compose --profile storage up -d` | http://localhost:9001 (minio / minio12345) |

## 1. Install once (Windows)

1. **Node.js 22 LTS** — https://nodejs.org (check: `node -v`)
2. **pnpm** — in PowerShell: `corepack enable` (or `npm install -g pnpm@10`)
3. **Docker Desktop** with the WSL 2 engine — https://www.docker.com/products/docker-desktop
4. **Git**

## 2. First run

```powershell
cd D:\Freelance\dental-saas
copy .env.example .env
docker compose up -d          # Postgres 16, Redis, Mailpit (first start creates the DB roles)
pnpm install
pnpm db:migrate               # applies packages/db/migrations
pnpm db:seed                  # 2 demo clinics, staff, doctors, services
pnpm test                     # 67 database checks + API end-to-end tests
pnpm dev                      # API :4000, website :3000, dashboard :5173
```

In a second terminal, start the background worker:

```powershell
pnpm dev:worker
```

Then open:

- http://lvh.me:3000 — landing page with links to the demo clinics
- http://clinic-a.lvh.me:3000 — Smile Dental Clinic's website (from the database, by subdomain)
- http://localhost:5173 — dashboard: pick a demo user and sign in
- http://localhost:4000/docs — API documentation (Swagger)

`*.lvh.me` is a public DNS name that always points to `127.0.0.1`, so clinic subdomains work locally with no hosts-file edits.
If you are offline, add `127.0.0.1 lvh.me clinic-a.lvh.me clinic-b.lvh.me` to `C:\Windows\System32\drivers\etc\hosts`.

### Accounts

**Create your own clinic:** open http://localhost:5173 → *New clinic? Create an account*. The 6-digit phone code
arrives in **Mailpit** (http://localhost:8025) as an email to `sms-<number>@sms.local`, and is also printed in the API log.
After verifying, your clinic's site is live at `http://<your-subdomain>.lvh.me:3000`.

**Demo accounts** (password `Demo@12345` for all; the login screen has a quick sign-in in development):

| Email | Clinic | Role |
| --- | --- | --- |
| owner.a@demo.test | Smile Dental Clinic (clinic-a) | Owner (all permissions) |
| reception.a@demo.test | Smile Dental Clinic | Receptionist (cannot add branches) |
| doctor.a@demo.test | Smile Dental Clinic | Doctor |
| owner.b@demo.test | Cairo Dental Care (clinic-b) | Owner |

### How sign-in works

- Sign-up creates the user and the whole clinic in **one transaction** (`provision_tenant`: roles, owner, main branch,
  14-day trial, website draft, subdomain). Then a phone code is sent; login is blocked until the phone is verified.
- Passwords: scrypt (built into Node). Codes: 6 digits, 5 minutes, 5 tries, max 3 sends per 10 minutes.
  Login: 10 failures in 15 minutes locks that email/phone for 15 minutes.
- Access token: 15-minute JWT, kept in memory by the dashboard. Refresh token: 30 days, **httpOnly cookie** on `/auth`,
  rotated on every use; reusing an old one ends every session of that login (stolen-token protection).

## 3. Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run API, website and dashboard with hot reload |
| `pnpm dev:worker` | Run the background worker |
| `pnpm test` | Database tests (rebuilds `dental_test`), dashboard unit tests (vitest), then API e2e tests |
| `pnpm lint` | ESLint for every app (includes the rule that only `shared/database` may import `withTenant`) |
| `pnpm db:test` | Database tests only |
| `pnpm db:migrate` | Apply new migrations |
| `pnpm db:types` | Regenerate Kysely types (`packages/db/src/database.ts`) after a migration |
| `pnpm db:reset` | Drop, migrate and seed the dev database |
| `pnpm build` / `pnpm typecheck` | Build / typecheck everything |
| `pnpm add <pkg> --filter @dental/api` | Add a dependency to one app |
| `docker compose down -v` | Stop services and wipe all local data |

### New migration

1. Add `packages/db/migrations/<YYYYMMDDHHMMSS>_<name>.sql` with `-- migrate:up` and `-- migrate:down` sections.
2. `pnpm db:migrate` then `pnpm db:types`.
3. Add or update a test in `packages/db/test/` and run `pnpm db:test`.

## 4. How the code is organised

- **Tenant isolation:** the API connects as `app_user` (no RLS bypass). Module code reaches the database only through
  `TenantDb` (`shared/database`): `run(tx, tenantId)` for the signed-in clinic, `runAs(id)` for a clinic the server chose,
  `runForHost(host)` for public websites, and `platform()` only for the tables without RLS (users, otp_codes,
  refresh_tokens, auth_events). PostgreSQL row-level security does the filtering, so a missed `WHERE` cannot leak
  another clinic's data.
- **Roles:** `app_user` (API), `app_worker` (worker, crosses clinics for jobs), `app_definer` (owns the few lookup
  functions used before a clinic is known: login, invitation links, webhooks, website hostnames).
- **Business rules in the database:** double booking, slot holds, booking codes, invoice totals, payments, refunds,
  installments and payouts are enforced by constraints and triggers (see `packages/db/test` for every rule).
- **Modules:** controller (HTTP edge: validation, throttles, cookies) → service (one use case, one `TenantDb` call) →
  repository (all SQL, `tx` first). Hexagonal (domain / application / infrastructure + ports) for scheduling and billing.
  Services throw `AppError` (`shared/errors`), rendered as RFC 9457 `application/problem+json` with a stable `code`.
  Infrastructure is reached through ports (`RATE_LIMITER`, `SMS_SENDER`, `EMAIL_SENDER`, `TokenService`); limits and
  timings live in `AUTH_POLICY` / `WORKER_POLICY` in `config.ts`.
- **Plan limits:** `shared/plans/PlanLimits` reads `plans.limits` through the live subscription and is called inside the
  write transaction (create and reactivate) under an advisory lock; `403 plan_limit_reached { resource, limit, used }`.
- **Observability:** every response carries `X-Request-Id` (also in error bodies as `requestId`); `AccessLogMiddleware`
  writes one structured line per request (route pattern, status, ms, tenant, user; JSON in production).
- **Dashboard:** one hash route per screen (`router.ts`: `#/doctors`, `#/doctors/new`, `#/doctors/<id>/edit`,
  `#/doctors/<id>/schedule`, `#/branches/<id>/hours`, …) so every create/edit page can be reloaded, linked and
  reached with Back/Forward. Screens live in `screens/<resource>/{list,form,…}.tsx` and share the chrome in
  `ui/page.tsx` (`FormPage`, `Breadcrumbs`, `ResourceState`, `RouteLink`) and `ui/confirm-dialog.tsx`. Form logic that
  mirrors API rules is pure and unit-tested (`hours-model.ts`, `schedule-model.ts`, `service-model.ts`); request
  bodies are diffs against the values the form opened with (`diffText`), so a background refetch can never be
  saved back over someone else's change. `useUnsavedChanges` guards in-app navigation and tab close.

## 5. Quality gates

Every phase ends with a senior review (security, performance, QA) before the next one starts.
Reports and what was fixed or deferred are in `docs/reviews/`. A phase is done when:

1. `pnpm test` is green (database checks + API end-to-end tests),
2. the review's high-priority findings are fixed and covered by a test,
3. deferred items are written down with the phase they belong to.

## 6. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Roles app_user, app_worker, app_definer must exist first` | The Postgres volume was created before the init script. Run `docker compose down -v` then `docker compose up -d`. |
| Port 5433 / 6379 / 3000 already in use | Stop the other service or change the port in `docker-compose.yml` and `.env`. |
| `pnpm install` warns about ignored build scripts | Run `pnpm approve-builds` and approve them. |
| Website shows "No clinic at this address" | Run `pnpm db:seed`; check the API is running on :4000. |
| Database tests can't find `psql` | Nothing to do: they fall back to the `psql` inside the Postgres container (Docker must be running). |

## 7. Roadmap

- ✅ Week 1 — foundation: monorepo, Docker, schema, tenant isolation, CI
- ✅ Week 2 — sign-up, phone verification, login, sessions
- ✅ Design system — "Trust blue" tokens, dashboard + clinic website redesign, dental arch / canvas visuals (`docs/design-system.md`)
- ✅ Phase 1 (architecture) — dashboard routes, dedicated create/edit pages, shared form chrome, unit tests, ESLint + CI lint (`docs/reviews/2026-10-20-phase-1-dashboard.md`)
- ✅ Week 3 — clinic setup wizard (`docs/reviews/2026-10-19-week-3.md`)
  - ✅ step 0: backend pattern hardening (`docs/reviews/2026-10-17-design-and-patterns.md`)
  - ✅ part 1: clinic profile + brand colour, branches (edit, main branch), weekly hours with split shifts, live setup checklist
  - ✅ website publish: draft theme → published theme, instant cache purge of the clinic site
  - ✅ part 2: doctors (branch assignment + weekly schedule across branches), services & prices from the dental catalogue
- ✅ Phase 2 — backend hardening: plan limits from `plans.limits` (create + reactivation), access log + `X-Request-Id`, read-permission convention (`docs/reviews/2026-10-21-phase-2-backend.md`)
- ✅ Website redesign — premium clinic site, doctors/services/branches sections, open-now status (`docs/reviews/2026-10-16-website-redesign.md`)
- ✅ Phase 3 — online booking: hexagonal `scheduling` module (slot engine, 10-minute holds, email code, reception code), `/book` wizard, outbox → email notifications and reminders in the worker, dashboard Appointments screen with check-in (`docs/reviews/2026-10-16-phase-3-booking.md`)
- ✅ Week 6 part 1 — patients (search, profile, guardian, medical history), audit trail of record access, dashboard "new appointment" form, automatic no-show; Phase 3 review fixes (`docs/reviews/2026-10-16-week-6-patients.md`)
- Week 6 part 2 — visits, prescriptions, consent signing; route-level code splitting
