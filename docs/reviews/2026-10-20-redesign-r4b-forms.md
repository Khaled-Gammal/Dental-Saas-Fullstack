# Dashboard redesign — R4b: forms and inputs (2026-10-20)

Second half of R4 (plan in `2026-10-20-redesign-r1-shell.md`): the form controls that still showed the browser's own
look, or its English text, now match the rest of the dashboard. Built on `v4/redesign-r4b-forms` from `main` 2129263
(R4a merged as PR #16, main CI passed).

## What changed

- **File picker in Arabic (`components/file-picker.tsx`, new).**
  - **Before:** three file fields showed the browser's "Choose File / No file chosen", in the browser's language.
  - **Now:** an «اختر ملفًا» button and the chosen file's name, or «لم يُختر ملف بعد». When a file is chosen, the button
    says «تغيير الملف» and a «إزالة» link appears.
  - **Labels:** the label still names the field, because the button takes the Field's id.
  - **Where:**
    - the patient file's upload form;
    - the new-expense form's document;
    - the paper-consent scan.
  - **While uploading:** the picker is disabled.
  - **Unchanged:** the accepted types, the size checks and the upload calls. The image uploaders (gallery, logo) already
    had their own buttons and are untouched.
- **Checkboxes:** the 8 native checkboxes now use shadcn/ui's Checkbox:
  - legal acceptance at sign-up and on the invitation and re-acceptance screens;
  - unbilled work on a new invoice;
  - booking reminders;
  - consent «قرأت» and «راجعت»;
  - a doctor's branches;
  - an invitation's branches;
  - a role's permissions.
  - **Behaviour:** clicking the text still ticks the box, and disabled boxes stay disabled. Every value goes through
    the same handler as before.
  - **Required boxes:** the sign-up box keeps `required`, and the buttons still stay disabled until it is ticked.
  - **No new dependency:** it uses the `radix-ui` package already installed. The CLI added only
    `components/ui/checkbox.tsx`; `package.json` and the lockfile are unchanged.
- **Dropdowns:** the last two native selects now use the shared `Choice` (shadcn Select):
  - a doctor's schedule branch per shift;
  - the clinic currency.
  - **Closed branch:** in the schedule, a shift whose branch was closed still shows it as «غير نشط», and it cannot be
    chosen. `Choice` options gained an optional `disabled` for this.
- **Styles:**
  - The rules for the native inputs became rules for the checkbox: size, and alignment with multi-line text.
  - The unused `.select` and `.slot-branch` rules were removed.
  - The checkbox colours stay in shadcn's classes, since an unlayered colour rule would hide the ticked state.

Nothing about what is saved changed: same values, same requests, same permissions.

## Verified (2026-10-20)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 25 files, **115 passed** |
| Screenshots (headless Chrome, desktop 1440) | new-expense form with the Arabic picker; a new role's permission boxes, ticked by clicking the box and by clicking its text; doctor schedule with a branch dropdown per shift; clinic profile currency dropdown; staff invitation |

**Not checked by screenshot:** picking an actual file, because the script cannot open the system file dialog. The
picker passes the chosen file to the same `setFile` each form used before.

## Left as it is

- **Demo sign-in dropdown:** it stays native. It is the developer-only demo-user list on the sign-in page.
- **Time fields:** the doctor schedule and branch hours use the browser's time inputs, which show "AM/PM" in the
  browser's language. Replacing them is a bigger change; it is noted for R5.

## Next

- **R5:** a pass over phones, right-to-left, accessibility and performance. It includes the follow-ups table's sideways
  scroll on phones (from R4a) and the time fields above.
