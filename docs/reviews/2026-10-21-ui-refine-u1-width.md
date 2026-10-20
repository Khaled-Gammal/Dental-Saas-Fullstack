# UI refinement U1: the page width, settings columns and page headers (2026-10-21)

The brief: refine the dashboard's layout after Untitled UI without redesigning it. Use the screen width, standardize
headers, put listings in tables with a three-dot row menu, and organize create/edit pages. It is done in three
stages, each checked and merged separately:

- **U1 (this one):** brief phases 1–3. The audit, the shared container and the page headers.
- **U2:** phases 4–6. Listings in full-width tables, a consistent three-dot row menu, and reusable parts where they
  pay off.
- **U3:** phase 7. Substantial create/edit forms that still appear inside a listing get their own page, plus a final
  responsive pass.

Built on `v4/ui-refine-u1` from `main` 6b2590c.

## Audit: why the content was narrow

- **One cause:** the shared page container, `.content` in `styles.css`, which wraps every clinic page inside the
  shadcn `SidebarInset`. It had `max-width: 1120px; margin-inline: auto`. Next to a 256 px sidebar, that left about
  300 px empty beside the content on a 1,440 px screen, and about 500 px at 1,920 px.
- **The same cap elsewhere:** `.platform-main` capped the platform panel at 1,200 px.
- **Not causes:** the sidebar is shadcn's own (`SidebarInset` already takes the remaining width, `min-w-0`), there are
  no nested width wrappers, and the page padding was reasonable. Forms are capped on purpose by `.form-page`
  (880 px), which is right for them.

## What changed

- **Full width:**
  - `.content` takes the width beside the sidebar, and follows it when the sidebar collapses. The cap and centring
    are removed, and `min-width: 0` stops wide children from overflowing.
  - The padding is responsive: 16–28 px at the top, 16–32 px at the sides.
  - The platform panel does the same.
- **Settings pages keep a column:** data, booking rules, daily cash, discounts and holidays are settings or one
  workflow. At full width their fields and figures ended up far from their labels (the data page's password field was
  ~1,500 px wide).
  - They get a 960 px column, from one list in `screens/shell.tsx` (`NARROW_PAGES`), not per-page CSS.
  - Create/edit pages keep `.form-page`.
  - Lists, tables, reports and the overview use the full width.
- **Overview cards:** at most three a row (`.home-grid`), so a wide screen never leaves empty columns beside them.
- **Page headers:**
  - The title is a little smaller, so the header is more compact.
  - Six screens that built their own header by hand now use the shared `PageHeader`: branch rooms, doctor time off,
    gallery upload, signing a consent, and the platform panel's clinics, leads, activity, legal and plans pages.
  - `PageHeader`'s title accepts formatted text (a branch or patient name in `<bdi>`).
  - Breadcrumbs stay where they were already useful (sub-pages), and none were added to top-level pages.
- **Booking rules:** a stray box drawn around the form is gone. The browser's default fieldset border was never reset
  (there is no Tailwind preflight), so a plain `fieldset` reset was added; every styled fieldset already set its own
  border. The page's header and cards are also spaced like other pages.

Business logic, API calls, routes, permissions and money are untouched; this stage is layout CSS and headers only.

## Verified (2026-10-21)

| Check | Result |
| --- | --- |
| Typecheck, lint (repo), dashboard production build | passed |
| Dashboard unit tests | 26 files, **118 passed** |
| Screenshots at 1,920 px | 21 pages before/after. Patients and other tables span the width; the overview fills three columns; data, booking, cash, discounts and holidays sit in their column; the doctor form keeps its form width beside the header |
| Screenshots at 1,440 px | patients, booking rules, overview |
| Phone (390 px), 20 pages | none scrolls sideways |

**Not checked by screenshot:** the platform panel, because its sign-in needs an emailed code. Its change is the same
container rule and the shared header.

## Left for U2

- **Patients table on a phone:** it still scrolls sideways inside its frame to reach «حجز موعد». Row buttons move into
  the three-dot menu in U2.
- **Card lists that become tables:** branches, doctors, consent texts, the gallery is visual and stays cards, and the
  appointments day view is a workflow and stays as it is.
