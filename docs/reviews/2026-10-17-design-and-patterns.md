# Review — design system, UI and code patterns (after Week 2 + redesign)

Two independent reviews: frontend (clean code, a11y, performance, security) and backend (conformance to the agreed architecture).

## Frontend — fixed now

| # | Finding | Fix |
|---|---|---|
| H1 | "Skip to content" (`#main`) changed the hash route and jumped to Overview | `readHash` ignores unknown hashes; the skip link focuses `<main>` without touching the URL |
| H2 | Closed mobile drawer was still reachable with Tab; no focus management | `inert` while closed, `role=dialog` while open, focus moves to Close and back to Menu |
| H3 | A light clinic brand colour made white button text unreadable | Server computes `--on-brand` (white or ink, WCAG 4.5:1) and `--brand-text` (brand darkened until readable on white) |
| H4 | Focus ring invisible on navy / blue surfaces and in forced-colours mode | Transparent outline + `--ring-on-dark` token for dark surfaces |
| M5 | English server text and "Failed to fetch" shown in the Arabic UI | `ApiError(0,'network')` for fetch failures; `ErrorText` translates known `code`s (`err_*` keys), falls back to server text |
| M6 | Unhandled rejection when the API is down at boot | `refreshSession().catch(...)`; refresh returns null on network failure |
| M7 | Branches error looked like "No branches yet" | Error state with Retry; Overview shows "—" |
| M8 | `tel:` links built from raw DB text | `telHref()` keeps digits and a leading `+`, else no link |
| M9 | Real-data hero chips hidden from screen readers | `aria-hidden` only on decoration (blob, arch) |
| M10 | Text below 4.5:1 (`--faint` "closed", eyebrow on blue) | `--muted`; white 92% on blue |
| M11 | Duplicated helpers (`initials`, name picking, ROOT_DOMAIN, Branch type) | `@dental/ui/text` (`initials`, `pickName`, `toAsciiDigits`, `telHref`, `onColor`, `readableOnWhite`), `src/config.ts`, `src/types.ts` |
| M12 | Duplicated icon paths across apps | `@dental/ui/icons` (`TOOTH_PATH`, `ICON_PATHS`) used by both apps |
| M13 | Hard-coded colours | `color-mix()` over tokens; new tokens `--navy-950`, `--skeleton-hi`, `--ring-on-dark`; canvas reads token colours |
| L | `Button` defaulted to submit; stale `setF({...f})`; copy-timer stacking; canvas re-layout per pointer move and particle reset on resize; per-tooth filter animation on the site; Google Fonts in the dashboard; Arabic-Indic digits counted as letters in the password rule (client **and** API); wrong Arabic plurals; unvalidated Host header in middleware; unused i18n keys/icons; site page mixing fetch/format/icons | All fixed: `type="button"` default, functional updates, timer ref + `role=status`, cached rect + kept particles, one group filter, `@fontsource` self-hosted font, `\p{L}`/`\p{Nd}`, `Intl.PluralRules('ar')`, `HOST_RE` → 400, dead code removed, `lib/site.ts` + `components/` split |

## Backend — done in Week 3 step 0

Status: implemented; a second independent review found no blockers; its follow-ups (OTP consume + mark-verified in one
transaction, `otp_used` vs `otp_locked` under a race, `Retry-After` header, exhaustive SMS adapter switch, one user-agent
clip helper, `ZodBody` input typing, public-site repository owning `runForHost`) are applied. Confirm with `pnpm test`.
Not done: an ESLint rule banning `withTenant` imports outside `shared/database` (ESLint is not set up yet — Week 4).

1. **SQL out of controllers** — `public-site.controller.ts` (own `set_config`) → `PublicSiteRepository` + `TenantDb.runForHost()`; dev-login moves into identity and reuses the session code (also fixes the missing `status='active'` filter).
2. **One door to tenant data** — `TenantDb.raw` → `platform()` (only the non-RLS tables: users, otp_codes, refresh_tokens, auth_events); `run(fn(tx, tenantId))`; lint rule bans importing `withTenant` outside `shared/database`.
3. **Split `identity.service.ts` (381 lines)** → `SignupService`, `OtpService` (purpose-generic: verify_phone / reset_password / booking), `SessionService`, `LoginService`, `AuthEventsRepository`, `IdentityRepository`, `OtpRepository`, `SessionCookie`. Consuming the code and marking the phone verified share one transaction; the attempt counter commits on its own (a wrong guess must still count).
4. **Ports, not classes** — `RATE_LIMITER` token + interface; notification tokens in `notifications/ports.ts`; `TokenService` exported by `AuthModule` (one access-token TTL).
5. **`AppError(code, status, extras)`** thrown by services, mapped by `ProblemDetailsFilter` (no Nest HTTP exceptions inside domain/application code).
6. **Config, not magic numbers** — throttle limits, OTP/login policy, cookie path, worker cadence, timezone → `AUTH_POLICY` / `WORKER` blocks in `config.ts`.
7. **Small cleanups** — delete `modules/identity/phone.ts` stub; one `toAsciiDigits`; zod rules in `shared/validation/common.ts`; fix `password_hash` column comment (scrypt); keep `otp_codes.attempts` CHECK in sync with config.

## Patterns we follow from here

- **CRUD modules (clinic setup, website):** controller → service (one `TenantDb.run` per use case) → repository (`tx` first argument); zod schemas in `*.schemas.ts`.
- **Complex domains (scheduling, billing):** hexagonal — `domain/` (entities, value objects, policies), `application/` (use cases + `ports.ts`), `infrastructure/` (Kysely repos, clock, outbox notifier, payment gateway), `http/`. The database constraints stay the final guard.
- **Frontend:** `screens/` compose `ui/` primitives; one `api()` client; query keys include `clinicId`; text through `t()`; shared pure helpers and geometry in `@dental/ui`; tokens only, no raw colours.
