# Clinic website redesign ("arches and shapes") — 2026-11-04

The user asked for a full redesign of the clinic website, "not an enhancement of a section": a more attractive and
current look, drawn with SVG/CSS shapes. Scope: every page under `app/sites/[host]` (home, service page, booking,
the patient's appointment page, not-found and error), then (second request, same day) the platform landing page and
the root not-found page in the same design (Part 2 below). The dashboard is unchanged. No API, database or content
change: the sites show exactly the data they showed before.

## Design direction

- **One input colour, a whole palette.** Each clinic still picks one brand colour. `lib/theme.ts` sends it with two
  server-computed text colours (`--on-brand`, `--brand-text`, now ≥ 5.2:1 on white so it also passes on light tints);
  `app/site.css` mixes tints, shades, a dark "night" shade, and a pastel accent that is the brand hue shifted by −40°
  (relative colour syntax, behind `@supports`; older browsers keep plain tints). Tested with all six dashboard presets
  (blue, teal, mint, navy, violet, pink) and a custom yellow: light brands get dark button text automatically.
- **Shapes.** Arches (hero drawing, doctor portraits, service visual), discs, dot grids, dashed rings, sparkles, a drawn
  neighbourhood map for branches without a photo, a hand-drawn stroke under the clinic name. All SVG or CSS, rendered on
  the server and coloured by CSS classes, so every clinic gets its own version and no image files are needed.
- **Type.** Tajawal kept (the user's choice of 2026-10-21); weight 800 added for display headings only.
- **Layout.** Floating glass header bar; split hero; facts strip over the hero's edge; crossed "tapes" naming the
  services; sections on alternating soft panels with a start-aligned heading and a side line; bento services grid;
  dark closing band overlapping a dark footer with the clinic name set very large.
- **Motion.** Hero entrance (the title animates without fading, so it stays the page's first paint), floating cards,
  rotating "book now" badge, scroll-driven reveals, header lift and the phone booking bar sliding in after the hero, the
  tapes moving only while the page scrolls. All of it is off for `prefers-reduced-motion`; scroll-driven parts are
  behind `@supports` (other browsers show the content still).

## What each part does

| Part | Notes |
|---|---|
| Header (`header.tsx`, `menu.tsx`) | Floating bar; WhatsApp icon and booking button; under 960 px a menu panel (closes on Escape, link, tap outside, resize). `home`/`book` props for sub-pages. |
| Hero (`hero.tsx`, `decor.tsx` `HeroArt`) | Live "open now" pill (computed in the browser, as before), name with the last word underlined, the clinic's own text, booking actions, team faces linking to the doctors. Drawing: brand arch with a glossy tooth; cards with the lowest listed price and the real booking channel; rotating badge linking to the same action. Names over 34 characters get a smaller size. |
| Facts strip (`trust.tsx`) | Same facts as before (counts, "prices listed"), now one card over the hero's edge. |
| Tapes (`band.tsx`) | Service names (else the clinic's specialties), shown with three or more; decorative, hidden from screen readers. |
| Services (`services.tsx`, `lib/display.ts`) | Bento grid: `bentoCells(n)` widens the first card (and the last) so no row has a hole on 3 or 2 columns. Wide cards lay out sideways (container query) with the photo or the category drawn large; narrow cards show the photo as a thumbnail so a row keeps one height. Whole card opens the service page; the booking button sits above it. |
| Doctors (`doctors.tsx`) | Arch portraits (photo, or initials on the brand colour); one or two doctors lay out sideways. |
| Gallery (`gallery.tsx`, `compare.tsx`) | Before/after cases as one picture with a divider to drag or move with the arrow keys (`role="slider"`, Arabic labels; half and half without JavaScript; vertical swipes still scroll). Photos in a bento grid with captions. The consent note is kept. |
| FAQ (`faq.tsx`) | Heading and a "ask us" card beside the list; native `<details>` with a smooth open where supported. |
| Branches (`branches.tsx`) | Photo or drawn map with the live status; today's hours, the grouped week, call / WhatsApp / directions. |
| Closing band, footer (`cta.tsx`, `footer.tsx`) | Band on the brand colour with the main branch's status; dark footer with sections, contacts, the main branch's week and the name as a large wordmark. Logos sit on a white chip there. |
| Service page | Arch visual (photo or category art), price / length / doctors facts, booking and WhatsApp actions, then doctors, cases, questions and other services as cards. The phone bar books this service. |
| Booking and appointment pages | Same wizard logic; classes renamed (`bk-*` → `c-bk-*`, `s-btn` → `c-btn`) and restyled: pill stepper, option cards with a radio dot, date strip, time pills, hold timer, fields, code box. A side card offers the clinic's own channels and address. |

## Files

- New: `app/site.css` (the design system, loaded once in `app/layout.tsx` for clinic sites and the landing page),
  `components/site/{aside,band,compare,menu,decor}.tsx`, `lib/display.ts`, `lib/theme.ts`, `lib/palette.ts`,
  `lib/__tests__/display.test.ts`.
- `app/globals.css` keeps only the base rules (reset, font, focus); every old `s-*` / `bk-*` rule is gone.
- `packages/ui/text.ts`: `readableOnWhite(hex, ink, min = 4.5)` gained the optional `min` (no change for the dashboard).
- `app/layout.tsx`: Tajawal 800 added.

## Verification

- `pnpm typecheck` (5 tasks) passes; web lint passes; web tests 56/56 (6 new for the bento rule, the name split, the
  band repetition and the brand colours). A production build passes (clinic home 108 kB first-load JS, +3 kB), and the
  built CSS keeps the container queries, `:has()`, scroll timelines and the gated relative colours.
- Screenshots (headless Chrome) at 1440 and 390 px of clinic A and B, plus a local mock of the site API with test
  clinics: rich content, every colour preset, a light custom colour, a 57-character name, phone/WhatsApp only, and an
  almost empty clinic. No sideways scroll anywhere; the near-empty clinic shows no empty or broken section.
- Interactions: menu open/close, FAQ, the before/after slider (keys 50→70 %, drag to 80 %), and the booking wizard
  through choose → time → details → code → done, with the hold/details/confirm calls answered by fake data inside the
  browser (nothing written to the dev database).
- An automated pass on home, service, booking and a sparse clinic at both widths: one `h1`, no heading jumps, every image
  with `alt`, every link and button named, no duplicate ids, nothing focusable inside `aria-hidden`.
- After the stylesheet moved to `app/site.css` (Part 2), the clinic pages were captured again: 10 captures (5 pages ×
  2 widths) pixel-identical to before the move.

## Known limits / follow-ups

- The demo clinics' photos are placeholders ("Reception", product screenshots); real clinic photos will carry the
  gallery, the branch cards and the wide service cards.
- The lightbox for gallery photos and the homepage banners stay in the content roadmap (phases 4 and 5).
- `apps/dashboard/src/import-model.ts` has a lint error (irregular whitespace) from commit 5df4dad; not touched here.
- The dashboard's small "معاينة" brand preview still shows the old style of hero; it only previews the colour.

## Part 2 — the platform landing page in the same design (same day)

The user asked for the landing page to match, with a creative main view, explanation and subscription section. The
wording stays in `lib/landing-content.ts` (only what the system does; no testimonials or figures).

| Section | What it is |
|---|---|
| Header | The clinic sites' floating bar: section links, «دخول», «ابدأ مجانًا»; under 960 px the menu holds both. |
| Hero (`components/landing/stage.tsx`) | The title with «في مكان واحد» underlined. Beside it, a drawing of the product: the dashboard's day calendar, a phone showing a clinic website in its own colour, and a dashed arrow carrying the booking from the phone's button into the calendar (a «جديد» slot), with a "new booking" card. HTML/SVG in container units; decoration only. |
| Facts | Arabic throughout, in the browser, staff permissions, and the trial length from the plans (left out without a trial). One per row on phones. |
| Tapes | The modules' names, as on the clinic sites. |
| How it works (`journey.tsx`) | Four arch badges on a dashed wave: sign up, add services and team, the website is ready, receive bookings. Vertical on phones. |
| Modules (`features.tsx`) | A bento of the six modules, each with a small drawing: a week with appointment states, the dental chart (shared `dentalArch` geometry), plan stages, an invoice paid in instalments, report bars that grow on scroll, role switches. |
| Website (`site-demo.tsx`) | A clinic website in miniature that recolours live from the dashboard's six colours (same contrast rules as real sites; a radio group with arrow keys). |
| Subscription (`pricing.tsx`) | Plans as passes: arched top with the price, a perforated tear line, an icon per limit. Sliding monthly/yearly switch; the price replays its entrance when switched; yearly shows the monthly equivalent and the saving. «اشترك الآن» still opens sign-up with `?plan=&cycle=`. Under the plans, "how subscribing works": choose a plan → we contact you about payment → we activate it (the 2026-10-20 decision: no online payment). |
| FAQ | The clinic sites' layout (`FaqLayout`), with a "request a call" card. |
| Contact | A split card: a dark side with what the call covers, and the same form (logic unchanged) restyled with the site's fields. |
| Closing band, footer | Brand band with the trial; dark footer (page, account, documents) with the platform name as a wordmark. Phones get a bottom bar: «ابدأ مجانًا» and a call button. |

Checks: typecheck, lint, 60 tests (4 new on the landing wording: the trial only when offered, no online payment
promised, the demo's colours equal the dashboard's), production build (landing 113 kB first-load JS, was 110 kB),
screenshots at 1440 and 390 px, and flows: switching to yearly updates prices, savings and the subscribe link's cycle;
the colour demo works by click and arrow keys; «أو اطلب اتصالًا» preselects the plan in the form; an empty send shows
both errors and focuses the first field; the phone menu opens and closes on Escape. Accessibility pass on the landing
at both widths and on the root 404.
