# Phase F1 review — dashboard Arabic only (2026-10-19)

Scope: L10N-001, L10N-002 and part of L10N-008 for the dashboard, with the decisions on CLR-07 and CLR-08. Branch:
`v4/phase-f1-arabic` (on top of E4).

## Decisions recorded

- **CLR-07 and CLR-08 take the proposed defaults**:
  - English content already stored is kept but no longer edited;
  - English shows only where no Arabic exists;
  - Latin digits are used everywhere;
  - times use a 12-hour clock with ص/م.
- **Owner's note:** the product is Arabic in production, but brand and clinic names may be written in English (Latin
  letters).
- **Owner's choice of a "softer first step"** for L10N-008: show Arabic only, and leave the English half of the
  dictionary and the `lang` parameters in the code for a later pass. The bulk removal script was stopped by the
  permission check.

## What changed (dashboard only; no API or database change, no migration)

- **One language:**
  - the language is fixed to Arabic;
  - the language buttons on the sign-in pages and in the top bar are gone;
  - the stored language preference is no longer read, and is cleared from the browser;
  - `index.html` is `lang="ar" dir="rtl"`, and its title is Arabic only.
- **English inputs hidden (CLR-07)** in sign-up, the clinic profile, branch, doctor and service forms, and the
  gallery captions. The forms still carry the stored English values, so saving a form never erases them. Screens
  keep showing Arabic first and English only where there is no Arabic (`pickName('ar', …)`, unchanged).
- **Brand names in Latin letters:**
  - the name fields of clinic, branch, doctor and service use `dir="auto"`, so "Smile Dental" reads correctly;
  - the clinic name has a hint: «بالعربية، أو بالإنجليزية إن كان اسم علامتك التجارية مكتوبًا بها»;
  - the API never rejected Latin letters in names, which was checked.
- **Labels:** labels no longer say «بالعربية» now that there is one field.
- **Guard test** `arabic-only.test.ts`, which fails if any text:
  - has no Arabic version;
  - has an Arabic version not written in Arabic letters;
  - has an Arabic version carrying English words outside an allow-list. The list covers brand and product names
    (InstaPay, WhatsApp, Google Maps), file types, technical tokens (QR, URL, A4, the Enter key) and the slug
    example.
  - On its first run it found the now-unused «English» switch text, which was removed.

## Not done in F1 (next sub-phases)

- **F2:**
  - Arabic for every API error code, with an automated check;
  - Arabic validation messages (Zod);
  - Arabic-only emails;
  - currency on the price list and website;
  - one date and time format (Latin digits, 12-hour ص/م).
- **F3:** the website set to Arabic only (`locales` `{ar}`, CLR-07).
- **F4:** the home screen per role (REPORT-006).
- **Later pass, if you approve it:** removing the unused English dictionary half and the `lang` parameters.
- **Found in the browser:** doctor specialties in the seed are English words (`orthodontics`, `implants`). They are
  data, so nothing was changed. They can be shown with Arabic labels in F2, or replaced by Arabic in the clinic's
  own data.

## Tests (run 2026-10-19)

| Check | Result |
| --- | --- |
| Dashboard unit (vitest) | 15 files, **72 passed** (new `arabic-only.test.ts`: 2) |
| `pnpm typecheck`, `pnpm lint`, dashboard build | passed |
| API / DB | not affected (no API or database change); last run green in E4 and on CI run 39286909563 |
| Browser | signed in with the dev quick sign-in as the demo owner. The sign-in page and the top bar have no language button. The doctor form shows one name and one title field (no English), and the stored values loaded. Nothing was saved |
