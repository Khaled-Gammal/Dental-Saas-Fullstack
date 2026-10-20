# Dashboard redesign — R5: phones, right-to-left, permissions, accessibility, performance (2026-10-20)

Last stage of the redesign (plan in `2026-10-20-redesign-r1-shell.md`). Built on `v4/redesign-r5-polish` from `main`
ebdf6c5 (R4b merged as PR #17, main CI passed). A read-only audit of the code for right-to-left and accessibility
problems guided the fixes below.

## What changed

### Performance

- **Pages load when first opened:**
  - Every screen except sign-in, the shell and the overview is loaded the first time it is opened (`React.lazy` in
    `App.tsx` through `ui/lazy-screen.tsx`).
  - React, Radix and TanStack sit in their own `vendor` file. They change far less often than the app, so browsers keep
    them across deploys.

| File | Before | After |
| --- | --- | --- |
| The app (loaded first) | 1,824 KB (413 KB gzip), everything | 357 KB (90 KB gzip) |
| Libraries (`vendor`, cached across deploys) | (inside the above) | 604 KB (183 KB gzip) |
| Each page | (inside the above) | its own file, mostly 5–60 KB |

- **The size warning** now starts at 700 KB, just above the vendor file. Every other file is far smaller.
- **After a deploy:** a page whose old file is gone reloads once to fetch the new one. It never reloads in a loop, and
  it uses `sessionStorage` (wrapped in try/catch).
- **No more blank app:** a page that fails to load or throws while drawing shows a card with «إعادة تحميل الصفحة»
  and leaves the menu usable. Before, one crashing screen blanked the whole app.

### Phones

- **No sideways page scroll:** none of the 16 main pages (overview, appointments, patients, invoices, discounts, cash,
  reports, branches, doctors, services, consents, gallery, team, roles, data, profile) scrolls sideways at 390 px.
- **Follow-ups table:** on a phone the mobile number (still tap-to-call) and the due date sit under the patient's name,
  and the three buttons stack. The table fits without scrolling. Desktop is unchanged.

### Right-to-left

- **Times in Arabic (`components/time-field.tsx`, `time-model.ts`, new).**
  - **Before:** the eight native time fields showed "05:00 PM" in the browser's language. They are the appointment time
    (new and move), doctor time off (from and to), branch hours and the doctor schedule.
  - **Now:** one list of times 5 minutes apart, labelled «5:00 م». It opens at the chosen time.
  - **Value:** still the 24-hour "HH:MM" the API takes. A saved time between two steps (say 17:07) stays in the list,
    so opening a form never changes it.
  - **Shift rows:** they now read right to left ("from – to").
- **Confirm dialogs:** the shadcn header's `sm:text-left` beat our `text-start`, so dialogs were left-aligned on wider
  screens. It is now `text-start`.
- **Merge page:** phone numbers and emails read left to right.
- **Loading shimmer:** it moves right to left, and stops when the system asks for reduced motion.

### Accessibility

- **Filter rows that are not tabs:**
  - **Where:** invoices, follow-ups, appointments, expenses and reports.
  - **Change:** these rows said `role="tab"` with no tab panels and no arrow keys. They are now a labelled group. Links
    mark the open one with `aria-current="page"`, and buttons use `aria-pressed`.
- **Date fields:** they read out their name and the chosen date. `aria-label` alone used to hide the date.
- **Time fields:** the hint (time zone) is linked to the field again; `Choice` gained `describedBy`.
- **Demo sign-in list:** its label is now in Arabic.

### Permissions

- **Checked:** signed in as reception, doctor and accountant (screenshots).
  - The menu shows only what each role may open: no Team or Website groups for them.
  - The accountant sees the money summary on the overview.
  - Opening a page the role isn't allowed (`#/staff`) shows «ليست لديك صلاحية لفتح هذه الصفحة».
- **Unchanged:** the API's own permission checks, which remain the real gate.

## Verified (2026-10-20)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 26 files, **118 passed** (3 new: time labels, the list in steps, keeping an off-step saved time) |
| Screenshots (headless Chrome) | 16 pages at 390 px, none scrolls sideways; follow-ups on phone and desktop; doctor schedule with Arabic times, on desktop and phone, with the time list open; reception, doctor and accountant menus and the blocked page |
| Other tests | no end-to-end test depended on the old time inputs or tab roles |

**Local tooling:** the screenshot script never deleted its headless Chrome profile, and those folders filled the C:
drive mid-stage. The user cleared them. The script (outside the repo) now removes its profile after every run.

## Left as it is

- **API row caps:** the API returns at most 100 invoices and 200 expenses per request, with no "load more". This
  predates the redesign and needs an API change. Flagged in R4a.
- **Signature pad:** it is drawn with a pointer only. The typed signer's name is the keyboard alternative, as before.
- **Row click:** a whole-row click is mouse-only. Every table that uses it also has a real link or button in the row,
  so the keyboard path exists.
- **Arabic texts:** all of them (`i18n.ts`, ~108 KB) still load up front, including the platform panel's. Splitting
  them is a later optimisation.

## The redesign, done

R1 shell and theme, R2 shared patterns, R3 patients and invoices, R4a the remaining lists, R4b forms and inputs, and
R5 this pass. Throughout, the business logic, API contracts, permissions, tenant isolation and every money calculation
are unchanged.
