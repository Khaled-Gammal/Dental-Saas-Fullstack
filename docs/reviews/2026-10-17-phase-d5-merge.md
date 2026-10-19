# Phase D5 review — merging duplicate patients (2026-10-17)

Scope: SRS PATIENT-003 (`docs/roadmap.md`, Phase D5), with the accepted CLR-15 default. Branch: `v4/phase-d5-merge`
(on top of D4). The D4 decisions were approved ("ok"); D4's CI run 39060899597 passed.

## What changed

| Area | Change | Where |
| --- | --- | --- |
| Merge | `POST /patients/:id/merge {mergedId}` (`patients:merge`): one database transaction moves every row of the duplicate to the survivor — appointments, invoices, installment plans, payments, visits, treatment plans, prescriptions, chart entries, follow-ups, X-rays and files, consents, lab orders, reviews, waiting list, notifications and medical-history versions. Children whose guardian was the duplicate now point at the survivor. The duplicate keeps its own data, gets `merged_into_id`/`merged_at` and leaves every list and search. Audited on both records (`patient.merge`, `patient.merged_into`); each moved money/clinical row is also audited by its own trigger | migration 0022 `merge_patients()`; `PatientsService.merge` |
| CLR-15 | Allergies, conditions and medications are combined (no allergy lost, no repeat ignoring case); the survivor's other details, flags and notes are kept | `text_array_union` |
| Preview | `GET /patients/:id/merge-preview?other=` shows both records, what would move (per table, every branch), the fields that differ (the survivor keeps its own) and, for members with clinical access, the combined medical lists and the flags that differ | `patient_merge_counts()`, `mergeConflicts`, `unionList` |
| Old links | Opening a merged record answers `patient_merged` with the survivor's id; the profile shows "this record was merged" with a link | `PatientsService.get`, `profile.tsx` |
| Dashboard | "دمج ملف مكرر" on the profile (members with `patients:merge`) → `#/patients/<id>/merge`: find the duplicate, compare side by side (differences highlighted), see what moves and the combined history, confirm (not reversible) | `screens/patients/merge.tsx` |
| Errors | `merge_self`, `already_merged`, `patient_not_found`, `patient_merged` | — |

## Migration and its risks

`20261031000022_patient_merge` — **Medium** (security-sensitive, but no data changes when applied).
- The merge must move rows that the API role is not allowed to change: recorded payments, issued invoices, final
  visits, accepted plans, issued prescriptions, chart entries. It therefore runs as `app_definer` (the existing
  BYPASSRLS role that owns the lookup functions), and **checks the clinic itself on every statement**. Tested: a
  patient of another clinic is "not found" for both the merge and the preview.
- Four guards get one narrow exception: a change of `patient_id` alone is allowed only when `current_user` is
  `app_definer` **and** the merge has set `app.patient_merge`. The API role setting that variable changes nothing
  (tested: the payment stays locked), and the guards are locked again after the merge (tested).
- `app_definer` gains SELECT/UPDATE on the moved tables and `installments`, INSERT on `audit_log` and the history
  versions, DELETE on `patient_medical_history` (the duplicate's row, after its versions moved) and SELECT on the tables
  the fired triggers read. These rights are used only by functions it owns.
- A branch-limited member who holds `patients:merge` moves rows of every branch: the person is one patient clinic-wide.
- Applying the migration rewrites nothing. Rollback was run on the test database (down, then up again) and restores the
  guards and grants exactly (including `app_definer`'s earlier SELECT on payments and appointments).

## Tests (run 2026-10-17)

| Suite | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | passed |
| Database tests | **327 checks passed** (new `21_patient_merge.sql`, 19 checks: preview counts, self-merge refused, a final visit cannot change patient outside a merge, the API role cannot use the merge switch, balances before/after (**acceptance 1**: the survivor's balance is the sum of both), **acceptance 2**: no row points at the merged record except `merged_into_id`, combined lists without repeats, survivor's flag kept, versions kept, the moved visit/plan/payment unchanged, guardian repointed, moved payment audited, second merge refused, payment locked again, another clinic refused) |
| API e2e + unit | **21 suites, 221 tests passed** (new `patients-merge.e2e-spec.ts`, 3 cases; merge rules added to `patient-rules.spec.ts`) |
| Dashboard unit | **60 passed** (router: the merge page) |
| Website unit | 20 passed |

**Browser check: partial.** The merge page renders (Arabic, RTL). The open browser session was clinic B's owner, which
has a single patient, so I could not view a preview there (clinic A's patient correctly showed "not found"); I did not
merge anything in your dev data, since a merge cannot be undone from the dashboard.

## Notes

- The seed receptionist and doctor roles have no `patients:merge` (production defaults give it to owner, doctor and
  receptionist, SRS B.1); the e2e test merges as the owner and checks the accountant is refused.
- A merge cannot be undone from the dashboard (SRS). The duplicate's data stays in the database, so support could
  restore it by hand if ever needed.
- Phase E (billing, payments, discounts, expenses, cash, reports) is next. Several of its rules wait for open
  decisions: CLR-02 (discount limits and approval), CLR-03 (expense approval), CLR-04 (cash sessions), CLR-09
  (currency), CLR-12 (waivers/write-offs), CLR-17 (print format). The proposed defaults are in SRS Part C.
