# Phase D4 review — clinical: visits, notes, procedures, prescriptions, chart, plans, follow-ups (2026-10-17)

Scope: SRS VISIT-001…005, CHART-001, TPLAN-001…004, APPT-007, AUDIT-002, and the visit-screen alert of PATIENT-005
(`docs/roadmap.md`, Phase D4). Decisions applied: the accepted defaults of CLR-06 (when a note is final, who amends),
CLR-11 (staff record plan acceptance) and CLR-16 (procedure price). Branch: `v4/phase-d4-clinical` (on top of D3).

## What changed

| Requirement | Change | Where |
| --- | --- | --- |
| VISIT-001 | `POST /visits` opens the visit of a checked-in appointment of the doctor's own (owner: any), once (a second call returns the same visit), or a walk-in visit by its doctor. Opening it moves the appointment to "in progress" (trigger). The day list shows "فتح الزيارة" for arrived patients; everyone who reads appointments sees that a visit exists (`visit_id`) | `modules/clinical`, migration 0021; dashboard `#/visits/<id>/view`, appointments list |
| VISIT-002 | Notes are a draft until the doctor finalizes them or the appointment is completed (whichever is first). The database refuses any change to a final note and any delete of a visit. Changes after that are amendments (field, new text, reason ≥ 3 characters, author, time), added by the visit's doctor or the owner, shown under the original | `visits_guard`, `visit_amendments` |
| VISIT-003 | Procedures: service, tooth (FDI) and surfaces, price, notes, optionally a plan item (then service, tooth and estimated price come from it, and the item becomes "done"). Price = the service price or within its range (CLR-16); a service priced on consultation takes the doctor's price. A procedure is removed only while the visit is a draft and it is not on an invoice. The doctor's commission rate is copied onto the procedure (payouts stay deferred) | `visit_procedures_workflow`, `VisitsService.addProcedure` |
| VISIT-004 | Prescriptions with drug, dose, frequency, duration and instructions per line. Issued at once, never edited (no UPDATE/DELETE grant; lines only in the issuing transaction). A correction is a new prescription that replaces the old one (once); the old one stays, marked "replaced". `#/prescriptions/<id>/print`: Arabic, RTL, clinic name and logo, branch address and phone, doctor and title, patient name, age and file number, date; A5 or A4; Latin drug names keep their direction (`<bdi dir="auto">`) | `prescriptions_validate`, `prescription-print.tsx` |
| VISIT-005 | Follow-up list `#/followups` (due, upcoming, closed): add (from a visit or the profile), log a call (a dated line per call, attempts counted), book (links the appointment), dismiss. A cancelled or missed booking puts the follow-up back on the list; a completed one closes it. **Nothing is sent automatically** | `/recalls`, `appointments_clinical_follow` |
| CHART-001 | FDI chart (permanent; primary teeth shown for under-13s, when charted, or on demand). Current condition per tooth with colours (needs treatment, treated, missing, healthy), tooth history, new entries with surfaces and a note. Entries are never edited; entries made in a visit link to it and must be that visit's patient. **The chart is drawn left to right in every language** (patient's right on the viewer's left) | `GET/POST /patients/:id/chart`, `chart.tsx` |
| TPLAN-001…003 | Plans of a patient: draft → proposed → accepted (records the member and the time, CLR-11), cancel from any open status. Items with service, tooth, surfaces, estimated price and an estimate-only discount; the estimate is derived. Once accepted, items are fixed and can only be cancelled; a cancelled item stays visible. "In progress" and "completed" follow the items (first done item; all done or cancelled) | `treatment_plans_guard`, `treatment_plan_items_guard`, `#/plans/<id>/view` |
| TPLAN-004 | Summary: estimate, done, remaining, items done/total, next planned item and the doctor's latest next-visit note. **Invoiced, paid and balance are not shown yet**: they need billing (Phase E) | `PlansService.view` |
| APPT-007 | "حجز الموعد القادم" on the visit pre-fills the booking form with the patient, doctor, branch and the next planned item's service; booking links the item ("scheduled"). Plan items and follow-ups also have "book". A cancelled or missed booking puts the item back to "planned" | `nextBookingQuery`, `POST /plans/:id/items/:itemId/schedule` |
| PATIENT-005 | The visit screen opens with the allergies, pregnancy and conditions on top (and the medications) | `VisitPage` |
| AUDIT-002 | Database audit triggers on visits, amendments, procedures, chart entries, plans and items, prescriptions and lines, follow-ups record what changed and who; clinical text columns are logged as `true`, never their content. Opening a visit, a prescription and a chart is audited (once per 10 minutes per person) | migration 0021 §7, `AuditLog.recordView` |

Patient profile: new cards for clinical visits, the chart, treatment plans and follow-ups. Navigation: "المتابعات".

