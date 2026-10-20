# Dashboard redesign — R1: theme, shadcn Sidebar, app shell (2026-10-20)

The owner asked for a full redesign of the clinic dashboard (modern healthcare look, shadcn/ui architecture, grouped
collapsible navigation, shared page/table/form patterns), done in stages: R1 theme + sidebar + layout first. Built on
`v4/redesign-r1-shell` from `main` cce315a.

The four screenshots supplied ("Untitled UI": Olivia Rhye, Caitlyn King) are not of this dashboard; they were used as
a style reference only (light sidebar, white cards on light grey, clean tables, page header with actions).

## Audit (what the dashboard is today)

- **Stack:** React 19 + Vite 6, TypeScript, TanStack Query, a hash router (`#/patients/<id>/view`), Arabic only
  (`dir="rtl"`). Tailwind CSS v4 through `@tailwindcss/vite`, **without Tailwind's base reset (preflight)**.
- **Two styling systems:** almost every screen uses a hand-written stylesheet (`styles.css`, ~730 lines: `.card`,
  `.btn`, `.badge`, `.page-head`, …) over shared design tokens (`packages/ui/tokens.css`, also used by the public clinic
  websites). shadcn/ui was set up (`components.json`, new-york, CSS variables) with four components only: button,
  calendar, popover, select (used by `Choice` and `DatePicker`).
- **Shell:** a hand-made dark-navy sidebar with 19 flat links (scrolls on a laptop screen), a drawer under 960px, no
  collapse, no grouping.
- **Hidden problem found:** with no preflight, shadcn's `border` classes drew no border and `dark:` classes followed the
  computer's dark-mode setting (the select and button would turn dark on a dark-mode PC). Both fixed (below).
- **Shared pieces already present** (to build on in R2, not duplicate): `ui/components.tsx` (Button, Card, Field,
  Input, Badge, Alert, EmptyState, Skeleton, ErrorText, Switch…), `ui/page.tsx` (FormPage, Breadcrumbs, ResourceState,
  RouteLink), `ui/confirm-dialog.tsx`, `Choice` (shadcn Select), `DatePicker` (shadcn Calendar + Popover), the
  report tables + CSV export, `useLeave`/`useUnsavedChanges`/`useFlash`. No table library; no form library (forms are
  React state + small validators per module).
- **Permissions:** `access.ts` decides which pages a member sees (menu and router); the API checks every request.

## R1 — what changed

- **Theme** (`src/theme.css`, the dashboard only; the clinic websites keep their look): the healthcare palette on the
  existing token names, so every screen changes at once. Brand cyan `#0891B2` is the accent (focus ring, active marker,
  logo); **filled buttons and links use `#0E7490`** (and `#155E75` on hover) because white text on `#0891B2` is only
  3.7:1 (WCAG AA needs 4.5:1). Background `#F8FAFC`, cards white, text `#0F172A`, secondary `#64748B`, borders
  `#E2E8F0`. Status colours use their text-safe shades (green `#15803D`, amber `#B45309` for text, red `#DC2626`).
  Contrast of each pairing is noted in the file. The deep panels (sign-in side, overview welcome card) became deep teal.
- **shadcn/ui Sidebar** added with the project's CLI (`shadcn add sidebar collapsible dropdown-menu breadcrumb`):
  sidebar, sheet, tooltip, separator, input, skeleton, collapsible, dropdown-menu, breadcrumb, `use-mobile`. The CLI's
  offer to overwrite the existing `button.tsx` was declined. One package added: `tw-animate-css` 1.4.0 (CSS only, the
  open/close animations shadcn's sheet, menu and tooltip use; the CLI referenced it but did not install it).
  One project change inside `sidebar.tsx`: tooltips open towards the page in right-to-left.
- **shadcn base styles, scoped** (`shadcn.css`): since preflight is not loaded, a small base layer gives the shadcn
  parts (and only them, the sidebar and pop-ups; never the pages) proper borders, no list bullets, clean buttons and
  links. `dark:` styles now apply only under a `.dark` class (the dashboard has no dark mode).
- **New shell** (`screens/shell.tsx`): `SidebarProvider` + `Sidebar side="right" collapsible="icon"` + `SidebarInset`.
  - Desktop: expanded, or icons only (toggle in the header, `Ctrl/⌘+B`, or the rail); tooltips on icons; the choice
    is remembered across reloads. Tablets (< 1024px) start with icons only. Phones (< 768px): a sheet from the right.
  - Navigation in groups (`nav.ts`, one configuration): the daily links on top (overview, appointments, patients,
    follow-ups), then «العيادة», «المالية», «الموقع الإلكتروني», «الفريق والصلاحيات» as folding groups. The group of
    the current page opens by itself (also after a reload or the back button); pages without their own item light
    their parent (a visit → patients, a payment → invoices, holidays/booking → branches); what you open or fold is
    remembered in this browser.
  - Members see only what they may open (same `access.ts` rule as before; the API still checks every request).
  - The foot: «بيانات العيادة» (owner only) and the user menu (name, email, sign out).
  - The header: the sidebar toggle, the clinic name, the trial badge.
- Removed: the old shell's CSS (no remaining users, checked).

## Verified (2026-10-20)

| Check | Result |
| --- | --- |
| Typecheck, lint (whole repo), dashboard production build | passed |
| Dashboard unit tests | 24 files, **111 passed** (new `nav.test.ts`: menu pages are real routes, no duplicates; owner sees all groups; a receptionist's menu exactly; empty groups dropped; the "soon" item; parent pages and the group that opens) |
| Screenshots through headless Chrome (desktop 1440, tablet 820, phone 390) | expanded and icon-only sidebar, active item and auto-opened group, phone sheet, user menu, receptionist's shorter menu; no horizontal overflow reported. The select's border now shows (was missing) |

API and database were not changed in R1.

## Known, left for the next stages

- The invoice/appointment tab bars underline their labels (already so before R1) → R2, with shadcn Tabs.
- The overview's welcome card squeezes on tablets with the sidebar expanded → R3.
- Page headers and breadcrumbs are still per screen → R2.

## Plan for the next stages

- **R2 — shared patterns:** page header with breadcrumbs and actions in one component; a DataTable (sorting, search,
  pagination; server-side where the API pages already); status badges; tabs; confirm dialogs on AlertDialog; form
  sections. Built on what exists (`ui/components`, `ui/page`), no second form library.
- **R3 — two very different pages first:** patients and invoices, to prove the patterns before spreading them.
- **R4 — the rest of the modules**, keeping every API and business rule (money calculations untouched).
- **R5 — mobile, RTL, permissions, accessibility, performance, production build.**
