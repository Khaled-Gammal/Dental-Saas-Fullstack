# Dashboard in the websites' design — stage D4, create and edit pages (2026-11-04)

After D3 (polish, f577a8d), the user sent a screenshot of "مريض جديد" and asked: "i want redesign all pages for
adding too". Then, with a screenshot of the daily cash page: "make all fill width after redesign".

## One layout for every form (ui/page.tsx)

All 14 create/edit screens use `FormPage`, so the redesign is made there once and each screen only names its parts:

- **Header panel** (`.form-hero`): the page's icon in a glossy arch tile in the clinic's colour, the breadcrumbs, the
  title and its line, with the websites' blob and dots at the far side (smaller blob and no dots on phones).
- **Numbered sections** (`FormSection`): a card per part with its number in a small pastel arch, the title, an optional
  line and an optional action (add a guardian, add an invoice line, the "outside the doctor's schedule" switch). Numbers
  are a CSS counter, so a part that appears or goes renumbers the rest; `done` turns the number into a check (the new
  appointment's parts as they are filled). A page with one section shows no number.
- **Side guide** (`FormGuide`, from two sections up): the sections on a dashed thread, the one being read marked as
  the page scrolls. Choosing one scrolls to it (no animation for reduced motion), moves the focus to its heading, and
  stays marked until the reader scrolls by themselves. Buttons, not `#id` links: the dashboard routes by hash. A page
  with its own side column (the new appointment's summary) keeps it instead. Under 900px of form width (a container
  query, so the open sidebar counts) the guide goes away and a summary moves under the form.
- **Save bar**: Cancel + Save in a floating glass pill at the form's end, like the header at the top; full width on
  phones.

Screens: patients (new/edit), new appointment (its own numbered steps became `FormSection`), change appointment,
branches (new/edit, hours), doctors (new/edit, schedule), services, gallery photo, staff invite and edit, roles, new
invoice, new expense. Grouping changes made on the way:

- Branch: the address joined the basic data (it was a card with one field named like the card); the photo got its own
  section (`ImageField hideLabel`, so its name is not shown twice); "active" moved to a "الحالة" section.
- Doctor and service: the branch and doctor check lists are sections whose explanation is the section's line.
- Staff edit: the member's name and email are the header's line; the section is "الدور والدخول".
- Roles: each permission group is a section, so the guide lists the groups of a long form.
- Change appointment: the appointment being changed in a tinted box ("الموعد الحالي"); the chair sits beside the
  doctor and the day in "الموعد الجديد", or alone in "تحديد الكرسي" once the patient has arrived.

## Every page fills the width

The pages that kept a 960px column (clinic data, booking rules, daily cash, discounts, holidays: `NARROW_PAGES` and
`.content-narrow`) now use the full width beside the sidebar, as do the forms (no 880/1200px cap), the website page
(880px), the activity log (960px) and the plan card on the clinic profile (720px). Widths inside components stay (search
boxes, filters, empty-state text, the search-result preview, the public legal page's reading width). On the cash page
the close button now sits under the amount it closes rather than at the far side of the wider panel.

## Found and fixed

The branch edit page scrolled sideways by 56px: `.image-field legend { width: 100% }` outweighed `.sr-only` on the
hidden legend. `.sr-only` now holds its 1px box with `!important`, as such utilities usually do.

## Checks

Typecheck, lint, 187 tests, production build. Screenshots of the 15 form pages and the 8 formerly narrow pages at 1536
(the user's screen), 1440, 1024 and 390px: no page scrolls sideways. Guide test in the browser: choosing "ولي الأمر"
scrolls, focuses its heading and keeps it marked at the end of the page; a wheel scroll back to the top marks the first
part again. `api-error-codes.test.ts` timed out once in a full run while the machine was busy and passed alone (known
since D3).

Not seen on screen: "الموعد الجديد" with its time slots, which needs a confirmed or pending appointment; the demo
clinic has none and none was created.
