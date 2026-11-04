# Dashboard in the websites' design — stage D1, foundation (2026-11-04)

The user asked for the clinic websites' design ("arches and shapes", review 2026-11-04-clinic-website-redesign.md) in
the dashboard, done cleanly. Decision (asked, 2026-11-04): **the dashboard takes each clinic's own website colour**;
sign-in and the platform panel use the platform indigo `#4f46e5` (the websites' default). The fonts stay as the user
chose on 2026-10-21 (Cairo here, Tajawal on the websites). Staged like the earlier redesigns; this is D1. No API,
database or behaviour change.

## How the colour works

- `theme-model.ts` `brandVars(colour)` (pure, unit-tested) turns the clinic colour into three values: `--brand` (the
  colour, for shapes and glows), `--brand-fill` (darkened only as far as white text needs, ≥ 4.5:1: buttons, active
  states) and `--brand-text` (≥ 5.2:1 on white, so it also reads on the tints). Anything but `#rrggbb` falls back to
  the platform colour.
- `hooks/use-brand-theme.ts` sets them on `<html>` from the clinic profile (`brandColor`), so dialogs and menus (which
  open outside the app's tree) follow too. While the profile loads it uses the colour this browser last saw for the
  clinic (localStorage, a convenience only), so the page does not flash from indigo. It also colours the phone's
  browser bar (`meta theme-color`). Unmounting restores the platform colour.
- `theme.css` mixes everything else from the three values (`color-mix` in oklab): tints `--b-50…300`, night shades,
  brand-tinted neutrals and shadows, and a pastel neighbour of the hue for shapes (relative colours behind
  `@supports`). The shared token names (`--primary-50…700`, `--surface`, `--line`, `--ink`, `--muted`, radii…) keep
  their meaning, so every screen follows without per-screen edits. Status colours are unchanged.
- A name clash was avoided: shadcn already defines `--accent`, so the pastel is `--pastel*`.

## What changed

| Area | Change |
|---|---|
| Shell (`ui/app-chrome.tsx`, new) | Shared by the clinic dashboard and the platform panel: the floating glass top bar (the websites' header), the night sidebar's brand block and identity rows, and the nav-link class (the current page filled with the colour). The two shells no longer duplicate this markup. |
| Sidebar (`shadcn.css`) | A night panel in the clinic's colour with a glow at the top (shadcn's own `--sidebar-*` variables). |
| Page background | Two soft glows at the top of every page, as behind the websites' hero. |
| Buttons, fields | Pill buttons with the websites' soft lift; fields softly filled, white on focus; shadcn `Button` rounded to match. |
| Cards, tables, tabs | 22px cards; tables as a rounded card with a tinted head and rows lit in the colour; the tab tracks as pills with the current tab filled (the websites' booking steps). |
| Dialogs, menus | `--radius` 1rem (menus 14px, items 12px), dialogs 24px over an overlay tinted with the night colour. |
| Empty states, form icons | Arch-shaped tiles (the websites' motif). |
| Sign-in (`ui/arch-art.tsx`, new) | A night panel with the websites' arch-and-tooth drawing and glass feature rows beside the form. The old canvas and arch illustrations (`ui/illustrations.tsx`) were removed with their CSS. |
| Shared geometry | The websites' glossy molar moved to `@dental/ui/arch` (`MOLAR_PATH`); the website imports it (renders unchanged). |
| Sticky parts | The patient record's tabs and the form side column start below the floating bar (`--topbar-offset`). |
| Small | Cairo 800 for titles; `index.html` theme colour and the crash screen's fallback colour moved to the platform indigo. |

## Verification

- Dashboard: typecheck, lint, 187 tests (3 new: readable fill and text for the six profile colours and a light
  yellow; a colour that already reads is kept; bad values fall back), production build (the built CSS keeps the
  `color-mix` tints and the `@supports`-gated relative colours).
- Screenshots at 1440 and 390 px: overview, patients, appointments, invoices, new appointment, clinic profile,
  services, a patient record scrolled (tabs under the bar), the row menu, a dialog, the phone's sidebar sheet, and the
  sign-in screen; plus the same screens with a light colour (mint `#12b5a0`) applied: the fill darkens to `#13817d`
  for white text, the rest follows.
- Website: typecheck, lint, 60 tests; the landing page is pixel-identical apart from 2 pixels of rendering noise; a
  clinic's service page is pixel-identical at 390 px (at 1440 only image/gradient rasterisation noise).
- `api-error-codes.test.ts` once timed out (11.8 s) in a full run while the machine was busy; it scans the API source
  and passes alone (18 ms) and in a rerun of the full suite. Not related to this change.

## Next stages (proposed)

- **D2 — page signatures:** the overview's figure cards and chart in the new style (keeping the simple layout the user
  chose: four cards, one chart, one table), calendar blocks, the clinic profile's website preview drawn like the new
  website, the platform panel's pages.
- **D3 — polish:** phone details, motion, print checks across the reports and invoices.
