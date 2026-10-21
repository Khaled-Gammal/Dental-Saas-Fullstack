# Services: the clinic's own list, with delete (2026-10-21)

The user asked to remove the static services from «الخدمات والأسعار»: every clinic enters its own services and can
delete them. On `v4/services-dynamic`.

## Decisions (the owner's answers, all the recommended ones)

- **Delete always works.** A service nothing used is removed. One that appointments, treatment plans, visits, invoices
  or the waitlist point at is hidden everywhere and kept, so that history keeps its name. The clinic never gets an
  error.
- **The ready-made list is removed.** No card, no API. The 9-row `service_catalog` table stays in the database, unused
  (no destructive migration). Services clinics already added from it stay as their own normal services.
- **Doctors per service.** «الأطباء الذين يقدمونها» in the service form; a new service starts with every active doctor
  ticked.

## What was wrong before

- Nothing in the API ever wrote `doctor_services`; only the demo seed did. Staff and online booking both offer a service
  only with the doctors linked to it (`doctorsFor` joins `doctor_services`), so a service a clinic added itself could
  not be booked, in the dashboard or on the website. The audit listed "doctor assignment" as implemented.
- There was no delete. A service could only be switched to inactive.

## What changed

**Database** (migration `20261115000037_service_delete`)
- `services.deleted_at timestamptz`, nullable.
- `services_deleted_is_off`: a deleted service is never active, never on the website, never bookable. Every existing
  "active" filter therefore already hides it (public site, booking, the dashboard's pickers, the onboarding check).
- `migrate:down` drops both. Rolled back and re-applied on the test database.

**API**
- `DELETE /services/:id` (`settings:write`, 204). It locks the row, then:
  - nothing points at it: the row is deleted (doctor links cascade; FAQs and gallery items keep themselves without the
    link), and its image is released after the commit;
  - something points at it: `deleted_at` is set, the three switches go off, the doctor links are removed.
  The lock makes a concurrent use wait for the decision. A deleted service is gone from `GET /services`, and `PATCH`
  or `DELETE` on it answer 404.
- `doctorIds` on `POST` and `PATCH /services` (the whole set; duplicates collapse). Left out on create: every active
  doctor. Another clinic's doctor: 400 `doctor_not_found`. `GET /services` returns `doctor_ids`.
- A new doctor performs every active service (`POST /doctors`), the mirror of the rule above. Without it a doctor added
  after the services would be bookable for nothing.
- `GET /services/catalog` and `catalogCode` are removed; `durationMinutes` is now required on create. The
  `service_already_added` mapping went with them (nothing can trigger it).
- New uses of a deleted service are refused with `service_not_found`: invoice lines, new plan items, visit procedures.
  An item already in an accepted plan can still be done, and a draft plan's existing item can still be repriced.
  Booking already refused it (inactive).

**Dashboard**
- The «من القائمة الجاهزة» card, `useCatalog`, the catalogue category labels and their styles are gone.
- The row menu has «حذف» after «تعديل», confirmed in a dialog: «ستُحذف «…» من قائمة أسعارك ومن موقعك ولن يمكن حجزها.
  المواعيد والزيارات والفواتير السابقة تبقى كما هي.»
- The form starts empty (30 minutes), with the doctors card: active doctors, plus an inactive one only while it is still
  ticked. With doctors but none ticked it says the service can't be booked; with no doctors it says where to add them.

**Docs:** SRS (onboarding step 4, the services row), implementation audit.

## Checks

- API e2e `catalog.e2e-spec.ts`: 16 pass. The new tests cover:
  - the catalogue route is gone;
  - the default and chosen doctors, and booking options following them;
  - another clinic's doctor refused;
  - a new doctor linked to every service;
  - validation and permissions (reception: 403 on add and delete);
  - deleting an unused service: gone, and 404 for another clinic and afterwards;
  - deleting a used service: off the list, the website and booking, the visit and the invoice still show its name,
    and a new visit procedure or invoice line with it is refused.
- Full API e2e locally: 347 pass, 15 fail. The same 15 fail on main with this change stashed (identical list): the
  local test database's leftovers (consents, platform, staff, reports, clinic data, onboarding publish, api). CI uses
  a fresh database.
- DB tests: 581 checks pass, including the new ones for `services_deleted_is_off`.
- Dashboard: lint, typecheck, 123 unit tests (new: empty form with doctors, doctor-set diff), build.
- Screenshots: the list without the card, the row menu with «حذف», the confirm dialog (the first version broke the
  sentence over lines; it is now one span), the new-service form with both doctors ticked.

## Not changed

- The website's hero chips («طب أسنان عام»…) are the clinic's specialties (`tenants.specialties`), not services. They
  are still not editable in the dashboard.
- Moving an appointment whose service was deleted (or switched off) still fails to find free times, as for an inactive
  service before.
