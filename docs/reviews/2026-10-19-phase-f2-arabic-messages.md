# Phase F2 review — Arabic errors, emails, currency and times (2026-10-19)

Scope: L10N-003, L10N-004, and the dashboard parts of L10N-005 and L10N-006 (CLR-08). Branch:
`v4/phase-f2-arabic-messages` (on top of F1).

## What changed

- **Errors (L10N-003):**
  - every error code the API can send now has an Arabic text. There were 52 missing, including the "not found" ones,
    sessions, and several database rules;
  - an unknown code shows Arabic for its HTTP status, never the server's English `detail`, which stays for developers;
  - image uploads use the same rule;
  - a test reads the API source and fails when a code has no Arabic text.
- **Field problems:**
  - the API's validation pipe now sends the Zod `rule` and its limit next to the English message;
  - the dashboard words it in Arabic, e.g. «الاسم: 2 أحرف على الأقل» or «المبلغ: لا يقل عن 0.01». Amounts in minor
    units are shown in pounds;
  - an unknown field reads «أحد الحقول».
- **Emails (L10N-004):** Arabic only. The English lines were removed from:
  - the verification code (email and SMS text);
  - the booking confirmation and the code email;
  - reminders.

  Every email now goes as plain text plus a right-to-left HTML version (`arabic-mail.ts`). Dates in emails use one
  wording: «السبت، 24 أكتوبر في 5:00 م».
- **Times (CLR-08):** Latin digits and a 12-hour clock with ص/م, in emails and in the dashboard. The five screens that
  forced a 24-hour clock (day list, booking, moving, conflicts, patient profile) are changed. The branch's time zone
  is still used.
- **Currency (L10N-005):**
  - the shell records the clinic's currency from its profile, and `money()` and the new `currencyLabel()` follow it;
  - the price list, service and plan forms, visit procedures, check-in amount and discount fields no longer
    hard-code «ج.م».
- **Labels:**
  - doctor specialties stored as codes (`orthodontics`) show in Arabic (`specialtyLabel`, moved from the website into
    the shared `@dental/ui/text` so both use one list);
  - editing a doctor shows the Arabic labels and saves codes unchanged unless the field is edited;
  - two catalogue categories (`surgery`, `implant`) had no Arabic label and showed in English on the price list. They
    now have one.

## Not done (next)

- **F3, the website:**
  - `locales` `{ar}` (CLR-07);
  - Arabic booking messages;
  - the clinic currency on public prices;
  - the same time format.
- **F4:** the home screen per role (REPORT-006).

## Tests (run 2026-10-19)

| Check | Result |
| --- | --- |
| `pnpm --filter @dental/db test` | 26 files, **428 checks passed** (no database change) |
| API (`pnpm --filter @dental/api test`) | **30 suites, 288 tests passed**. New: `zod-body.spec.ts` (rules and limits), `arabic-mail.spec.ts` (date wording, RTL HTML). Updated: the worker email test now checks the 12-hour time and fails on any English word or Arabic-Indic digit |
| Dashboard unit | **17 files, 75 passed**. New: `api-error-codes.test.ts` (every API code has Arabic), `validation-text.test.ts` |
| Website unit | 20 passed; `tsc --noEmit` passed |
| `pnpm typecheck`, `pnpm lint` | passed |
| Website production build | **not run locally**. Your website dev server (port 3000) uses the same `apps/web/.next` folder, and a build next to it fails on missing chunks. Clearing the folder would break the dev server, so the build is left to CI |
| Browser | price list on the dev data: amounts in «ج.م» from the clinic setting; it showed the `surgery` category in English, which led to the label fix. Day list: no appointments today, so the 12-hour time is covered by tests only |

## Note

- The earlier website build failure (E4) had the same cause: the dev server was running. Deleting `.next` then fixed
  the build, but it may have made your dev server rebuild.
