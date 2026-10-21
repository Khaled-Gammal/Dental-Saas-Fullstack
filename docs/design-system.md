# Design system — "Trust blue"

Tokens live in `packages/ui/tokens.css` and are shared by the dashboard (`apps/dashboard`) and the clinic websites (`apps/web`).

| Token | Value | Use |
|---|---|---|
| `--primary-500` | `#1d6fd8` | buttons, active nav, links (4.9:1 on white) |
| `--primary-600` | `#185fba` | text on tinted backgrounds (6.2:1) |
| `--navy-900` | `#0f2f5c` | sidebar, auth panel, headings on the site |
| `--sky-400` | `#5bc0eb` | accents and glows only, never text |
| `--surface` | `#f5f8fc` | page background |
| `--ink` / `--muted` | `#14213d` / `#5b6b82` | body / secondary text (15.0 and 5.4:1) |
| status | success `#0b7a55`, warning `#8a4b0f` on `#fef3e6`, danger `#b42d25` | alerts and badges |

Fonts: Cairo in the dashboard (self-hosted with @fontsource), Tajawal on the clinic websites (next/font, served from the site). Both cover Arabic and Latin in one family; Tajawal has no 600, so semibold renders at 700. Radius 8/12/16/24. All spacing uses logical properties, so RTL and LTR share one stylesheet.

## Rules
- Clinic websites use the clinic's own `theme.primary` as `--brand`; tints (`--brand-50/100/200`) and the dark `--brand-deep` are derived with `color-mix()`. Only `#rrggbb` values are accepted; the default when none is set is indigo `#4f46e5`. The server also sets `--on-brand` (text on the brand colour) and `--brand-text` (the brand colour as text on white), both at least 4.5:1, so any colour a clinic picks stays readable.
- The website's neutrals (ink `#1b1a3a`, muted `#5f5e7d`, surface `#f6f6fb`, lines `#e6e6f0`, indigo-tinted shadows) are scoped to `.site` in `apps/web/app/globals.css`; the dashboard keeps the tokens above. See `docs/reviews/2026-10-16-website-redesign.md` for the full website system.
- Names typed by users are wrapped in `<bdi>` so Arabic names inside English text (and the reverse) render in the right order.
- Phone numbers, emails, slugs and codes are `dir="ltr"`.
- Touch targets are at least 44px; focus is always visible (`--ring`); motion respects `prefers-reduced-motion`.
- Dashboard components: `apps/dashboard/src/ui/components.tsx` (Button, Field, Input, PasswordInput, OtpInput, Alert, Badge, Card, EmptyState, Skeleton). Icons: `ui/icons.tsx`.
- shadcn/ui in the dashboard (`src/components/ui/*`, added with `pnpm dlx shadcn add <name>`): Select, Calendar, Popover, Button so far, used for pickers (`src/components/date-picker.tsx`). Tailwind v4 is loaded **without preflight** from `src/shadcn.css`, and the shadcn colour variables map to the tokens above, so both systems share one palette and the existing stylesheet stays in charge of base styles. **Rule:** `shadcn.css` must never define a variable that `tokens.css` defines (shadcn's `--muted` and `--ring` once overwrote ours and hid every caption and focus ring); point the Tailwind `--color-*` entries at the tokens instead. `__tests__/shadcn-tokens.test.ts` enforces this. Form pickers: `components/choice.tsx` (Select) and `components/date-picker.tsx` (Calendar, with month/year dropdowns for birth dates).

## Shared package `@dental/ui`
| Export | What |
|---|---|
| `tokens.css` | colours, type, radius, shadow, motion, focus rings |
| `arch` | `dentalArch()`, `archGumPath()`, `TOOTH_PATH`, `SPARKLE_PATH` |
| `icons` | `ICON_PATHS` (phone, pin, clock, whatsapp, directions, menu/close, chevron, check, shield, calendar, user, star, and a service-category set keyed by `service_catalog.category`) + `TOOTH_PATH` |
| `text` | `initials`, `pickName`, `toAsciiDigits`, `telHref`, `onColor`, `readableOnWhite` |

Everything except `tokens.css` is pure TypeScript with no React, so the website can render it on the server with zero JavaScript.

## Dental visual language
- **Dental arch** (`packages/ui/arch.ts`): 14 teeth placed mathematically along a horseshoe, shared by both apps. Pure geometry (no React), so the website renders it on the server with zero JavaScript.
  - Dashboard overview: the arch is a progress picture — each setup step fills more teeth, front teeth first ("every step completes your clinic's smile").
  - Clinic website hero (`apps/web/components/site/decor.tsx`, `ToothArt`): one polished tooth on a brand-tinted panel with orbit rings, sparkles and a check badge, with floating chips that show real data only (whether the main branch is open now, the lowest listed price, team and branch counts). The arch itself is no longer used on the website.
- **SmileCanvas** (`apps/dashboard/src/ui/illustrations.tsx`): bubbles, small teeth and sparkles rising on the sign-in panel. About 30 particles, DPR capped at 2, paused when the tab is hidden or the panel is off screen, one still frame under reduced motion. Canvas is used only in the dashboard; the public site stays SVG/CSS for SEO and mobile speed.
- **Smile curves**: tinted sections on the website start and end with a smile-shaped edge; section titles carry a small tooth-and-sparkle ornament.
- All illustrations are decorative (`aria-hidden`), except the overview arch, which has a text label with the progress.
