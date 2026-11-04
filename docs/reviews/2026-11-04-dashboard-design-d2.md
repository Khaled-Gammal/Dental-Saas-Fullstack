# Dashboard in the websites' design — stage D2, page signatures (2026-11-04)

After D1 (the foundation, commit 3167dc1 on `v4/dashboard-design`; review 2026-11-04-dashboard-design-d1.md), the
user said "ok" to D2. No API, database or behaviour change; the overview keeps the simple layout the user chose
(four figure cards, one chart, one table).

## What changed

| Area | Change |
|---|---|
| Overview | The greeting's name carries the websites' hand-drawn stroke (`Swash`, ui/arch-art.tsx). Figure cards: the icon in a tinted tile that fills with the colour on hover, bolder figures, the websites' lift on hover. The trend chart draws its two lines over soft fills of their colours (recharts `AreaChart`; same data, tooltip, legend and screen-reader table). The attention strip is rounder. |
| Calendar | Rounder, softer blocks. A block now fits its appointment's length (a size container query on the slot): no room for three lines drops the service line; shorter still, time and name share one line, so nothing is cut (30-minute appointments used to show clipped text). The last slate greys (column count, off-hours stripes, completed blocks) follow the theme. |
| Clinic profile | The website preview is the new website's first screen in miniature: floating bar, the name with its last word underlined, the button, and the arch drawing, in the colour being picked before it is saved. `theme.css` now declares its derived colours for `:root, .theme-scope` (no duplication), and the preview sets its own three values with the same `brandVars()`; buttons follow the websites' rule (the colour itself, dark text on a light one). |
| Shared | `splitLastWord` (the name before its last word) moved to `@dental/ui/text`, used by the website's hero and the dashboard's preview; the website re-exports it from lib/display.ts. `ArchArt` takes an `id` prefix for its gradients, like the website's hero drawing. |

## Verification

- Dashboard: typecheck, lint, 187 tests, production build. Website: typecheck, 60 tests (the name split through the
  re-export), the live hero still renders its underline.
- Screenshots: overview at 1440 px; the calendar by doctor and by week on a day with appointments (2026-10-20); the
  clinic profile at 1440 and 390 px, and with an unsaved yellow picked (the preview turns yellow with dark button text
  and the light-colour note, the dashboard stays in the saved colour; nothing was saved).
- Not screenshotted: the platform panel's pages (they need the admin's password and an email code); they use the same
  tokens and shared parts as the clinic dashboard.

## Next (proposed)

- **D3 — polish:** phone details across the remaining screens, print checks for the invoice, receipt, prescription
  and reports, motion review.
