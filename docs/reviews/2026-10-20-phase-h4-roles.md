# Phase H4 review — roles the owner creates (2026-10-20)

The owner asked: create roles, choose their permissions, have the API enforce them and the dashboard hide what a
member may not use. Built on `v4/phase-h4-roles` (from `main` e7e903c). Migration 0030, applied to the dev database.
New requirement ACCESS-006 in the SRS.

## Decisions (owner, 2026-10-20)

1. **Built-in roles stay fixed** (owner, doctor, receptionist, assistant, accountant keep their B.1 permissions). The
   owner customises by creating new roles, optionally as a copy of a built-in one.
2. **`staff:manage` may be given to a custom role** (e.g. a clinic manager). To stop anyone raising their own rights,
   these guards apply to every member who is not the owner:
   - they give a role only permissions they hold themselves;
   - they cannot change their own role or status, nor edit the role they hold;
   - they cannot give or take the owner role (or disable an owner);
   - `*` (every permission) belongs to the owner role only.
3. **Separation rule** (clinical writing and money writing in one role): a warning on the screen, saving is allowed.

## What changed

- **Database (0030):** `grantable_permissions()` — the 35 permissions of B.1 a role may hold. `roles_guard` (for the
  API's database user): built-in roles are created with their defaults and then only their discount limits change; a
  custom role holds catalogue permissions only (never `*`), keeps a generated key, and once archived does not change.
  An edit of a role's permissions gives its members a new access version (it applies on their next request). An
  archived role is given to nobody new. Role names are unique among roles in use. Role changes are audited (existing
  trigger).
- **API (`staff:manage`):** `GET /staff/permissions` (the catalogue in screen groups, with what each permission
  needs); `GET /staff/roles` now with permissions, members, open invitations, archived state, the separation warning
  and `can.edit` for the caller; `POST /staff/roles`, `PATCH /staff/roles/:id`, `DELETE /staff/roles/:id` (deleted if
  nobody ever held it; archived if past members or invitations refer to it; refused while members or open invitations
  hold it). Inviting and changing members apply the guards above. A permission needs what its screens read first
  (e.g. `patients:write` needs `patients:read`), so a role is never half-usable. The session now carries the role's
  name, so a custom role shows by its name.
- **Dashboard:**
  - «الأدوار والصلاحيات» (`#/roles`): built-in and custom roles with member counts; create, copy a built-in role, edit,
    delete/archive. Permissions are grouped with Arabic names; ticking one ticks what it needs; permissions the member
    does not hold are locked for a non-owner; the separation warning shows while editing.
  - **One page-access map** (`access.ts`) for the menu and the router: a member never sees a menu item, or opens a
    page, whose data the API would refuse. Before, appointments, patients and gallery showed in everyone's menu, and
    seven routes had no check.
  - Role pickers (invite, edit member) show custom roles by name, hide archived ones, and offer a non-owner only the
    roles they may give.
  - **Buttons hidden where the API refused them for built-in roles** (found by a page-by-page audit): "book" on a plan
    and "book next" on a visit (doctor: needs `appointments:write`); the follow-up form on a visit (assistant: needs
    `patients:write`); the block-booking switch (doctor: needs `patients:block`); "add patient" in the booking picker;
    start/complete/open-visit on other doctors' appointments (a doctor now has them in "مواعيدي"); the branch photo
    (needs `settings:write`); the expense form's branch list (no longer needs the cash-box permission); balances on the
    day list now also need `patients:read`.

## Not changed

- The API was already the real gate on every route; H4 adds role management and the guards, it does not move any
  check to the dashboard.
- The owner role is never editable and keeps `*`.
- A doctor's own-only rights (`appointments:write:own`, `treatments:write:own`, `invoices:read:own`) only work for a
  member linked to a doctor record; giving them to a non-doctor role has no effect (the API checks the link).

## Tests (run 2026-10-20)

| Check | Result |
| --- | --- |
| `typecheck`, `lint` (API, dashboard), dashboard build | passed |
| Database tests (`pnpm db:test`) | **460 checks passed** (19 new in `28_custom_roles.sql`) |
| Migration 0030 down and up again on the test database | passed |
| API unit + e2e on the fresh test database | 32 suites, **313 tests passed** (new: `role-rules.spec.ts` — catalogue, built-in roles pass the same checks, anti-escalation, separation; `roles.e2e-spec.ts` — API and database offer the same permissions, create/refuse, a member given a role gets exactly its rights from the next request, a manager cannot raise anyone's rights or touch an owner, widening applies on the next request, archive) |
| Dashboard unit | 19 files, **86 passed** (new `access.test.ts`: page access for the owner, nobody and built-in roles; which roles may be given; ticking/unticking with dependencies) |

Not checked in a browser: the extension's browsers cannot reach `localhost:5173`. To try it: sign in as the owner →
«الأدوار والصلاحيات» → «دور جديد» (or «نسخ كدور جديد» on the receptionist) → give it to a member in «فريق العمل» → sign
in as that member and check the menu.
