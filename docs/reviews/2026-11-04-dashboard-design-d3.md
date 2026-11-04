# Dashboard in the websites' design — stage D3, polish (2026-11-04)

After D1 (3167dc1) and D2 (0e41e46) on `v4/dashboard-design` (pushed; CI run 41834237597 green), the user said "ok" to
D3: phone details across the screens, print checks, motion. CSS only (apps/dashboard/src/styles.css).

## Phone sweep

All 31 list and create screens at 390 px (overview, appointments and new appointment, patients with new and import,
visits, follow-ups, plans, clinic profile, branches, doctors, services with their create pages, gallery, invoices and
new invoice, discounts, cash, expenses and new expense, reports, website, team, roles, holidays, booking rules, clinic
data, activity log): none scrolls sideways; tables scroll inside their own card as designed. Fixed:

- The appointments screen's four layouts (list, by doctor, by chair, week) wrapped into a row of three and one alone:
  now an even 2 × 2 grid on phones.
- A heading that the page focuses for screen readers (a new page, each step of the Excel import) showed the focus
  ring like a control: no ring on `h1–h3[tabindex="-1"]` (the page title already had this rule; it is now general).

## Print

Printed to PDF from the app: an invoice (A4), a receipt and the revenue report. All three printed in only about two
thirds of the page: the print rules hide everything but the sheet with `visibility`, which keeps the sidebar's space.
Now the sidebar, the floating bar and the skip link leave the layout when printing, the page prints on white even
with background graphics on, and report cards print with smaller corners. Prescriptions print through the same sheet
rules; the demo data has none, and none was created to test.

## Motion

Nothing moves for a member who asks for reduced motion: the sign-in drawing's float and sparkles are behind
`prefers-reduced-motion: no-preference`, and hover lifts use the shared durations, which are 0 then (tokens.css).

## Checks

Typecheck, lint, 187 tests, production build. `api-error-codes.test.ts` failed twice in full runs today while the
machine was busy and passed alone and on reruns (and on CI): it reads the whole API source synchronously and can pass
the 5-second test limit under load. Not changed here; a longer timeout for that one test would steady it.
