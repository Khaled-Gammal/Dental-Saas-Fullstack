# ARC-01, phase ARC-3: the website's patient context, limited (2026-11-22)

This follows ARC-2 (`2026-11-22-arc-01-phase-2-enforce.md`); the user said "ok". Branch `v4/arc-01-signed-context`.

## The gap it closes

Since ARC-1/2, SQL running as the API role cannot choose a clinic. On the public website, though, the API itself enters the clinic of whatever hostname the request names, as `patient`. An injection inside a public endpoint therefore landed, legitimately, in that clinic, and could read its visits, dental charts, invoices, payments and staff.

## Inventory: what the public paths actually use

There are two ways to enter a patient context: `TenantDb.runForHost` (website, public media, gallery, online booking, self-service) and the booking confirm step (`TenantDb.enter`, actor `patient`). Three sources were combined:

1. **A trace.** Temporary RESTRICTIVE policies on every RLS table of `dental_test`, reporting table and command whenever the patient context touched it, while 9 public API suites ran (60 tests).
   - The trace only fires when a row is scanned: PostgreSQL keeps policy conditions as row filters. A lookup that finds nothing is never recorded, so the trace alone is not enough.
2. **Reading every query** on those paths:
   - `public-site.repository`;
   - the gallery and media public reads;
   - `kysely-scheduling.repository`;
   - `patient-directory` → `patients.repository`;
   - `audit-log`;
   - `plan-limits`.

   This added `holidays` and `doctor_time_off` (the slot search) and the `files` reads.
3. **The triggers those writes fire.** `appointments_clinical_follow()` runs when a patient cancels from their own link and updates the recall, the visit and the treatment-plan item of that appointment. It is now a definer function (below), so the patient context needs none of those tables.

| Mode | Tables | Patient may |
|---|---|---|
| read | branches, branch_hours, holidays, rooms, doctors, doctor_branches, doctor_schedules, doctor_services, doctor_time_off, services, service_categories, faqs, gallery_items, sites, tenant_settings, tenants, subscriptions | SELECT |
| files | files | SELECT, except `xray`, `clinical_photo`, `consent`, `document`, `invoice_pdf` |
| read_write | appointments, patients | SELECT, INSERT, UPDATE |
| insert_only | audit_log, outbox_events | INSERT |
| deny | the other 51 RLS tables, **and any table added later** until its migration gives it a patient policy | nothing |

## What changed

### `20261205000079_patient_context_scope`

- **`is_patient_context()`:** reads `app.actor_type` directly, on purpose. The setting is covered by the signed proof (0077), so changing it drops the clinic altogether. It costs nothing per row.
- **112 RESTRICTIVE policies** named `patient_scope*`, one set per mode above. The migration fails if any RLS table is left without one.
- **`appointments_clinical_follow()` → SECURITY DEFINER** (owner `app_definer`). It updates only the rows booked on that appointment. `app_definer` gains UPDATE on `treatment_plan_items` and SELECT on `visit_procedures`, which the item guard reads.
- **`next_tenant_counter()` → SECURITY DEFINER.** A new website booker gets a file number without the patient context touching `tenant_counters`. `app_definer` gains SELECT/INSERT/UPDATE there. EXECUTE is limited to `app_user` and `app_worker`.
- **`down`** drops the policies and restores both functions and the grants exactly as they were (checked before writing it).

No API change was needed.

### Tests

- **New `packages/db/test/45_arc_patient_scope.sql`** (23 checks), run through dblink as a real `app_user` login entered with a signed hostname. It checks:
  - every RLS table has a patient policy (a new table without one fails here);
  - the website context reads the catalogue, appointments, patients and the logo file;
  - it does not reach, though each has rows in clinic A:
    - an x-ray file;
    - the medical history, invoices, recalls, treatment plans and their items;
    - staff and roles, the audit trail, domains and counters;
    - visits, the dental chart, prescriptions, patient files, payments, expenses, invitations and exports;
  - it cannot write an invoice or change a price;
  - it can add to the audit trail and the outbox, and a new booker gets a file number;
  - setting its own actor to staff to escape leaves no clinic at all;
  - a patient's own cancellation still reopens its recall and plan item (definer trigger);
  - the owner's context still sees invoices, x-rays and staff.
- **`14_audit_triggers.sql`:** the website-booking check now sets the context the website really has (no member), and reads the audit row back as staff. It had combined a staff member with the patient actor, which the API never does.

## Checks run

- `pnpm db:test`: 46 files, **831 checks passed** (fresh database through 0079, enforcing).
- 0079 rolled back (0 patient policies, both functions back to invoker) and applied again (112 policies) on `dental_test`.
- `pnpm --filter @dental/api test` against `dental_test`: 60 suites, **478 tests passed**. That covers every public flow: website, gallery, media, booking hold, details, confirm and release, self-service view, slots, cancel and move.

## What is still open (for a decision)

1. **`patients` and `appointments` in the website context.** The booking matches the booker by phone and name and creates or updates the record; self-service reads the booking by its link. An injection in a public endpoint could still read that one clinic's patient list (names, phones, emails) and its appointments. Two ways to close it:
   - **ARC-3b-1:** move those reads and writes into narrow definer functions (find-or-create the booker; the booking by manage-link hash or hold id). The patient context then needs no direct access to either table. API change in `patient-directory`, `kysely-scheduling.repository` (about 8 methods) and the self-service use case.
   - **ARC-3b-2:** bind a "subject" into the signed host context (the hold id or the link hash), with policies allowing only those rows. Smaller SQL, but every public route must know its subject before the first query.
2. **`outbox_events` INSERT.** A patient-context injection could queue events (for example booking emails) for that clinic. Lower impact; the worker builds messages only from rows it reads itself.
3. **Dev database:** still at 0077, permissive (see ARC-2). 0078 and 0079 apply with `pnpm db:migrate` when you choose.

Nothing is committed (branch `v4/arc-01-signed-context`).
