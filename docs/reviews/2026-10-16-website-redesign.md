# Clinic website redesign — 2026-10-16

Scope: the public clinic website (`apps/web`, route `app/sites/[host]`), the shared icon data in `packages/ui`, and one read-only
extension of `GET /public/site`. The dashboard is untouched.

## Phase 1 — audit of the previous implementation

| # | Area | Problem |
|---|---|---|
| 1 | Hero | Abstract blob + dental arch gave no focal point; two chips overlapped the art; a large empty band under the fold on wide screens. |
| 2 | Booking | Only `tel:` was used although the payload already carried `whatsapp`. No booking action on service or doctor cards, no mobile reach. |
| 3 | Navigation | Links were simply hidden under 720 px — no mobile menu at all. |
| 4 | Services | Same tooth icon for every service; descriptions existed in the database and the dashboard form but never reached the site. |
| 5 | Doctors | Bios and specialties existed but were not served; cards had no action. |
| 6 | Branches | A full seven-row table per branch (repetitive, tall), no "open now", no directions although latitude/longitude were already served. |
| 7 | Time zone | `Africa/Cairo` was hard-coded; `tenants.timezone` and `branches.timezone` were ignored. |
| 8 | Footer | Copyright line only: no contact, no navigation. |
| 9 | SEO | No canonical, no Open Graph, no structured data, static theme colour. |
| 10 | Types | `SiteData` declared fewer fields than the API returned (whatsapp, city, coordinates, `title_en`, specialties). |
| 11 | Palette | The site inherited the dashboard's "trust blue"; the brief asks for a violet/indigo identity for the public site. |

## Phase 2 — design system decisions

- **Brand stays the tenant's.** `theme.primary` is still the single brand input. The site derives `--brand-50/100/200` (tints) and
  `--brand-deep` (a dark mix for the conversion band) with `color-mix()`, plus `--on-brand` / `--brand-text` computed server-side for
  contrast. The **default** when a clinic has not chosen a colour is indigo `#4f46e5` (6.3:1 on white).
- **Site neutrals** are scoped to `.site` in `apps/web/app/globals.css`: ink `#1b1a3a`, muted `#5f5e7d`, surface `#f6f6fb`, lines
  `#e6e6f0`, indigo-tinted shadows, plus two fixed low-intensity washes (lavender `#ede9fe`, soft blue `#dbeafe`) behind the hero only.
  `packages/ui/tokens.css` is unchanged, so the dashboard keeps its own palette.
- **Type**: IBM Plex Sans Arabic (already self-hosted). h1 `clamp(2rem, 1.2rem + 3.2vw, 3.1rem)`, section h2
  `clamp(1.6rem, 1.2rem + 1.6vw, 2.15rem)`, lead `1.05–1.25rem`, body `1rem / 1.7`.
- **Shape**: cards 20 px radius, buttons pill, hero panel 56 px; one-pixel borders with soft shadows; sections `clamp(56px, 7vw, 96px)`.
- **Icons**: one stroke set in `packages/ui/icons.ts` (`ICON_PATHS`), including a service-category set keyed by `service_catalog.category`.
- **Illustration**: `ToothArt` — one polished tooth on a tinted panel with orbit rings, sparkles and a check badge, all SVG, coloured by
  `--brand`. Replaces the arch on the website (the arch stays in the dashboard overview).
- **Motion**: CSS only. Hero float/twinkle, card hover lift, and scroll-entrance via `animation-timeline: view()` behind `@supports`
  (browsers without it show the content statically). Everything is off under `prefers-reduced-motion`.

## Phases 3–5 — what was built

Components in `apps/web/components/site/` (server components unless noted):

| File | Component(s) |
|---|---|
| `header.tsx`, `mobile-nav.tsx` (client) | `ClinicHeader` with sticky bar, section links, primary call CTA; `MobileNav` button + panel (Escape, link click and viewport growth close it). |
| `hero.tsx`, `decor.tsx` | `HeroSection` with specialties chips, call + WhatsApp CTAs, `ToothArt`, floating chips from real data (status of the main branch now, lowest listed price, team/branch counts). |
| `trust.tsx` | `TrustIndicators`: doctor / service / branch counts and "prices listed" when at least one price exists. |
| `services.tsx` | `ServiceCard` / `ServicesSection`: category icon, description, price, duration, booking action naming the service. |
| `doctors.tsx` | `DoctorCard` / `DoctorsSection`: initials avatar (no photo storage exists yet), title, specialties, bio, booking action naming the doctor. |
| `branches.tsx` | `BranchCard` / `BranchesSection`: main-branch badge, address + city, **open/closed now** pill with the next opening, today's hours, collapsible grouped week, call / WhatsApp / directions. |
| `cta.tsx` | `AppointmentCTA` band and `MobileBookingBar` (fixed, phones only). |
| `footer.tsx` | `ClinicFooter`: brand + about, section links, contact, powered-by. |
| `contact.tsx` | `contactFor` / `bookingLink`: the channels a clinic really offers; WhatsApp links carry a prefilled message. |

