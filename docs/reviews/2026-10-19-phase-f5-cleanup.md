# Phase F5 review — Arabic-only code cleanup and today's no-shows (2026-10-19)

Owner's answers after Phase G, applied on `v4/phase-f5-cleanup` (from `main`):

1. **"My day" rule:** kept, as F4 built it.
2. **No-shows:** the owner and accountant home now shows no-shows for **today and the month**, each with its rate.
   `GET /reports/home` adds `finance.today.no_show` and `no_show_rate`. Today's rate counts only the appointments
   that came due so far.
3. **L10N-008 cleanup, approved:**
   - the dashboard dictionary keeps its Arabic text only (1,360 entries), and `t(key)` takes no language;
   - `tOr`, `errorText`, `roleLabel`, `minutesLabel`, `categoryLabel`, `money`, `currencyLabel`, `fmtNumber` and
     `fieldIssueText` lose their language parameter;
   - every `lang` prop, the `Lang` type, the language context (`lang.tsx`, `useLang`) and the English calendar
     locale are gone (62 files);
   - names use the new shared `arName(ar, en, fallback)`: Arabic first, English only where no Arabic exists (CLR-07);
   - the `_en` and locale **columns and their data stay** in the database, as the SRS requires.

## How it was done

- A scripted, rule-based rewrite (git keeps every original), then hand fixes for the six places that branched on the
  language (clinic about-text preview, doctor title, discount role names, sign-up locale, receipt amounts, App).
- Typecheck and lint guided the hand fixes.

## Tests (run 2026-10-19)

| Check | Result |
| --- | --- |
| Dashboard unit | 17 files, **75 passed** (the Arabic-only, error-code and validation tests included) |
| Website unit | 23 passed |
| `pnpm typecheck`, `pnpm lint`, dashboard build | passed |
| Browser | signed in as the owner (dev quick sign-in). The sign-in page and **all 33 dashboard screens** render with content and no error message. The only Latin text left is data or technical codes: ISO currency codes in the currency picker, branch web addresses, staff email addresses |
| API | the home endpoint change is covered by `reports.e2e-spec.ts` (`today.no_show`); the full suite runs in CI |