## Migration and its risks

`20261030000021_clinical_workflow` — **Low**. The clinical tables had no rows in the dev and test databases (checked
before writing), so the new CHECKs and guards apply to new data only. New columns are nullable or defaulted; one new
table (`visit_amendments`, RLS by clinic and branch, no UPDATE/DELETE grant). `REVOKE UPDATE, DELETE` on prescriptions
and their lines. The appointment trigger skips hold expiry (the hold release runs as `app_definer`, and a hold never
carries a plan item or follow-up). Every guard is silent during a tenant hard delete. Applied to the test and dev
databases; types regenerated.

Changed test data: `04_billing.sql` priced a composite filling (800–1,200 EGP) at 500 EGP, which CLR-16 now refuses;
the test now uses 1,000 EGP at 10 % (same 100 EGP commission it checks).

Seed (fresh databases only — your dev database was **not** re-seeded): the doctor role gains `clinical:read` and
`treatments:write:own` (SRS B.1), and a demo accountant `accountant.a@demo.test` is added. The seed receptionist is kept
without `clinical:read` on purpose, so the tests cover a role with no clinical access; new clinics' receptionists do
have it.

## Tests (run 2026-10-17)

| Suite | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | passed |
| Database tests | **308 checks passed** (new `20_clinical_workflow.sql`: 43 checks: draft on insert, opening starts the appointment, completion finalizes, final notes refused, no delete, amendments need a reason and are append-only, audit without clinical text, plan transitions and acceptance, items fixed after acceptance, done only through a procedure, CLR-16 price range, progress and completion, reopen on procedure removal, final visit keeps procedures, cancelled plan closed, chart entry of another patient refused, prescriptions immutable and corrected once, follow-ups and plan items follow their appointment, another clinic sees nothing) |
| API e2e + unit | **20 suites, 216 tests passed** (new `clinical.e2e-spec.ts`, 14 cases; new `clinical-rules.spec.ts`, 8 cases) |
| Dashboard unit | **60 passed** (new `clinical-model.test.ts`; router tests for the new pages) |
| Website unit | 20 passed |

**Browser check: partial.** The connected Chrome reaches `localhost:5173` now. On your dev data, signed in as the
owner, I viewed the follow-up list, a patient profile with the new cards and the dental chart (orientation and the
tooth panel); no console errors. This found the chart too wide for its card (fixed: teeth shrink to fit). I did not
create visits or chart entries in your dev database because they can never be deleted; the visit, plan and printable
prescription pages were therefore not clicked through, and printing on paper is not verified.

## Decisions made in this phase (please confirm or change)

1. **Procedures after finalization**: a final visit can still get *new* procedures (the doctor may have forgotten one
   before reception completed the appointment), but its recorded procedures are not changed or removed.
2. **Plan items need an accepted plan**: a procedure can complete a plan item only after the patient's acceptance was
   recorded (`plan_not_accepted` otherwise).
3. **Accepted plans are fixed**: no item is added or re-priced after acceptance; items can only be cancelled, and
   new work goes into a new plan. (The SRS says items are never *deleted* once accepted; refusing additions is my
   reading, to keep the agreed estimate honest.)
4. **All items cancelled = completed**: TPLAN-002 says a plan completes "when every item is done or cancelled"; I
   applied it literally, so a plan whose items were all cancelled shows "completed".
5. **Who records acceptance**: the plan's doctor or the owner (not reception), with the member and time stored.
6. **Plans are readable by every member who reads patients** (the SRS says "others read"), including the accountant;
   the doctor's next-visit note inside the plan summary is hidden from members without clinical access.
7. **Call log** is kept as dated lines in the follow-up's notes (up to 4,000 characters, the oldest lines dropped
   first) rather than a separate table.
8. **Booking ↔ plan item / follow-up link** is a second request after the booking succeeds; if it fails, the
   appointment stands and the item stays open (the user can link it again).
9. **Digits and dates on the printout** use Latin digits and Cairo time, like the rest of the dashboard, until CLR-08
   is answered.

## Notes and follow-ups

- Your dev database still has the old seed roles, so `doctor.a@demo.test` cannot record procedures or plans there. To
  give the demo doctor the new rights without resetting your data:
  `UPDATE roles SET permissions = permissions || '{clinical:read,treatments:write:own}' WHERE id = 'a0000000-0000-0000-0000-0000000000a3';`
- The "open visit" button shows for any member with `clinical:write` on arrived patients; the API refuses another
  doctor's appointment with a clear message (the session does not carry the member's doctor id).
- Attaching an X-ray to a specific visit (PATIENT-004, optional) is still not built.
- Invoiced/paid/balance in the plan summary, and turning performed procedures into invoice lines, come with Phase E.
- The dashboard copy is still bilingual until Phase F; new strings exist in Arabic and English.
