# Phase F3 review — the clinic websites in Arabic only (2026-10-19)

Scope: the website parts of L10N-001, L10N-005 and L10N-006, and design item F-01 (CLR-07). Branch:
`v4/phase-f3-website` (on top of F2).

## What changed

- **Database (migration 0027):**
  - `sites.locales` now defaults to `{ar}`, and existing sites are set to `{ar}`;
  - nothing reads the column, so no behaviour changes. The column, its CHECK and all English values stay;
  - the down migration restores the default and notes how to restore the old values. It was run on the test
    database (rollback, then up) and **applied to your dev database**.
- **API:** the public site payload now includes the clinic `currency`.
- **Website:**
  - **prices** (services, the "from" price in the hero, the booking wizard) use the clinic currency, with Latin
    digits. Before, they used `ar-EG` with Arabic-Indic digits and always EGP;
  - **times** (opening hours, "open now until", "opens at", and booking slots and summaries) use a 12-hour clock with
    ص/م and Latin digits. The structured SEO data keeps 24-hour times, as schema.org requires;
  - **booking errors:** an unknown error code now shows a plain Arabic message, never the server's English `detail`;
  - **English text removed:** the second line of the 404 page; the platform page's English description, heading and
    dashboard link; the site metadata. Clinic names like «Smile Dental Clinic» are data and stay as typed.
- **Shared helpers** in `@dental/ui/text`, used by both apps: `clock12`, `formatMoney` and `specialtyLabel` (the last
  one moved there in F2).

## Problem I caused, and how to fix it

The website dev server on port 3000 returns **"Internal Server Error"**. In F2 I ran `pnpm build`, and its `next
build` wrote production files into `apps/web/.next`, the same folder your running dev server uses (`BUILD_ID`,
`export/`, `required-server-files.json`, all at 20:02). The E4 build had collided the same way.

- **Fix:** stop the website dev server, delete `apps/web/.next` (it is only a build cache), and start it again with
  `pnpm --filter @dental/web dev`.
- I have not done this myself because the server is your process.
- From now on I build the website only in CI, or only when the dev server is stopped.

## Tests (run 2026-10-19)

| Check | Result |
| --- | --- |
| `pnpm --filter @dental/db test` | 27 files, **431 checks passed**. New `26_arabic_sites.sql`: every site is `{ar}`, new sites start `{ar}`, the CHECK still refuses unknown languages |
| API (`pnpm --filter @dental/api test`) | **30 suites, 288 tests passed** |
| Website unit | **23 passed**. New `arabic.test.ts`: `clock12` (midnight, noon), `formatMoney` (EGP, SAR, no Arabic-Indic digits), price ranges, every booking message in Arabic |
| Website typecheck | passed |
| Dashboard unit, typecheck, lint | 75 passed; passed |
| Website production build | not run locally (see above); CI runs it |
| Browser | not possible: the website dev server is down (see above). It needs a check after the restart |
