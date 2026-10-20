# Statistics API: `GET /reports/stats` (2026-10-21)

The overview redesign listed what it could not show for lack of data. The user asked for a statistics API and chose
four definitions (all the recommended ones):

- **Access:** owner and accountant (`reports:read`).
- **New patient:** first visit in the period.
- **Chart:** automatic day/month grouping.
- **Default period:** this month against the same days of last month.

This is S1, the API. S2 puts it on the overview. Built on `v4/overview-redesign`, after the overview commit.

## Audit corrections (to the overview report)

- **Net income already exists.** The expenses report's `result` is net collections − counted expenses (approved and
  pending; rejected excluded). Saying "no definition" was wrong. The statistics use that `result`.
- **A day-by-day series already existed.** The revenue and expenses reports already return `by_day`, for up to
  366 days.
- **Truly missing:** a new-patient count, a comparison period, and one call that brings these together with a branch
  and a period.

## The endpoint

`GET /reports/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=<uuid>`. All parameters are optional.

- **Frame:** the same as every report. That means the period (default: the month so far; at most 366 days), the branch
  check (`branch_not_found`), the clinic's time zone, and row-level security, so a branch-limited member counts only
  their branches.
- **Who:** `stats` is a report kind that only `reports:read` opens (owner, accountant). Reception (`reports:read:daily`)
  and doctors (`reports:read:own`) get `403 missing_permission`.
- **The period before it (`previous_period`):** a period that starts on the 1st and stays in its month is compared with
  the same days of the previous month, cut at that month's end (1–31 March → 1–28 or 29 February). Any other period is
  compared with as many days just before it.
- **The response:**
  - `period`, `previous_period`;
  - `bucket` (`day` up to 62 days, else `month`);
  - `totals` and `previous`, each with `invoiced`, `collections_net`, `expenses`, `result`, `new_patients` and
    `appointments` (the attendance figures: booked, attended, completed, upcoming, cancelled, no-shows and their rates);
  - `series`: one point per day or month with the same money and patient figures, every bucket present, including
    empty ones;
  - `outstanding`: what patients owe now, as REPORT-004.
- **No new formulas:**
  - money comes from `revenueReport`;
  - expenses and `result` from `expensesReport`;
  - appointments from `attendanceFigures`;
  - each series point is the same functions over that day or month.

  A test checks that the series adds up to the totals, and another that the totals equal what `/reports/revenue`,
  `/reports/expenses` and `/reports/attendance` give for the same period and branch.

## New patients (database)

- **Migration `20261114000036_report_new_patients.sql`:** adds `report_new_patients(from, to, branch)`. For each
  patient it takes their first visit, then counts the patients whose first visit falls in the period, under that
  visit's branch and on its day in the branch's zone (like `report_procedures`).
- **Security:** it runs as the caller, under row-level security like the other report functions, so another clinic's
  visits are never read. Executing it is granted to `app_user` only.
- **Additive:** one function. `migrate:down` drops it. The visits index on `(tenant_id, patient_id, visit_at)` already
  exists.
- **Known nuance:** for a member limited to some branches, "first visit" is the first visit they can see.

## Verified (2026-10-21)

| Check | Result |
| --- | --- |
| Migration | applied to the local development and test databases |
| Typecheck, lint (repo) | passed |
| Report rule tests | 24 passed (5 new): access; this month against the same days of last month, including February and a leap year; other periods; day/month grouping; totals and series from the existing reports |
| Reports end-to-end | 16 passed, including all 4 new: who may open it; the period and its daily points; totals equal to the revenue/expenses/attendance reports; a file alone is not a new patient, the first visit counts once, another clinic is unaffected; period cap, unknown branch, monthly points |
| Full API suite (local) | the same failures as unchanged `main` on the same database (local test data left over from earlier runs; on that run `main` failed one suite more), so no new failure. That includes the one failure in the reports suite (a branch-limited view compared with the owner's month). CI runs on a fresh database |

## Next: S2

Put it on the overview, for the owner and the accountant:

- a period selector (this month by default) and a branch selector;
- the stat cards with "against last period";
- a chart of collections, expenses and result: drawn as plain SVG, no chart library;
- new patients and net income.
