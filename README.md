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
| File storage (MinIO) | docker | http://localhost:9001 (minio / minio12345) |

## 1. Install once (Windows)

1. **Node.js 22 LTS** — https://nodejs.org (check: `node -v`)
2. **pnpm** — in PowerShell: `corepack enable` (or `npm install -g pnpm@10`)
3. **Docker Desktop** with the WSL 2 engine — https://www.docker.com/products/docker-desktop
4. **Git**

## 2. First run

```powershell
cd D:\Freelance\dental-saas
copy .env.example .env
docker compose up -d          # Postgres 16, Redis, MinIO, Mailpit (first start creates the DB roles)
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

### Demo accounts (dev sign-in, no password)

| Email | Clinic | Role |
| --- | --- | --- |
| owner.a@demo.test | Smile Dental Clinic (clinic-a) | Owner (all permissions) |
| reception.a@demo.test | Smile Dental Clinic | Receptionist (cannot add branches) |
| doctor.a@demo.test | Smile Dental Clinic | Doctor |
| owner.b@demo.test | Cairo Dental Care (clinic-b) | Owner |

Dev sign-in exists only while `DEV_LOGIN_ENABLED=true`; the API refuses to start in production with it on.

## 3. Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run API, website and dashboard with hot reload |
| `pnpm dev:worker` | Run the background worker |
| `pnpm test` | Database tests (rebuilds `dental_test`) then API e2e tests |
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

- **Tenant isolation:** the API connects as `app_user` (no RLS bypass). Module code reaches clinic data only through
  `TenantDb.run(tx => …)`, which opens a transaction and sets `app.tenant_id` from the access token. PostgreSQL row-level
  security does the filtering, so a missed `WHERE` cannot leak another clinic's data.
- **Roles:** `app_user` (API), `app_worker` (worker, crosses clinics for jobs), `app_definer` (owns the few lookup
  functions used before a clinic is known: login, invitation links, webhooks, website hostnames).
- **Business rules in the database:** double booking, slot holds, booking codes, invoice totals, payments, refunds,
  installments and payouts are enforced by constraints and triggers (see `packages/db/test` for every rule).
- **Modules:** standard NestJS modules by default; hexagonal (domain / application / infrastructure) for scheduling and
  billing when they are built. Errors are RFC 9457 `application/problem+json` with a stable `code`.

## 5. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Roles app_user, app_worker, app_definer must exist first` | The Postgres volume was created before the init script. Run `docker compose down -v` then `docker compose up -d`. |
| Port 5433 / 6379 / 3000 already in use | Stop the other service or change the port in `docker-compose.yml` and `.env`. |
| `pnpm install` warns about ignored build scripts | Run `pnpm approve-builds` and approve them. |
| Website shows "No clinic at this address" | Run `pnpm db:seed`; check the API is running on :4000. |
| Database tests can't find `psql` | Nothing to do: they fall back to the `psql` inside the Postgres container (Docker must be running). |

## 6. Next (week 2: walking skeleton)

Real sign-up and login (password + phone OTP, refresh tokens) → onboarding wizard writes branches, doctors and services →
website shows them → online booking with slot hold → booking code by email (Mailpit) → reception check-in.
