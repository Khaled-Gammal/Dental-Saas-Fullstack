# Monitoring (Phase 1B)

Three things tell you something is wrong before a clinic does: error tracking (Sentry), uptime checks on the health
endpoints, and the backup heartbeat (`docs/ops/backups.md`).

## Error tracking: Sentry

Off unless a DSN is set (development and tests send nothing).

| App | Variable | What is reported |
|---|---|---|
| API | `SENTRY_DSN` | every 5xx except 503 (the database or Redis unreachable is a 503: the uptime check reports it), with the request id (also in the logs and the problem+json body), method and route pattern (`/patients/:id`); the same error from the same route at most once every 5 minutes |
| Worker | `SENTRY_DSN` | a job that throws (once per job and error every 5 minutes), a failed start, and log lines at `level: "error"` (an outbox event out of retries, an email that finally failed, a stuck notification), at most one per kind every 15 minutes |
| Websites (Next.js) | `SENTRY_DSN` | server errors while rendering a page, route handlers, server actions |
| Dashboard | `VITE_SENTRY_DSN` (build time) | browser errors and screens that crash while rendering (the user sees «حصل خطأ غير متوقع» and a reload button instead of a blank page) |

One Sentry project for the servers (they are told apart by the `service` tag: `api`, `worker`, `web`) and one for the
dashboard. `SENTRY_ENVIRONMENT` (default `NODE_ENV`) and `SENTRY_RELEASE` (the git sha) are optional.

**What never leaves**: request bodies, query strings, headers, cookies, IP addresses, users, console lines, typed or
clicked text, session replays, performance traces. The SDKs' automatic HTTP / Express / database instrumentation is
off in the API, the worker and the websites. The servers send no breadcrumbs; the dashboard keeps page changes, API
calls (method, path, status) and the fact that a click happened, not the clicked element (its selector can hold a
label such as a patient's name). The API sends a PostgreSQL error as its code and the table / column / constraint names
only (its message quotes the value that broke it). Other messages and log fields are masked: emails → `[email]`, runs
of 7+ digits, with or without spaces and dashes (phones, national ids) → `[number]`, tokens → `[token]`. The code: `apps/api/src/shared/observability/scrub.ts`,
`apps/dashboard/src/monitoring/scrub.ts`, `apps/web/lib/sentry-scrub.ts`. In Sentry, also turn on the project's
"Data Scrubber" and "Prevent storing of IP addresses" as a second line.

Alert rules worth setting: a new issue; an issue seen more than 10 times in an hour; any event with tag
`service:worker`.

## Uptime checks

Point an uptime monitor (Better Stack, UptimeRobot, Uptime Kuma) at:

| URL | Every | Fails when |
|---|---|---|
| `https://api.<domain>/health` | 1 min | 503: the database or Redis does not answer |
| `https://api.<domain>/health/worker` | 5 min | 503 `worker_stale`: no job has completed for 10 minutes (the outbox runs every 5 s): the worker is down, stuck, or every job fails, so reminders, receipts and exports have stopped |
| `https://<domain>/` (landing) and one clinic site | 5 min | the websites are down |
| `https://app.<domain>/` (dashboard) | 5 min | the dashboard is not served |

Both health endpoints are public and say nothing about any clinic. `/health/worker` returns the time of the last
heartbeat (`lastBeatAt`, `ageSeconds`) either way. The worker writes it to Redis (`dental:worker:heartbeat`) after
each job that completes, at most every 15 s.

## Logs

The API logs JSON in production (a 5xx is logged with its request id, the same id the client gets back in the error body); the worker logs one JSON
line per event. Keep the container logs (Docker's `json-file` driver with `max-size`/`max-file`, or ship them to the
log service of your choice) for at least 14 days.
