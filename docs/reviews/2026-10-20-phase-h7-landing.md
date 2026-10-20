# Phase H7 review — landing page, pricing and contact form (2026-10-20)

LND-01 (part), LND-02, LND-04: the platform's own page on the root domain, with prices read from the plans and a
contact form for clinics. Built on `v4/phase-h7-landing` (from `main` fea1857). Migration 0033, applied to the dev
database.

## What changed

- **Landing page (`apps/web/app/page.tsx`, root domain only):** Arabic only, built from the clinic-website components
  in the default indigo. Sections: hero, features, the clinic website, pricing, FAQ, contact form, footer with sign-up,
  sign-in and the Terms/Privacy links. «ابدأ مجانًا» opens the dashboard's sign-up form directly (`#/signup`).
  The wording lives in `lib/landing-content.ts`, so it can be edited without touching the layout.
- **Pricing (LND-02):** `GET /public/plans` returns the public plans in the panel's order (cached 5 minutes; the
  page refreshes every 5 minutes). Monthly/yearly switch with the saving, and the limits the system actually enforces
  (branches, doctors, users, patient files, storage) in Arabic. A plan hidden in the panel disappears from the page.
  Plan *features* (custom domain, online payments, remove badge) are not shown: none of them is enforced yet. If the
  API is down, the page still loads and points to the contact form.
- **Contact form (LND-04):** name and mobile required; clinic, city, email, plan of interest, and message optional.
  It goes through the website's same-origin `/api/leads` to `POST /public/leads`. Limits: 5 requests per hour per
  address and 3 per day per phone number. A hidden field catches bots, which get a "sent" reply but nothing is stored.
  The phone is stored in international form. Each request emails every platform admin, but only the clinic's name,
  city and plan go in the email. The person's name and phone stay in the panel.
- **Database (0033):** `leads` gains checks (lengths, phone format), the plan asked about, IP, browser, and who
  changed it last. The API role can add a request but **cannot read them** (they hold a stranger's name and phone).
  The panel reads them through `platform_leads()` and changes the status through `platform_set_lead_status()`. Both
  check the admin, and each status change goes in the platform activity log.
- **Panel tab «طلبات التواصل»:** counts per status, search (name, clinic, city, email, phone in any digits), status
  filter, a table with call/email links, and the status (جديد → تم التواصل → اشتركت / لم تكمل) with who changed it last.

## «اشترك الآن» (added on your request, 2026-10-20)

You chose the landing-page button only (no online payment):

- Each pricing card now has **«اشترك الآن»** (main button), then «جرّبها مجانًا N يومًا», then «أو اطلب اتصالًا».
- «اشترك الآن» opens the dashboard's sign-up with the plan and the monthly/yearly choice, and shows a note on top:
  you chose the plan, create your account and start now, and we will contact you to complete payment and activate.
- On sign-up, the clinic starts on the normal trial and is recorded in «طلبات التواصل» as **طلب اشتراك · سنوي/شهري**,
  linked to the new clinic's page. You get an email titled «طلب اشتراك من عيادة جديدة» with the clinic, plan and
  cycle. From the clinic page you use the existing «تغيير الخطة» and «تفعيل الاشتراك» once paid.
- A problem while recording the request never blocks the sign-up (it is logged).

## Not done (and why)

- **Template gallery:** there is one website template, so a gallery would show a single card. The page has a
  "clinic website" section instead, with a «شاهد موقعًا تجريبيًا» link when `DEMO_SITE_URL` is set (development:
  clinic-a). In production, leave it unset until there is a real sample clinic.
- **Testimonials:** none exist, and none were invented. Add them when real clinics agree to be quoted.
- **Your review of the wording:** the FAQ and feature text describe only what the system does today (e.g. "after the
  trial, contact us to activate; otherwise the clinic is paused and its data kept"). Please read it once. It is all in
  `apps/web/lib/landing-content.ts`.

## Tests (run 2026-10-20)

| Check | Result |
| --- | --- |
| `typecheck`, `lint` (API, dashboard, website), dashboard build, website production build | passed |
| Database tests (`pnpm db:test`) | **530 checks passed** (21 in `31_landing_leads.sql`: a subscription request has a cycle, a call request no cycle and no clinic; the API role adds but never reads, sets the status, changes or deletes a request; phone/name/message checks; only an admin lists them and moves them along; unknown status or request refused; audited) |
| Migration 0033 down and up again on the test database | passed |
| API e2e on a fresh test database | 35 suites, **331 tests passed** (new `landing.e2e-spec.ts`: sign-up from «اشترك الآن» → subscription request with plan, cycle and clinic, the clinic on its trial, admin email without contact details; public plans without internal fields, cached; a hidden plan leaves the page; a request is stored with the phone normalised and the admin email carries no personal details; bad input and the bot field; only the panel reads and moves requests) |
| Dashboard unit | 21 files, **96 passed** (panel route, request search, `#/signup` and `#/signup?plan=&cycle=` links) |
| Website unit | 6 files, **32 passed** (new `landing.test.ts`: the «اشترك الآن» link, prices, yearly saving, Arabic noun forms of the limits, trial in the FAQ, form checks, Arabic messages) |

The API suite has to run on a freshly rebuilt test database (`pnpm db:test` first). A second run on the same
database fails in older suites, because they add data "once". This was already the case before H7.

Not checked in a browser: the extension's browsers cannot reach the local addresses.