Logic in `apps/web/lib/`: `hours.ts` (`localNow`, `openStatus`, `groupWeek`; pure, unit-tested) and `site.ts` (types, fetch,
formatting, specialty labels, category → icon).

Booking stays what the platform supports today: a call or a WhatsApp chat. There is no form and nothing claims a confirmed appointment.

### API change (read-only)

`PublicSiteRepository` now also returns `clinic.timezone`, `branches[].whatsapp/timezone/is_main`, `holidays` (−1…+14 days, so
"open now" respects holidays), `services[].description_*` and `category`, `doctors[].bio_*`. No fees, commissions, member ids or files.

### SEO

`generateMetadata`: canonical, Open Graph (`ar_EG`), description from the clinic's about text; `generateViewport`: theme colour =
brand. JSON-LD `Dentist` with name, phone, main-branch address, coordinates and `openingHoursSpecification` — business facts only.

## Phase 6–7 — verification

- Viewed in Chrome at 1536 px, 720 px and 390 px (iframes), RTL. No horizontal overflow at 390 px. Mobile menu, expanded week table,
  conversion band, footer and the sticky booking bar checked. Second tenant (clinic-b, violet brand) checked for colour derivation.
- "Open now" is computed at render time in the branch's zone; ISR caches a page for up to 60 s, so the pill can lag an open/close
  boundary by that much (same as the previous "today's hours" chip).
- `pnpm lint`, `pnpm typecheck` (web and api), `vitest` (12 tests for hours logic), `next build` — results in the PR/commit message.

## Known limits / follow-ups

- The site is Arabic-only (as before). All layout uses logical properties, so an English/LTR variant needs routing and copy, not CSS.
- Doctor photos: `doctors.photo_file_id` exists but there is no upload or file-serving endpoint yet; initials are the placeholder.
- The hero's "specialties" chips use `tenants.specialties`; codes are translated, free text is shown as typed.
- Holidays beyond 14 days are not fetched (they do not affect "open now").

## Second pass (same day) — audit against the brief after online booking landed

Checked live at 1536 px, 820 px, 768 px, 375 px and 360 px (RTL), with clinic A's current brand colour.

| Gap found | Fix |
|---|---|
| A catalogue whose size is not a multiple of the column count left the last row hugging one side, and with flex-grow the lone card became wider than the rest. | `.s-grid` uses a `--cols` column count per breakpoint (3 / 2 / 1; branches 2 / 1) with equal widths and centred rows. Verified: 5 services = 3 + 2, all 360 px, last row centred. |
| No `robots.txt` / `sitemap.xml` (SRS WEB-06; both returned the platform's 404). | `app/robots.ts` and `app/sitemap.ts` read the request's hostname (`lib/host.ts`): a live clinic (or the landing page) is crawlable, `/book` and `/api/` are excluded, and an unknown host gets `Disallow: /` and an empty sitemap. |
| An unknown clinic address showed Next's English "This page could not be found". | `app/sites/[host]/not-found.tsx`: Arabic page (English line underneath), status 404, `noindex`. |
| An API outage showed Next's generic error. | `app/sites/[host]/error.tsx`: Arabic message and a retry button; nothing internal is shown. |
| English city names ("Cairo") inside Arabic addresses were not isolated. | Address and city are separate `<bdi>` runs on branch cards and in the footer. |
| Pages with no clinic (not-found, error) fell back to the dashboard's blue. | The site's CSS default `--brand` is the indigo `DEFAULT_PRIMARY`. |

Known limit: in local development the canonical URL, sitemap and robots `Host` omit the port (`:3000`), because the
site's origin is built from the hostname; real clinic domains have no port.

Checks: web typecheck, lint, 17 unit tests, production build (home page 105 kB first-load JS; `robots.txt` and
`sitemap.xml` are dynamic routes).
