# Software Requirements Specification — Dental Clinic SaaS

Version 4.0 · 2026-10-17 · supersedes v3 of 2026-10-14 (`Dental Clinic SaaS — SRS & Database Schema`, by @Bronto24
Academy), which is preserved **word for word** in Part A.

| Document | Role |
| --- | --- |
| `docs/SRS.md` (this file) | What the system must do. Requirement IDs are stable and never reused |
| `docs/implementation-status.md` | Where each requirement stands, with evidence. **If a status here and there differ, the tracker wins**; both are updated at the end of every phase |
| `docs/implementation-audit.md` | The 2026-10-17 audit the status values come from |
| `docs/database-design.md` | Current schema, security model, and the proposed schema changes per requirement |
| `docs/roadmap.md` | Phase plan and deferred features |

---

## 0. How to read this document

### 0.1 Parts

| Part | Content | Rule |
| --- | --- | --- |
| **A. Existing requirements** | The v3 SRS, unchanged (only its heading levels moved down one step to fit under Part A) | Never edited. Where a later decision changes an A requirement, §A.0 records it as *superseded*, *refined*, *deviation* or *deferred*, and Part B holds the new text |
| **B. Approved new requirements** | Requirements introduced by the 2026-10-17 brief and the Arabic-only requirement | Approved for implementation. A rule that still needs a business decision says so and points to Part C |
| **C. Requirements needing clarification** | Business decisions not yet made, each with a proposed default | Nothing in Part C is built until it is answered |
| **D. Deferred requirements** | Features intentionally postponed | Listed with the reason; detail in `docs/roadmap.md` |

### 0.2 Requirement IDs

- Part A IDs keep their original two-digit form (`AUTH-04`, `DSH-07`, `NFR-10`).
- Part B IDs have three digits. New families start at `001` (`PAY-001`). A family that already exists in Part A
  continues at `101` (`AUTH-101`), so `AUTH-01` and `AUTH-101` can never be confused.
- An ID is never renumbered or reused. A dropped requirement keeps its ID with status `WITHDRAWN`.

### 0.3 Status values

`IMPLEMENTED` · `PARTIALLY_IMPLEMENTED` · `NOT_IMPLEMENTED` · `NEEDS_VERIFICATION` · `BLOCKED` (waits for a decision
or dependency) · `SUPERSEDED` (replaced by the Part B requirement named) · `DEFERRED` (postponed; see Part D).
"DB only" means the database tables, constraints and triggers exist and are tested, but no API or screen uses them.

### 0.4 Language

This document and all code identifiers are in English. **The product is Arabic only** (L10N-001): every screen,
message, email and printout is in Arabic and right-to-left. Database columns such as `name_en` stay as they are
(no renaming of tables, columns, enums or API routes to translate them).

### 0.5 Decisions taken

| Date | Decision | Effect |
| --- | --- | --- |
| 2026-10-16 | Email is the only notification channel for now (booking codes, confirmations, reminders) | BOOK-03/BOOK-07 deviation recorded in §A.0 |
| 2026-10-17 | The product is Arabic only; no English localization, now or as a future feature | L10N-001…008; supersedes the bilingual parts of LND-01, WEB-04, NFR-09, NTF-02, DSH-16 and §7.1 item 6 |
| 2026-10-17 | **D-01: sign-up verifies the owner by email code; no SMS for now** | AUTH-101; AUTH-02 (phone OTP) superseded for sign-up; AUTH-06 and AUTH-08 use email only |
| 2026-10-17 | No WhatsApp, SMS, paid messaging, payment gateways or other paid external services in this phase | Part D |
| 2026-10-17 | CLR-05 default accepted (refunds: owner + accountant; reception reverses its own same-day entry; refund method recorded, may differ) | B.1, PAY-003, PAY-005 |
| 2026-10-17 | Proposed defaults accepted for CLR-02, CLR-03, CLR-04, CLR-09, CLR-12, CLR-17 ("implement what you recommend") (Part C) | DISC-002/003, EXP-003, CASH-*, L10N-005, PAY-006, BILLING-004 |
| 2026-10-17 | Proposed defaults accepted for CLR-06, CLR-10, CLR-11, CLR-13, CLR-14, CLR-15, CLR-16 (Part C) | VISIT-002, APPT-004, TPLAN-002, roadmap, Part D, PATIENT-003, VISIT-003 |
| 2026-10-19 | Proposed defaults accepted for CLR-07 and CLR-08. Added by the owner: the product is Arabic in production, but **brand and clinic names may be written in English (Latin letters)**; Latin digits are fine | L10N-001 (names are on the allow-list), L10N-006, L10N-007, L10N-008 |
| 2026-10-20 | Owner: expenses are seen and recorded by the owner and the accountant only; reception handles bookings, patients and patient payments (it keeps the cash box, CLR-04). Replaces the reception part of CLR-03 | EXP-001/003, B.1, migration 0029 |
| 2026-10-20 | Owner asked for CSV export of the reports (was deferred as "Excel export") | DSH-11 (part), L10N-007; H3 |
| 2026-10-20 | Owner: no fixed roles but the owner. Sign-up creates the owner role only (every permission); the owner creates, changes and deletes every other role and its permissions. `staff:manage` may be given to a role (with anti-escalation guards); mixing clinical and money writing only warns. The B.1 role columns become starting suggestions, no longer created at sign-up | ACCESS-006, B.1, AUTH-03; H4 |

---

## 1. Scope of version 4

Version 3 described the whole platform. Version 4 adds the clinic's daily operating workflow and the
Egypt-focused financial features, and makes the product Arabic only:

1. **Clinic workflow** — setup → branches → staff and doctors → services and prices → booking → check-in →
   clinical visit → dental chart and treatment plan → procedures → invoice → payments → follow-up.
2. **Financial features** — payment methods (cash, bank transfer, card, electronic wallet, InstaPay), partial
   payments and installments, refunds, discounts with approval, clinic expenses, daily cash reconciliation.
   This is **recording** money, not taking it: no gateway, bank or wallet integration.
3. **Treatment plan tracking** — planned vs. performed procedures, estimates, remaining work, balance, next visit.
4. **Arabic-only, RTL experience**, Egyptian conventions, configurable currency (default Egyptian pound).
5. **Security and integrity fixes** found by the audit (branch access, immutable money, cross-record consistency,
   audit trails).

Out of scope for v4: Part D.

---

## 2. Roles

The roles of §2.1 (Part A) are unchanged. In v4 their daily work is:

| Role | Daily work in v4 | Never |
| --- | --- | --- |
| Receptionist | Find or register a patient, book/reschedule/cancel, check in, run the waiting list, take payments, see balances, open/close the cash box (pending CLR-04) | Clinical notes, chart, medical history writes; discounts above their limit; refunds (pending CLR-05) |
| Doctor | Own day list, patient history, chief complaint, allergies/medications, chart, treatment plans, procedures, notes, prescriptions, follow-up | Recording payments, discounts, expenses, cash |
| Accountant | Invoices, payments, refunds, installments, expenses, cash reconciliation, financial reports | Clinical records |
| Owner / manager | Everything; approves discounts, expenses and reopened cash days; reports for every branch | — |
| Assistant | Appointment status, reads patients (unchanged from §2.2) | Financial and clinical writes |

**Clinical and financial permissions are separate** (ACCESS-004): no permission grants both, and the seeded
doctor role holds no payment-writing permission, the accountant role no clinical permission.

---

## 3. End-to-end user journey

Each step lists the requirements that deliver it. Status per step is in `docs/implementation-status.md`.

| # | Step | Who | What happens | Requirements |
| --- | --- | --- | --- | --- |
| 1 | Sign up | Owner | Account + clinic created in one step; email code confirms the owner | AUTH-01, AUTH-03, AUTH-101 |
| 2 | Clinic setup | Owner | Name, logo, phones, WhatsApp number (display only), currency, brand colour | ONB step 1, L10N-005 |
| 3 | Branch setup | Owner | Branches, weekly hours with breaks, holidays, rooms/chairs | ONB step 2, APPT-005, APPT-006 |
| 4 | Staff and doctor setup | Owner | Doctors with branches and schedules, time off; staff invited by email with a role and branches | ONB step 3, ACCESS-001…003, APPT-005 |
| 5 | Services and pricing | Owner | Catalogue or custom services, price, duration, doctors | ONB step 4 |
| 6 | Booking | Patient (website) / Receptionist | Website booking with email code; staff booking, reschedule, cancel | BOOK-01…11, APPT-001, APPT-002 |
| 7 | Check-in | Receptionist | Booking code / QR / manual with reason; patient joins the waiting list | §4.10, APPT-003 |
| 8 | Clinical visit | Doctor | Opens the visit from the waiting list, reviews allergies and medications, records chief complaint, diagnosis and notes, finalizes | VISIT-001, VISIT-002, PATIENT-005 |
| 9 | Dental chart and treatment plan | Doctor | Charts teeth and surfaces; builds or updates a plan with estimates; patient acceptance recorded | CHART-001, TPLAN-001…004 |
| 10 | Procedures | Doctor | Records what was done, linked to plan items where they exist | VISIT-003, TPLAN-003 |
| 11 | Prescription | Doctor | Arabic printable prescription | VISIT-004 |
| 12 | Invoice | Receptionist / Accountant | Invoice from the visit's procedures (or services for walk-ins), discounts, issue | BILLING-001…005, DISC-001…003 |
| 13 | Payments | Receptionist / Accountant | Full or partial payment by any method, installment plan, receipt; refunds | PAY-001…006 |
| 14 | Follow-up | Doctor / Receptionist | Next visit booked or added to the follow-up list | APPT-007, VISIT-005 |
| 15 | Expenses and cash | Accountant / Receptionist | Daily expenses; cash box opened and closed with counted cash | EXP-001…004, CASH-001…004 |
| 16 | Reporting | Owner | Revenue, collections by method, expenses, attendance, balances, branch and doctor figures | REPORT-001…006 |

---

## Part A — Existing requirements

### A.0 Status and changes to the original requirements

The original text follows in A.1 unchanged. This table is the only place where its requirements are annotated.

| ID | Pri. | Status | Change / note |
| --- | --- | --- | --- |
| LND-01 | M | NOT_IMPLEMENTED | Only a development placeholder page exists. *Bilingual* superseded by L10N-001 (Arabic only) |
| LND-02 | M | NOT_IMPLEMENTED | — |
| LND-03 | V1 | NOT_IMPLEMENTED | — |
| LND-04 | M | NOT_IMPLEMENTED | `leads` table and insert grant only |
| LND-05 | V1 | NOT_IMPLEMENTED | — |
| AUTH-01 | M | PARTIALLY_IMPLEMENTED | Terms acceptance is not recorded |
| AUTH-02 | M | SUPERSEDED (sign-up) by AUTH-101 | D-01: email code at sign-up, no SMS. The existing phone OTP code path stays in the code base but is not used for sign-up |
| AUTH-03 | M | IMPLEMENTED | — |
| AUTH-04 | M / V1 | IMPLEMENTED (M) | Google sign-in (V1) deferred. Deviation: scrypt instead of argon2id (see NFR-02) |
| AUTH-05 | M | IMPLEMENTED | — |
| AUTH-06 | M | NOT_IMPLEMENTED | Refined: email only (D-01). Detailed in AUTH-102 |
| AUTH-07 | V1 | DEFERRED | — |
| AUTH-08 | M | NOT_IMPLEMENTED | Refined: email only; detailed in ACCESS-001 |
| AUTH-09 | M | IMPLEMENTED | — |
| ONB-01 | M | PARTIALLY_IMPLEMENTED | Steps 1–4 and 6 exist as setup screens + checklist; step 5 (template, fonts, sections) not built |
| ONB-02 | M | PARTIALLY_IMPLEMENTED | Checklist on the home screen exists |
| ONB-03 | V1 | DEFERRED | — |
| WEB-01 | M | PARTIALLY_IMPLEMENTED | One template with fixed sections |
| WEB-02 | M | PARTIALLY_IMPLEMENTED | Colour and logo only |
| WEB-03 | M | IMPLEMENTED | — |
| WEB-04 | M | SUPERSEDED by L10N-001 | Site is Arabic only and RTL; no language switcher |
| WEB-05 | M | PARTIALLY_IMPLEMENTED | Draft/publish covers the theme only |
| WEB-06 | M | PARTIALLY_IMPLEMENTED | sitemap.xml and robots.txt per clinic; no per-page SEO fields |
| WEB-07 … WEB-09 | V1 | DEFERRED | — |
| WEB-10 | M | PARTIALLY_IMPLEMENTED | Badge shown; removal by plan not built |
| BOOK-01, 02, 05, 10, 11 | M | IMPLEMENTED | — |
| BOOK-03 | M | IMPLEMENTED (deviation) | Verification code goes by **email**, not phone (decision of 2026-10-16) |
| BOOK-04 | M / V1 | PARTIALLY_IMPLEMENTED | Pay at clinic only; online payment deferred (Part D) |
| BOOK-06 | M | IMPLEMENTED | Setting exists; no screen to change it (APPT-009) |
| BOOK-07 | M | IMPLEMENTED (deviation) | Email only; reminders at 24 h and 2 h. Bilingual email bodies to become Arabic only (L10N-004) |
| BOOK-08 | V1 | DEFERRED | — |
| BOOK-09 | M | IMPLEMENTED (doctor) / PARTIALLY (room) | Room exclusion exists but rooms cannot be assigned yet (APPT-006) |
| BOOK-12 | V2 | DEFERRED | — |
| DSH-01 | M | PARTIALLY_IMPLEMENTED | Setup progress only; refined by REPORT-006 |
| DSH-02 | M | PARTIALLY_IMPLEMENTED | Day list per branch; no week view, per-doctor/chair columns or drag-reschedule. Refined by APPT-001…004 |
| DSH-03 | M | IMPLEMENTED (2026-10-17, D5) | Profile, contacts, file no., tags, guardian, opt-in, medical history and its versions, X-rays and documents, clinical timeline (D4), merge (D5). Refined by PATIENT-001…005 |
| DSH-04 | V1 | IMPLEMENTED (2026-10-17, D4) | Brought into v4: CHART-001 |
| DSH-05 | V1 | PARTIALLY_IMPLEMENTED | Brought into v4: TPLAN-001…004 (D4); converting steps to invoice items comes with billing (Phase E) |
| DSH-06 | M | IMPLEMENTED (2026-10-17, D4) | Refined by VISIT-001…005 |
| DSH-07 | M | NOT_IMPLEMENTED (DB only) | Refined by BILLING-*, PAY-*, DISC-* |
| DSH-08 | V1 | IMPLEMENTED (2026-10-17, E3) | Brought into v4: EXP-001…004 |
| DSH-09 | V2 | DEFERRED | — |
| DSH-10 | M | PARTIALLY_IMPLEMENTED | Doctor schedules done; invite, roles, branch access, time off missing; commission % deferred. Refined by ACCESS-001…005, APPT-005 |
| DSH-11 | V1 | PARTIALLY_IMPLEMENTED | Brought into v4 for the approved reports: REPORT-001…006; export as CSV that opens in Excel (2026-10-20, H3) |
| DSH-12 | M | PARTIALLY_IMPLEMENTED | Profile, branches, hours done; holidays, booking rules, tax missing; notification templates and gateway keys deferred |
| DSH-13 | M | PARTIALLY_IMPLEMENTED | Theme publish only; template, sections, SEO and domains follow the website-content roadmap |
| DSH-14 | V1 | DEFERRED | — |
| DSH-15 | M | PARTIALLY_IMPLEMENTED | Patients only; refined by AUDIT-001…003 |
| DSH-16 | M | NOT_IMPLEMENTED | *AR/EN templates* superseded by L10N-001 (Arabic only). Scope question CLR-14 |
| DSH-17 | V1 | DEFERRED (brief) | Dental laboratory tracking |
| DSH-18 | V1 | NOT_IMPLEMENTED (DB only) | Brought into v4: PAY-004 |
| DSH-19 | V1 | PARTIALLY_IMPLEMENTED | v4 delivers a manual follow-up list (VISIT-005, done D4); automatic recalls deferred |
| DSH-20 | V1 | DEFERRED (brief) | Doctor commissions |
| NTF-01 | M / V1 | PARTIALLY_IMPLEMENTED | Email done; in-app not built; SMS and WhatsApp deferred (brief) |
| NTF-02 | V1 | DEFERRED | When built: Arabic templates only |
| NTF-03 | M | PARTIALLY_IMPLEMENTED | Booking created/confirmed and reminders by email; invoice, payment, staff-invited and trial events not built |
| NTF-04 | M | IMPLEMENTED | Outbox + queue + `notifications` log (email) |
| NTF-05 | V1 | DEFERRED | No SMS/WhatsApp |
| BIL-01 | M | PARTIALLY_IMPLEMENTED | Plans with prices, limits and features seeded; no management |
| BIL-02 | M | IMPLEMENTED | — |
| BIL-03 | V1 | DEFERRED (paid gateway) | — |
| BIL-04 … BIL-07 | V1 | NOT_IMPLEMENTED | Not in v4 |
| BIL-08 | M | IMPLEMENTED | — |
| ADM-01, 02, 04 | M | NOT_IMPLEMENTED | Not in v4 (CLR-14) |
| ADM-03, 05 | V1 | DEFERRED | — |
| ADM-06 | V2 | DEFERRED | — |
| NFR-01 | — | IMPLEMENTED | 19 DB isolation checks + cross-clinic e2e cases pass (2026-10-17) |
| NFR-02 | — | PARTIALLY_IMPLEMENTED | Deviation: scrypt instead of argon2id. Rate limits on auth, OTP, booking. CSRF posture of the refresh cookie NEEDS_VERIFICATION |
| NFR-03 | — | PARTIALLY_IMPLEMENTED | Signed URLs for private images; patient record access audited. Disk/bucket encryption NEEDS_VERIFICATION (hosting). Clinical attachments not built |
| NFR-04 | — | NOT_IMPLEMENTED | No gateway keys in v4 |
| NFR-05, 06, 07, 11, 13 | — | NEEDS_VERIFICATION | Need hosting and measurement |
| NFR-08 | — | NOT_IMPLEMENTED | — |
| NFR-09 | — | SUPERSEDED in part by L10N-001…006 | Bilingual parts superseded; branch-timezone rule kept (L10N-006) |
| NFR-10 | — | IMPLEMENTED (DB) | Applies to every money field in Part B |
| NFR-12 | — | PARTIALLY_IMPLEMENTED | Structured logs with request and tenant id; no error tracking or metrics |
| NFR-14 | — | PARTIALLY_IMPLEMENTED | Modular monolith, OpenAPI via Swagger; coverage not measured |
| NFR-15 | — | NOT_IMPLEMENTED | — |
| NFR-16 | — | PARTIALLY_IMPLEMENTED | `marketing_opt_in` stored with time; consents not built |

**§7.1 MVP acceptance criteria** — the v3 text shows every box ticked. That was not a statement about the code.
Actual state on 2026-10-17:

| # | Criterion (short) | Actual |
| --- | --- | --- |
| 1 | Sign-up to live site in < 10 min | Flow exists; not timed |
| 2 | Website booking; emails within 1 min | IMPLEMENTED (email) |
| 3 | No double booking under concurrency | IMPLEMENTED (DB test) |
| 4 | Cross-tenant isolation tests | IMPLEMENTED |
| 5 | Invoice + partial cash payment + Arabic receipt | NOT_IMPLEMENTED (DB rules only) |
| 6 | Site and dashboard in Arabic and English | SUPERSEDED by L10N-001 — becomes "Arabic only, RTL" |
| 7 | Super admin lists and suspends tenants | NOT_IMPLEMENTED |
| 8 | Daily backup + tested restore | NEEDS_VERIFICATION |
| 9 | Abandoned booking frees its slot in 10 min | IMPLEMENTED |
| 10 | Issued invoice locked, no overpay, currency checked | IMPLEMENTED (DB), not reachable from the app |
| 11 | Guardian signs a child's consent | NOT_IMPLEMENTED |

### A.1 Original SRS v3 (unchanged)

#### Dental Clinic SaaS — SRS & Database Schema

Oct 14, 2026 · @Bronto24 Academy

##### 1. Introduction

The product is a multi-tenant SaaS: a dentist signs up, enters their clinic data once, and gets a branded public website plus a clinic management dashboard. One codebase and one database serve every clinic.

###### 1.1 Purpose

This document defines what the platform must do (functional requirements), how well it must do it (non-functional requirements), and the data model behind it. Developers, QA and the product owner use it as the reference for the MVP and the later releases.

###### 1.2 Product vision

A dental clinic in Egypt or the MENA region goes from signup to a live website with online booking in under 10 minutes, with no developer involved. The website stays current because the dashboard is its only content source.

###### 1.3 Scope

| In scope | Out of scope (for now) |
| --- | --- |
| Marketing landing page, pricing, signup | Free drag-and-drop page builder |
| Onboarding wizard for clinic data | Native mobile apps (web dashboard is responsive) |
| Template-based clinic website on subdomain or custom domain | Insurance claims processing |
| Dashboard: patients, appointments, treatments, dental chart, invoices, inventory, staff | Radiology image analysis / AI diagnosis |
| Online booking with email/SMS/WhatsApp notifications | Accounting ledger (exports only) |
| SaaS subscriptions, trials and plan limits | Telemedicine video calls |
| Super-admin panel for the platform owner | Patient mobile app |

###### 1.4 Definitions

| Term | Meaning |
| --- | --- |
| Platform | The SaaS product as a whole, run by the platform owner |
| Tenant | One clinic business (a brand); can have several branches |
| Branch | A physical clinic location with its own hours, rooms and staff |
| Owner | The dentist who signed up and owns the tenant account |
| Staff | Any user inside a tenant: doctor, receptionist, assistant, accountant |
| Patient | A clinic's patient; has no dashboard login in the MVP |
| Site | The tenant's public website, generated from a template + dashboard data |
| Plan | A subscription tier that sets feature flags and limits |
| RLS | PostgreSQL Row-Level Security, used to isolate tenants' rows |

##### 2. Users, roles and permissions

There are two separate user worlds: platform users (you and your support team) and tenant users (clinic staff). Patients interact only through the public website in the MVP.

###### 2.1 Actors

| Actor | Where they work | Main goals |
| --- | --- | --- |
| Visitor (prospective doctor) | Landing page | Understand the product, compare plans, sign up |
| Owner | Dashboard | Set up the clinic, manage staff, billing, website, see reports |
| Doctor | Dashboard | See own schedule, record treatments, dental chart, prescriptions |
| Receptionist | Dashboard | Book and confirm appointments, register patients, take payments |
| Assistant | Dashboard | Update appointment status, use inventory |
| Accountant | Dashboard | Invoices, payments, expenses, financial reports |
| Patient | Clinic website | View services and doctors, book online, pay online |
| Super admin | Platform admin panel | Manage tenants, plans, support, platform health |
| Support agent | Platform admin panel | Read-only tenant view, impersonate with audit trail |

###### 2.2 Permission matrix (tenant roles)

Owners can create custom roles later; these are the seeded defaults. R = read, W = create/update, D = delete, own = only their own records.

| Module | Owner | Doctor | Receptionist | Assistant | Accountant |
| --- | --- | --- | --- | --- | --- |
| Clinic settings & branches | RWD | R | R | — | R |
| Staff & roles | RWD | — | — | — | — |
| Website & content | RWD | R | — | — | — |
| Patients (incl. merge) | RWD | RW | RW | R | R |
| Medical history & dental chart | RWD | RW | R | R | — |
| Consents | RWD | RW | RW | R | — |
| Appointments & waitlist | RWD | RW (own) | RWD | RW | R |
| Treatment plans | RWD | RW (own) | R | R | R |
| Lab orders | RWD | RW (own) | RW | RW | R |
| Recalls | RWD | RW (own) | RW | R | — |
| Invoices & payments | RWD | R (own) | RW | — | RWD |
| Installment plans | RWD | R (own) | RW | — | RWD |
| Commissions & payouts | RWD | R (own) | — | — | RWD |
| Expenses | RWD | — | — | — | RWD |
| Inventory | RWD | R | R | RW | R |
| Reports | R | R (own) | R (daily) | — | R |
| Subscription & billing | RWD | — | — | — | R |

###### 2.3 Rules

- A login (`users`) is global and its role lives on `tenant_members`, so one doctor can work at two brands. The MVP UI shows one tenant per login; a tenant switcher comes in V2.
- A user can be limited to specific branches; queries filter by the user's allowed branches.
- Permissions are checked in the API, never only in the UI.

##### 3. System architecture

Three front ends share one NestJS API and one PostgreSQL database; the tenant is resolved from the hostname (public site) or the JWT (dashboard).

&#91;embedded content: system architecture · 3 front ends, 1 API, 3 data stores\]

No front end talks to the database; the API sets the tenant before every query, and slow work (emails, reminders, revalidation) goes through the queue.

###### 3.1 Tech stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Public sites + landing | Next.js (App Router) | One app; middleware maps hostname → tenant; ISR + on-demand revalidation |
| Dashboard | React 19 (Next.js or Vite SPA) | Behind auth, no SEO needs; TanStack Query, shadcn/ui, RTL support |
| Super-admin panel | Same dashboard app, `/admin` area | Separate role guard, separate audit log |
| API | NestJS (REST, OpenAPI) | Modules per domain; tenant context per request |
| Database | PostgreSQL 16 | Shared schema, `tenant_id` on every tenant table, RLS enforced |
| ORM | Prisma or Drizzle | Must allow `SET LOCAL app.tenant_id` inside a transaction |
| Cache / queues | Redis + BullMQ | Reminders, emails, webhooks, ISR revalidation jobs |
| File storage | S3-compatible (Cloudflare R2 / MinIO) | Logos, gallery, X-rays; private bucket + signed URLs for medical files |
| Email / SMS / WhatsApp | Resend or SES; SMS Misr / Twilio; WhatsApp Cloud API | Behind a `NotificationProvider` interface |
| Payments | Paymob / Fawry (Egypt), Stripe (international) | Separate flows for SaaS billing and patient payments |
| Hosting | VPS with Docker + Caddy, or Vercel for the Next.js app | Caddy on-demand TLS for custom domains on VPS |

###### 3.2 Domain routing

1. `yourbrand.com` and `www` → landing pages.
2. `app.yourbrand.com` → dashboard.
3. `api.yourbrand.com` → NestJS API.
4. `{slug}.yourbrand.com` → clinic site; middleware looks up `domains` by hostname (cached in Redis, 5 min).
5. `drclinic.com` (custom) → same lookup; TLS issued on demand only if the domain exists in `domains` with status `verified`.

###### 3.3 Tenant isolation

- Every tenant-owned table has `tenant_id uuid not null` and an RLS policy `tenant_id = current_setting('app.tenant_id')::uuid`.
- The API opens a transaction per request and runs `SET LOCAL app.tenant_id = '<id>'` before any query.
- The app connects as a non-owner role without `BYPASSRLS`; migrations and super-admin jobs use a separate role.
- Public-site reads use a read-only endpoint set that returns only published, non-medical data.

##### 4. Functional requirements

Each requirement has an ID for tracking in tickets and tests. Priority: **M** = MVP, **V1** = first release after MVP, **V2** = later.

###### 4.1 Landing page & marketing (LND)

| ID | Requirement | Priority |
| --- | --- | --- |
| LND-01 | Bilingual (AR/EN) landing page with hero, features, template gallery, pricing, FAQ, testimonials, contact | M |
| LND-02 | Pricing table reads plans from the API (not hard-coded) with monthly/yearly toggle | M |
| LND-03 | Live demo: a sample clinic site and a read-only demo dashboard | V1 |
| LND-04 | Lead capture form for clinics wanting a sales call; stored in `leads` | M |
| LND-05 | SEO: meta tags, sitemap, OG images, blog section | V1 |

###### 4.2 Signup & authentication (AUTH)

| ID | Requirement | Priority |
| --- | --- | --- |
| AUTH-01 | Sign up with full name, email, phone, password, clinic name; accept terms | M |
| AUTH-02 | Verify email (link) and phone (6-digit OTP, 5-min expiry, 5 attempts max) | M |
| AUTH-03 | On signup: create `tenant`, owner `user`, `tenant_member` (role Owner), default branch, trial `subscription`, subdomain from clinic name (unique, editable) | M |
| AUTH-04 | Login with email or phone + password; Google sign-in | M / V1 |
| AUTH-05 | JWT access token (15 min) + rotating refresh token (30 days) in httpOnly cookie | M |
| AUTH-06 | Forgot / reset password via email or SMS OTP | M |
| AUTH-07 | Optional 2FA (TOTP) for owners; forced for super admins | V1 |
| AUTH-08 | Staff invite by email/phone; invitee sets password; invite expires in 7 days | M |
| AUTH-09 | Lockout after 10 failed logins in 15 min; all logins written to `auth_events` | M |

###### 4.3 Onboarding wizard (ONB)

The wizard runs after first login, saves after every step and can be resumed. Progress is stored in `tenants.onboarding_step`.

1. **Clinic profile** — brand name (AR/EN), logo, specialties, short about text, primary phone, WhatsApp, social links.
2. **Branches** — address, city, map pin, phone, working hours per weekday, breaks, number of chairs/rooms.
3. **Doctors** — name, title, photo, specialties, bio, branches they work in, consultation fee; option to send each an invite.
4. **Services** — pick from a seeded dental catalog (cleaning, filling, root canal, implant, braces, whitening…) or add custom; set price, duration, which doctors perform it, show-on-website flag.
5. **Website** — choose template, colours, fonts, sections to show; confirm subdomain.
6. **Publish** — preview, then publish; success screen with the live link and share buttons.

| ID | Requirement | Priority |
| --- | --- | --- |
| ONB-01 | Steps 1–6 above with validation per step and a progress bar | M |
| ONB-02 | “Skip for now” on optional steps; checklist widget on the dashboard home until complete | M |
| ONB-03 | Import patients from Excel/CSV with column mapping and a dry-run report | V1 |

###### 4.4 Clinic website (WEB)

| ID | Requirement | Priority |
| --- | --- | --- |
| WEB-01 | 2 templates in MVP, 5 by V2; each made of sections: Hero, About, Services, Doctors, Before/After, Testimonials, Gallery, FAQ, Blog, Booking, Branches + map, Contact | M |
| WEB-02 | Owner can enable/disable and reorder sections, edit section texts, set colours, fonts, logo, favicon | M |
| WEB-03 | Catalog data (services, prices, doctors, branches, hours) goes live on save, with no Publish step, so the site never shows a stale price | M |
| WEB-04 | Arabic and English versions with RTL; language switcher | M |
| WEB-05 | Draft / publish covers only layout, section texts, theme and SEO; Publish revalidates the site's pages | M |
| WEB-06 | Per-page SEO: title, description, OG image; auto sitemap.xml and robots.txt per tenant | M |
| WEB-07 | Custom domain: owner adds domain, sees DNS instructions (CNAME), status Pending → Verified → Active; SSL automatic | V1 |
| WEB-08 | Blog / articles for SEO with categories | V1 |
| WEB-09 | Google Analytics / Meta Pixel IDs per tenant | V1 |
| WEB-10 | Platform badge “Powered by …” shown on Basic plan, removable on Pro | M |

###### 4.5 Online booking (BOOK)

| ID | Requirement | Priority |
| --- | --- | --- |
| BOOK-01 | Patient picks branch → service → doctor (or “any”) → date → free slot | M |
| BOOK-02 | Slots computed from branch hours, doctor schedule, service duration, existing appointments and holds, time off and holidays | M |
| BOOK-03 | Patient enters name, phone, email (optional), notes; phone OTP to avoid fake bookings (toggle per tenant) | M |
| BOOK-04 | Payment option per tenant: pay at clinic, deposit online, or full online | M (cash) / V1 (online) |
| BOOK-05 | Statuses and transitions as defined in 4.10 | M |
| BOOK-06 | Auto-confirm or manual confirm, set per tenant | M |
| BOOK-07 | Emails to patient and clinic with booking details and payment method; reminders 24 h and 2 h before | M |
| BOOK-08 | Patient can cancel or reschedule through a signed link up to N hours before (tenant setting) | V1 |
| BOOK-09 | Double-booking prevented at database level (exclusion constraint on doctor + time range, and on room) | M |
| BOOK-10 | Choosing a slot places a 10-minute **hold**; the hold blocks the slot, and an expired hold is released automatically | M |
| BOOK-11 | Patient matching: phone + name match links the booking to an existing patient; otherwise a new patient is created and flagged for review | M |
| BOOK-12 | Waitlist: patient joins for a date range; when a matching slot frees up, the first entry gets an offer valid for 2 hours | V2 |

###### 4.6 Dashboard modules (DSH)

| ID | Module | Key capabilities | Priority |
| --- | --- | --- | --- |
| DSH-01 | Home | Today's appointments, revenue today/month, new patients, pending bookings, due recalls and lab orders, onboarding checklist | M |
| DSH-02 | Calendar | Day/week views per doctor or chair; drag to reschedule; colour by status; walk-ins | M |
| DSH-03 | Patients | Profile, contacts, file number, tags, guardian for children, marketing opt-in, medical history & allergies, attachments, visit timeline; merge duplicates | M |
| DSH-04 | Dental chart | FDI tooth numbering (adult 11–48, child 51–85); per-tooth and per-surface conditions and procedures; history over time | V1 |
| DSH-05 | Treatment plans | Multi-step plans with estimated cost, patient approval, convert steps to appointments and invoice items | V1 |
| DSH-06 | Visits & clinical notes | Per-visit notes, procedures done, prescriptions (printable), next-visit suggestion | M |
| DSH-07 | Invoices & payments | Invoice from services/procedures, discounts, partial payments, refunds, receipt PDF, patient balance; totals calculated by the database | M |
| DSH-08 | Expenses | Categories, supplier, branch, attachments | V1 |
| DSH-09 | Inventory | Items, stock per branch, movements (in/out/adjust), low-stock alerts, suppliers | V2 |
| DSH-10 | Staff | Invite, roles, branch access, doctor schedules, time off, commission % | M |
| DSH-11 | Reports | Revenue by period/doctor/service/branch, appointments & no-show rate, new vs returning patients, outstanding balances, overdue installments; export Excel | V1 |
| DSH-12 | Settings | Clinic profile, branches, hours, holidays, booking rules, notification templates, payment gateway keys, tax | M |
| DSH-13 | Website editor | Template, sections, content, SEO, domains, publish | M |
| DSH-14 | Reviews | Collect a review link after a completed visit; owner approves which appear on the site | V1 |
| DSH-15 | Audit log | Who changed what and when, for patients, invoices and settings | M |
| DSH-16 | Consents | AR/EN consent templates per procedure; patient or guardian signs on a tablet; signed text and signature stored | M |
| DSH-17 | Lab orders | Send work to a dental lab (crown, bridge, denture, aligner…): teeth, shade, material, due date, cost; track sent → received → fitted, remakes | V1 |
| DSH-18 | Installments | Split a treatment or invoice into dated installments; reminders before due date; overdue list | V1 |
| DSH-19 | Recalls | Auto-create a recall after cleaning, ortho, surgery; call list of due recalls; book from the list | V1 |
| DSH-20 | Commissions & payouts | Commission frozen per procedure; monthly payout per doctor: draft → approved → paid | V1 |

###### 4.7 Notifications (NTF)

| ID | Requirement | Priority |
| --- | --- | --- |
| NTF-01 | Channels: email (M), SMS (V1), WhatsApp (V1), in-app (M) | M / V1 |
| NTF-02 | Editable AR/EN templates per event with variables (`{{patient_name}}`, `{{date}}`, `{{branch}}`…) | V1 |
| NTF-03 | Events: booking created/confirmed/cancelled, reminder, invoice issued, payment received, staff invited, trial ending, subscription failed | M |
| NTF-04 | Sent through a queue with retries; every message logged with status in `notifications` | M |
| NTF-05 | SMS/WhatsApp credits per plan; usage counted per tenant | V1 |

###### 4.8 SaaS subscription & billing (BIL)

| ID | Requirement | Priority |
| --- | --- | --- |
| BIL-01 | Plans with price (monthly/yearly), currency, feature flags and limits (branches, staff, patients, SMS credits, storage) | M |
| BIL-02 | 14-day free trial, no card required | M |
| BIL-03 | Checkout via Paymob/Fawry (EGP) or Stripe (USD); recurring where supported, else renewal invoices | V1 |
| BIL-04 | States: trialing → active → past\_due → suspended → cancelled; 7-day grace period on failed payment | V1 |
| BIL-05 | Suspended tenant: site shows a maintenance page, dashboard is read-only; data kept 90 days | V1 |
| BIL-06 | Upgrade/downgrade with proration; downgrade blocked if usage exceeds new limits | V1 |
| BIL-07 | Platform invoices for the clinic (PDF) with tax fields | V1 |
| BIL-08 | Limits enforced in the API with a clear upgrade message | M |

###### 4.9 Super-admin panel (ADM)

| ID | Requirement | Priority |
| --- | --- | --- |
| ADM-01 | Tenant list with plan, status, usage, signup date, last activity; search and filters | M |
| ADM-02 | Tenant detail: suspend, extend trial, change plan, add credits, notes | M |
| ADM-03 | Impersonate a tenant user (logged, time-limited, banner shown) | V1 |
| ADM-04 | Manage plans, templates, seeded service catalog, platform settings | M |
| ADM-05 | Platform metrics: MRR, active tenants, churn, trial conversion, bookings per day | V1 |
| ADM-06 | Support tickets from tenants | V2 |

###### 4.10 Appointment lifecycle

Only website bookings start as `held`; dashboard and phone bookings start at `pending` (or `confirmed` when the receptionist books directly).

&#91;embedded content: appointment lifecycle · 9 statuses\]

Completed, cancelled, no\_show and expired are final; a change after that is a new appointment. Who may move a booking: patient (cancel via signed link, within the cancel window), receptionist and owner (any move), doctor (own appointments: checked\_in → completed), system (held → expired, confirmed → no\_show 2 h after the end time if not checked in).

###### 4.11 Online booking sequence

1. **Pick slot** — API runs `release_expired_holds(doctor)`, then inserts the appointment as `held` with `hold_expires_at = now + 10 min`.
2. **Enter details** — name, phone, notes; OTP sent (max 3 per phone per 10 min).
3. **Verify OTP** — patient matched by phone + name or created; `patient_id` set on the appointment.
4. **Pay at clinic** → status `pending`, or `confirmed` if the tenant auto-confirms. **Pay online** → payment created with an idempotency key, patient sent to the gateway.
5. **Gateway webhook** — stored once in `webhook_events`; on success the booking moves to `pending`/`confirmed` and an `appointment.created` outbox event is written in the same transaction.
6. **Worker** — sends emails/SMS and schedules reminders with dedupe keys.

| Failure | What happens |
| --- | --- |
| Slot taken between viewing and clicking | Insert fails on the exclusion constraint; show the next 3 free slots |
| Wrong OTP 5 times | Hold released; phone gets a 15-minute cooldown |
| Patient abandons OTP or payment | Hold expires after 10 minutes; slot is free again; online payment marked failed |
| Payment webhook arrives after the hold expired | If the slot is still free, book it; if not, refund automatically and alert the clinic |
| Patient double-clicks Pay | Same idempotency key returns the same payment and booking |
| Email or SMS provider down | Message retried with backoff from the queue; the booking itself is unaffected |

###### 4.12 Screen inventory

| Surface | Screens |
| --- | --- |
| Landing | Home, Features, Templates gallery, Pricing, FAQ, Contact / lead form, Blog, Login, Signup, Verify OTP, Forgot password, Terms, Privacy |
| Onboarding | Clinic profile, Branches, Doctors, Services, Website, Publish success |
| Clinic website (per template) | Home, Services, Service detail, Doctors, Doctor profile, Branches, Gallery / before-after, Reviews, Blog list and post, Contact, Booking (4 steps), Manage booking link, Leave a review, Maintenance page |
| Dashboard | Home, Calendar, Appointment drawer, Patients list, Patient profile (overview, medical history, chart, plans, visits, files, consents, invoices, installments, lab orders), Visit, Consent signing, Invoices, Payments, Installments, Lab orders, Recalls, Waitlist, Expenses, Inventory, Commissions, Reports, Staff, Settings (clinic, branches, hours, booking, notifications, payments, tax), Website editor, Domains, Subscription, Audit log |
| Super admin | Tenants, Tenant detail, Plans, Templates, Service catalog, Leads, Metrics, Platform audit log |

##### 5. Non-functional requirements

The targets below are sized for the first 500 clinics; they are starting points to measure against, not proven limits.

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-01 | Tenant isolation | No API call can read or write another tenant's rows; enforced by RLS (including the `tenants` table itself) and covered by automated cross-tenant tests in CI |
| NFR-02 | Security | OWASP ASVS L2; argon2id password hashing; rate limits on auth, OTP and booking endpoints; CSRF protection for cookie auth; secrets in env/vault, never in the DB in plain text |
| NFR-03 | Medical data privacy | Medical history, notes and attachments encrypted at rest (DB disk + bucket); attachments only via signed URLs (5 min); access to patient records written to the audit log; align with Egypt's Personal Data Protection Law 151/2020. Optional V2: app-level AES-GCM on clinical notes (those fields become unsearchable) |
| NFR-04 | Tenant payment keys | Clinic gateway keys encrypted with an application key (AES-256-GCM) before storage |
| NFR-05 | Performance | Public site pages served from cache, LCP < 2.5 s on 4G; dashboard API p95 < 300 ms; slot search < 500 ms |
| NFR-06 | Availability | 99.5% monthly for API and sites; health checks and uptime alerts |
| NFR-07 | Backups | Daily full + continuous WAL archiving; point-in-time restore within 7 days; bucket versioning for files; quarterly restore drill |
| NFR-08 | Data export & deletion | Owner can export all clinic data (CSV/JSON + files); tenant deletion after cancellation + 90 days, hard delete with confirmation |
| NFR-09 | i18n | Arabic and English across sites, dashboard, emails, PDFs; RTL layouts; dates in branch timezone (falls back to tenant, default Africa/Cairo); Arabic-Indic digits optional |
| NFR-10 | Money | Integer minor units + currency code, never floats; invoice totals, paid amounts and statuses are derived by database triggers, never sent by the client |
| NFR-11 | Accessibility | WCAG 2.1 AA on public sites and booking flow |
| NFR-12 | Observability | Structured JSON logs with request id and tenant id; error tracking (Sentry); metrics per tenant for bookings, errors, latency |
| NFR-13 | Scalability | Stateless API behind a load balancer; heavy work in queues; read replica when DB CPU > 60% sustained; monthly partitions for `audit_log` and `notifications` at \~1M rows |
| NFR-14 | Maintainability | Modular NestJS monolith; OpenAPI spec generated; migrations reviewed; >70% coverage on booking, billing and auth modules |
| NFR-15 | Legal documents | Platform Terms of Service, Privacy Policy, and a Data Processing Agreement (clinic = controller, platform = processor) accepted at signup and versioned |
| NFR-16 | Patient consent | Marketing messages only to patients with `marketing_opt_in`; every message has an opt-out; treatment consents signed and stored with the exact text signed |

##### 6. Database schema

The schema has 75 PostgreSQL 16 tables in 10 modules; 65 of them, including `tenants`, are protected by RLS. The migration is `dental_saas_schema.sql` **v3 (ready for Sprint 0)**. It passed an independent review plus 3 test suites run as the non-privileged app role: tenant isolation, slot holds, billing totals, refunds, installments, payouts, status transitions, and two real concurrent sessions paying or refunding the same invoice at once (the second is serialized and rejected when it would overpay).

&#91;embedded content: core entities · booking to payment\]

The chart, treatment plans and prescriptions hang off `patients` and `visits`; invoices and payments also link straight to the patient, so walk-in billing works without an appointment.

###### 6.1 Conventions

- **IDs:** `uuid`. Generate UUIDv7 in the API for better index locality.
- **Money:** `bigint` minor units + `char(3)` currency (`150000` = 1,500.00 EGP). Percentages are basis points (`1400` = 14%).
- **Enums:** `text` + `CHECK`, so adding a value is a cheap migration.
- **Same-tenant integrity:** every tenant table has `UNIQUE (tenant_id, id)`, and children use composite FKs `(tenant_id, parent_id)`. The database itself rejects an appointment that points at another clinic's patient.
- **Bilingual content:** `_en` / `_ar` column pairs for short public texts; `CHECK` that at least one is filled.
- **Time:** `timestamptz` in UTC; the tenant's timezone is on `tenants.timezone`. Weekly hours use `time` + `weekday` (0 = Sunday).
- **Soft delete:** only `tenants` and `patients` (`deleted_at`). Medical and financial records are never hard-deleted; invoices are voided.
- **Append-only:** `audit_log`, `platform_audit_log` and `tooth_records`. The app role has no UPDATE/DELETE on them.

###### 6.2 Platform & identity (guarded in the service layer; tenants also has RLS)

| Table | Purpose | Key columns & rules |
| --- | --- | --- |
| `plans` | Subscription tiers | `code` unique; prices monthly/yearly; `limits` and `features` JSON |
| `templates` | Website templates | `code`, `sections_schema`, `default_theme`, `min_plan_code` |
| `service_catalog` | Seeded dental services for onboarding | `code` unique, AR/EN names, default duration |
| `tenants` | A clinic brand | `slug` unique (subdomain), `status`, `onboarding_step` 1–7, timezone, currency, locale, logo |
| `users` | Global login identity | `email` / `phone` unique (E.164), `password_hash` (argon2id), `google_sub`, `platform_role` |
| `refresh_tokens` | Rotating sessions | `token_hash` unique, `family_id` for reuse detection, `revoked_at` |
| `otp_codes` | Phone/email OTP | hashed code, `attempts` ≤ 5, `expires_at` |
| `auth_events` | Login audit, lockout input | type, IP, user agent |
| `leads` | Landing-page sales leads | status new → contacted → converted / lost |
| `webhook_events` | Idempotent payment webhooks | `UNIQUE (provider, event_id)` |
| `platform_audit_log` | Super-admin actions | suspend, plan change, impersonation |

###### 6.3 Tenant account & access

| Table | Purpose | Key columns & rules |
| --- | --- | --- |
| `subscriptions` | Tenant's plan state | status trialing → active → past\_due → suspended / cancelled; only one non-cancelled per tenant (partial unique index) |
| `platform_invoices` | What the clinic pays you | number unique, period, amount, provider ref |
| `usage_counters` | Usage for plan limits | PK `(tenant_id, metric, period_start)` |
| `tenant_counters` | Gap-free invoice and file numbers | `next_tenant_counter('invoice:2026')`, atomic upsert |
| `tenant_settings` | Booking rules, tax, invoice prefix | auto-confirm, OTP, min notice, max days ahead, slot step, cancel window, payment mode, deposit, reminder offsets |
| `roles` | Per-tenant roles | seeded owner/doctor/receptionist/assistant/accountant; `permissions text[]` |
| `tenant_members` | User ↔ tenant with a role | `UNIQUE (tenant_id, user_id)`, `all_branches` flag |
| `member_branches` | Branch access when not all branches | PK `(member_id, branch_id)` |
| `invitations` | Staff invites | hashed token, role, branches, 7-day expiry |
| `files` | Every uploaded object | bucket + key, kind; X-rays, clinical photos and consents are forced private by CHECK |

###### 6.4 Clinic setup

| Table | Purpose | Key columns & rules |
| --- | --- | --- |
| `branches` | Locations | slug unique per tenant, map coordinates, optional `timezone` (falls back to tenant), exactly one `is_main` per tenant |
| `branch_hours` | Opening hours | several rows per weekday allow breaks; `closes_at > opens_at` |
| `holidays` | Closed dates | per branch, or all branches when `branch_id` is null |
| `rooms` | Chairs / rooms | name unique per branch |
| `doctors` | Bookable and shown doctors | optional `member_id` (doctor may have no login), bio AR/EN, fee, default commission, show/bookable flags |
| `doctor_branches` | Where a doctor works | M:N |
| `doctor_schedules` | Weekly schedule per branch | exclusion constraint: no overlapping shifts for one doctor on the same weekday |
| `doctor_time_off` | Leave, conferences | `ends_at > starts_at` |
| `service_categories`, `services` | Price list | price or price range, duration 5–480 min, bookable online, show on website, optional `catalog_code` |
| `doctor_services` | Which doctor performs which service | M:N; used by slot search |

###### 6.5 Patients & clinical

| Table | Purpose | Key columns & rules |
| --- | --- | --- |
| `patients` | Patient record | `file_no` unique per tenant; phone indexed but **not unique** (families share phones); trigram index on name; guardian name/phone/relation or `guardian_patient_id` for children; `marketing_opt_in` + timestamp; `merged_into_id` for duplicates (never itself) |
| `patient_medical_history` | Allergies, conditions, medications | 1:1 with patient |
| `patient_files` | X-rays, photos, consents | links `files` to patient and optionally a visit |
| `appointments` | Bookings | 9 statuses (see 4.10); `held` rows need `hold_expires_at` and may have no patient yet, every other status needs a patient; **exclusion constraints** stop overlapping active or held bookings per doctor and per room; `manage_token_hash` for the patient's link |
| `visits` | What happened clinically | one visit per appointment at most; complaint, diagnosis, notes |
| `tooth_records` | Dental chart history | FDI tooth code validated (11–48, 51–85), surfaces M/O/D/B/L/I/F/P, condition; latest row per tooth = current chart |
| `treatment_plans`, `treatment_plan_items` | Proposed multi-step treatment | plan status; items link to service, tooth, appointment |
| `visit_procedures` | Procedures done | source for invoice lines; `commission_bp` frozen at the time, `commission_minor` generated; `payout_id` once paid out |
| `prescriptions`, `prescription_items` | Printable prescriptions | drug, dose, frequency, duration |

###### 6.5b Dental operations

| Table | Purpose | Key columns & rules |
| --- | --- | --- |
| `consent_templates` | Consent texts per procedure | key + version unique; AR/EN body |
| `patient_consents` | Signed consents | snapshot of the exact text signed, signer name and relation (self or guardian), signature file, witness, IP |
| `labs` | External dental labs | name unique per tenant, phone/WhatsApp |
| `lab_orders` | Work sent to a lab | work type, teeth, shade, material, due date, cost; status draft → sent → in\_progress → received → fitted (or remake / cancelled); a remake points to the original |
| `recalls` | “Come back in 6 months” | reason, due date, status pending → contacted → booked / done / dismissed; `booked` needs an appointment |
| `waitlist_entries` | Patients waiting for a slot | branch, optional doctor/service, date range, preferred period; an `offered` entry needs an appointment and an offer expiry |

###### 6.6 Clinic billing

| Table | Purpose | Key columns & rules |
| --- | --- | --- |
| `invoices` | Patient invoices | subtotal, paid, total and status **always recomputed by trigger** (direct writes are ignored); issued → draft blocked; discount, tax, currency and patient locked after issue; void only when nothing is paid; only drafts can be deleted; a 100%-discount invoice becomes paid |
| `invoice_items` | Lines | `line_total = qty × unit − discount`; editable only on drafts (both the old and new invoice when moved); a procedure is billed once outside void invoices, so voided work can be re-billed |
| `payments` | Money received | amount > 0; must match the invoice's or installment plan's patient and currency, and the appointment's patient; cannot pay a draft or void invoice; locks its invoice first so concurrent payments are serialized; `UNIQUE (tenant_id, provider, provider_ref)` and `(tenant_id, idempotency_key)` |
| `refunds` | Refunds | only on succeeded payments; total refunds ≤ payment; locks the payment; trigger updates the payment, which updates the invoice |
| `payment_plans`, `installments` | Installments for braces, implants | plan must match its invoice's patient and currency; each installment's paid amount and status derived from its payments; plan becomes completed when all are paid; overdue = unpaid and past due date |
| `doctor_payouts` | Commission payouts | amount **derived** from linked procedures' frozen commissions; periods per doctor cannot overlap; a procedure joins only a draft payout of its own doctor and is frozen once the payout is approved |
| `payment_gateways` | Clinic's own Paymob/Fawry/Stripe keys | `credentials_enc` encrypted, one row per provider |
| `expense_categories`, `expenses` | Clinic expenses | per branch, supplier, receipt file |

###### 6.7 Inventory

| Table | Purpose | Key columns & rules |
| --- | --- | --- |
| `suppliers` | Vendors | shared with expenses |
| `inventory_items` | Materials and instruments | `sku` unique per tenant, unit, `min_stock` |
| `inventory_stock` | Current quantity per branch | `quantity ≥ 0`; updated in the same transaction as the movement |
| `inventory_movements` | Ledger of stock changes | signed quantity; CHECK ties sign to type (purchase +, usage −); transfers paired by `transfer_id` |

###### 6.8 Website

| Table | Purpose | Key columns & rules |
| --- | --- | --- |
| `sites` | One site per tenant | template, draft vs published theme, `published_version`, locales, badge, analytics IDs |
| `site_pages` | Pages and their ordered sections | `draft_sections` vs `published_sections` JSON, so edits go live only on Publish; SEO JSON |
| `domains` | Hostname → tenant | hostname unique; subdomain or custom; status pending → verified → active; one primary |
| `faqs` | FAQ section | optional link to a service |
| `gallery_items` | Photos and before/after | CHECK: a before/after case cannot be published without `consent_confirmed` |
| `reviews` | Testimonials | rating 1–5, one per appointment, owner approves |
| `posts` | Blog | unique `(tenant_id, locale, slug)` |

###### 6.9 Notifications, audit, outbox

| Table | Purpose | Key columns & rules |
| --- | --- | --- |
| `notification_templates` | Editable messages | unique `(tenant, event, channel, locale)` |
| `notifications` | Every email/SMS/WhatsApp sent | status, attempts, provider id; `dedupe_key` unique so a reminder is never sent twice |
| `in_app_notifications` | Dashboard bell | partial index on unread |
| `audit_log` | Who did what | actor, action, entity, field changes; partition monthly when large |
| `outbox_events` | Reliable side effects | written in the same transaction as the change; a worker sends emails, revalidates the site, etc. |

###### 6.10 Row-level security & helper functions

- `current_tenant_id()` reads `app.tenant_id`; every tenant table has policy `tenant_isolation`: `tenant_id IS NOT DISTINCT FROM current_tenant_id()` for `USING` and `WITH CHECK`, plus `FORCE ROW LEVEL SECURITY`. With no tenant set, clinic rows return 0; platform-level outbox events (`tenant_id` null) can still be written.
- `tenants` has its own policy `id = current_tenant_id()`. At signup the API generates the tenant id and sets `app.tenant_id` before inserting.
- **Three database roles:** `app_user` (the API, no RLS bypass), `app_worker` (queue workers, outbox relay, billing jobs; bypasses RLS), `app_definer` (no login; owns the lookup functions below). `app_user` cannot change `tenants.status`, subscriptions or usage counters.
- **Lookups before a tenant is known** (`SECURITY DEFINER`, return only what the flow needs): `memberships_for_user(user)` for login and the tenant picker, `invitation_by_token(hash)` for invite links, `tenant_for_payment(provider, ref)` for payment webhooks, `resolve_tenant_by_host(host)` for the website middleware, `domain_allowed_for_tls(host)` for Caddy.
- `release_expired_holds(doctor)` runs before each booking insert; `release_all_expired_holds()` is the 1-minute job across all clinics.
- Billing triggers on `invoices`, `invoice_items`, `payments`, `refunds`, `payment_plans`, `doctor_payouts` and `visit_procedures` keep every money total consistent and lock the parent row first.
- `appointments_transition` enforces the status machine in section 4.10.
- `next_tenant_counter(key)` — atomic per-tenant numbering for invoices and patient files.
- Domain hostnames are unique only once verified (DNS), so an unverified claim cannot squat another clinic's domain.

###### 6.11 Key invariants enforced by the database

| Rule | How |
| --- | --- |
| A doctor cannot have two active or held appointments at the same time | `EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&)` where status not cancelled / no\_show / expired |
| A room/chair cannot be double-booked, and must be in the appointment's branch | Exclusion on `room_id`; FK `(tenant_id, branch_id, room_id)` |
| An abandoned website booking frees its slot | `held` + `hold_expires_at`, released by the hold functions |
| Appointments follow the status machine | `appointments_transition` trigger (e.g. completed → held is rejected) |
| Child rows always belong to the same clinic as their parent | Composite FKs `(tenant_id, x_id)` |
| Invoice totals, paid amounts and statuses add up | Recomputed from lines, payments and refunds on every change; client values ignored |
| Two receptionists paying at the same second cannot overpay | Payment locks the invoice row; the second waits and fails `paid ≤ total` |
| Refunds never exceed the payment, and only on succeeded payments | `refunds_validate` with a row lock |
| A payment matches its invoice/plan/appointment patient and currency | `payments_validate` trigger |
| Issued invoices cannot be edited, re-drafted or deleted | `invoices_derive`, `invoice_items_validate`, `invoices_guard_delete` |
| A payment webhook is processed once | `UNIQUE (provider, event_id)` + `UNIQUE (tenant_id, provider, provider_ref)` |
| Payout amounts are correct and frozen after approval | Derived from procedures; overlap exclusion; guard trigger |
| Stock never goes negative | `CHECK (quantity >= 0)` on `inventory_stock` |
| Medical files are never public | `CHECK` on `files.kind` vs `is_private` |
| Before/after photos need consent | `CHECK` on `gallery_items` |

##### 7. Release plan, acceptance and open questions

The MVP is about 8 weeks for 2–3 developers; V1 grew to 8 weeks after the review added lab orders, installments, recalls and commissions. V1 and V2 start only after real clinics use the previous phase. Week counts are upper estimates, not commitments.

&#91;embedded content: release roadmap · 3 phases, 2 gates\]

Gate 1 proves clinics finish onboarding and take real bookings; Gate 2 proves they will pay before building inventory and multi-brand features.

###### 7.1 MVP acceptance criteria

- [x] A new doctor signs up, finishes the wizard and has a live site on a subdomain in under 10 minutes.
- [x] A patient books from the site on a phone; patient and clinic receive emails within 1 minute.
- [x] Two bookings for the same doctor and time are impossible, even when submitted at the same moment.
- [x] Automated tests prove tenant A cannot read or write tenant B's data through any endpoint.
- [x] Receptionist creates an invoice, records a partial cash payment and prints an Arabic receipt.
- [x] Site and dashboard work in Arabic (RTL) and English.
- [x] Super admin can list tenants, see their plan and status, and suspend one.
- [x] Daily backup runs and a restore has been tested once.
- [x] A website booking abandoned at OTP or payment frees its slot within 10 minutes.
- [x] An issued invoice cannot be edited, overpaid or paid in another currency; totals always match lines and payments.
- [x] A child patient's consent can be signed by a guardian, and the signed text is stored.

###### 7.2 Open questions

- Product and domain name for the platform (`yourbrand.com` is a placeholder).
- Final plan prices in EGP and USD, and the limits per plan.
- First payment provider for SaaS billing: Paymob or Fawry?
- Are SMS/WhatsApp costs included in plans as credits, or billed per message?
- Hosting for the Next.js app: Vercel (easier custom domains) or own VPS with Caddy?
- Will patients get their own login (history, invoices) in a later phase?
- Is e-invoicing with the Egyptian Tax Authority needed for clinics, and from which phase?

* Who drafts the Terms, Privacy Policy and Data Processing Agreement (a lawyer should review them)?
* Is a 10-minute slot hold long enough for online payment through Paymob or Fawry?
* Default commission model: percentage of procedure price, or of collected payments?

##### 8. Architecture patterns & implementation start

Build a **modular monolith** in NestJS: one deployable API (plus a worker built from the same code), split into modules by business area. Each module uses a light Clean Architecture; full DDD is reserved for the two complex modules, scheduling and billing.

###### 8.1 Why a modular monolith

| Option | Verdict | Reason |
| --- | --- | --- |
| Modular monolith (NestJS) | **Chosen** | One deploy, one DB transaction across modules, simple debugging; modules can be split out later if one really needs to scale alone |
| Microservices | Rejected for now | A 2–3 person team would spend its time on networking, distributed transactions and deploys instead of features |
| Plain layered monolith (no module rules) | Rejected | Turns into a big ball of mud by month 6; billing code ends up reading scheduling tables directly |

###### 8.2 Modules (bounded contexts)

| Module | Owns tables | Style |
| --- | --- | --- |
| `identity` | users, refresh\_tokens, otp\_codes, auth\_events | Service + repository |
| `tenancy` | tenants, subscriptions, roles, tenant\_members, invitations, tenant\_settings, usage\_counters | Service + repository; seeding factory |
| `clinic-setup` | branches, hours, holidays, rooms, doctors, schedules, services | CRUD |
| `patients` | patients, medical history, files, consents | Service + repository |
| `scheduling` | appointments, waitlist, recalls | **Rich domain**: availability engine, state machine, holds |
| `clinical` | visits, tooth\_records, treatment plans, procedures, prescriptions, lab orders | Service + state machine for lab orders |
| `billing` | invoices, payments, refunds, installments, payouts, expenses | **Rich domain**: invoice state machine, payment strategies |
| `website` | sites, pages, domains, faqs, gallery, reviews, posts | Service + section registry |
| `notifications` | templates, notifications, in-app | Adapters per channel; queue consumers |
| `platform` | plans, templates, catalog, leads, platform audit | Super-admin services |
| `shared` | outbox, audit\_log, tenant context, errors, money, clock | Cross-cutting kernel |

Module rules, enforced in CI with `eslint-plugin-boundaries` or `dependency-cruiser`:

- A module touches only its own tables. Other modules call its exported service (its public API), never its repository.
- Reacting to another module (“when an appointment completes, create a recall”) goes through a **domain event**, not a direct call.
- `shared` depends on nothing; nothing depends on a module's internals.

###### 8.3 Design patterns and where they apply

| Pattern | Where | Why |
| --- | --- | --- |
| Layered / Clean Architecture (controller → use case → domain → repository) | Every module | Business rules testable without HTTP or a database |
| Repository + Unit of Work | All DB access | One transaction per request; the tenant is set once with `SET LOCAL` |
| Context object via AsyncLocalStorage (`nestjs-cls`) | Tenant id, user, request id | Available everywhere without request-scoped providers, which are slow in NestJS |
| Policy / permission guard | Every endpoint | `@RequirePermission('invoices:write')` + an own-records check; RBAC from `roles.permissions` |
| State machine (explicit transition table) | Appointments, invoices, lab orders, subscriptions, installments | Illegal moves rejected in one place; matches the DB checks |
| Strategy + Adapter | Payment gateways (Paymob, Fawry, Stripe), SMS/WhatsApp/email, file storage | Add or swap a provider without touching business code |
| Transactional outbox + workers (BullMQ) | Emails, reminders, site revalidation, webhooks out | A side effect is never lost or sent twice when a request fails halfway |
| Idempotency key | Booking submit, payments, webhooks in | Double-clicks and gateway retries do no harm |
| Domain events (in-process) | Cross-module reactions | Loose coupling inside the monolith |
| CQRS-lite (separate read queries, no event sourcing) | Calendar, reports, slot search, dashboard home | Fast SQL views for reads; writes go through the domain |
| Pure function / Specification | Availability engine | Slot calculation is the riskiest logic; a pure function is easy to test with hundreds of cases |
| Factory | Tenant seeding at signup (roles, consent and notification templates, default site) | One place builds a complete new clinic |
| Registry (type → component + schema) | Website sections, notification events | A new section or event is one entry, not edits everywhere |

###### 8.4 Request flow inside the API

&#91;embedded content: request flow inside the API · 7 layers, outbox path\]

If anything fails before COMMIT, the data and the outbox event roll back together, so no email goes out for a booking that was never saved.

###### 8.5 Repository structure

One monorepo (pnpm workspaces + Turborepo), so the API contract, DB schema and UI kit change together in one pull request.

```text
dental-saas/
  apps/
    api/          NestJS: main.ts (HTTP) + worker.ts (BullMQ consumers, cron)
    web/          Next.js: landing page + every clinic website
    dashboard/    React 19 + Vite: clinic dashboard + /admin
  packages/
    db/           SQL migrations (0001 = dental_saas_schema.sql), kysely-codegen types (db.d.ts), seeds
    contracts/    OpenAPI spec -> generated TS client + Zod schemas
    ui/           shared RTL-ready components (shadcn/ui), design tokens
    config/       tsconfig, eslint (incl. module-boundary rules), prettier
  docker-compose.yml   Postgres 16, Redis, MinIO, Mailpit
```

Inside each API module:

```text
apps/api/src/modules/scheduling/
  api/           controllers + request/response DTOs (HTTP only)
  application/   use cases: book-online.ts, confirm-appointment.ts
  domain/        appointment.ts (state machine), availability.ts (pure)
  infra/         appointment.repository.ts, read queries
  events/        appointment-completed.event.ts
  index.ts       the module's public API for other modules
```

###### 8.6 ORM and data access

| Option | Verdict | Reason |
| --- | --- | --- |
| **Kysely + plain SQL migrations** | **Chosen** | Queries read like SQL and are fully typed; `kysely-codegen` generates types from the live database, so the hand-written SQL schema stays the source of truth (exclusion constraints, triggers, RLS); dynamic filters and pagination are clean; raw `sql` tag for complex reports |
| Drizzle | Good, second | Wants to own the schema in TypeScript and cannot describe our constraints, triggers or RLS, so two schemas would drift |
| pg + pgTyped | Fine for a few fixed queries | Closest to pure SQL, but dynamic queries get awkward |
| Prisma / TypeORM | Rejected | Fight RLS, triggers and exclusion constraints |

Rules: migrations are plain SQL files run by `dbmate`, reviewed like code; after each migration `kysely-codegen` regenerates `db.d.ts` and CI fails if it is stale. Each request runs inside `db.transaction()`, which first executes `select set_config('app.tenant_id', $1, true)`. Every list endpoint uses keyset pagination. Report queries live in `infra/queries`, never in controllers.

###### 8.7 Frontend patterns

| Area | Pattern | Detail |
| --- | --- | --- |
| API contract | Contract-first codegen | NestJS generates OpenAPI; CI generates the TS client and Zod schemas; a breaking change fails the build |
| Dashboard server state | TanStack Query | No Redux; only auth and active tenant live in a small Zustand store |
| Dashboard forms | React Hook Form + Zod | The same Zod schema the API uses; Arabic and English error messages |
| Dashboard structure | Feature folders | `features/scheduling`, `features/billing`… mirroring API modules; permission guard per route |
| Clinic websites | Section registry | `{ hero: { component, schema }, services: {…} }`; pages render from `published_sections` JSON |
| Website caching | ISR + cache tags | Tags like `t:<tenantId>:catalog`; the worker calls `revalidateTag` on catalog save or Publish |
| RTL | Logical CSS | `dir` set per locale; Tailwind logical properties (`ms-`, `pe-`) instead of left/right |

###### 8.8 How to start the implementation

Start with one week of foundation, then a **walking skeleton** (the thinnest path from signup to a booked appointment, end to end), then grow it in vertical slices. Don't build CRUD screens for all 75 tables first: the risky parts (tenant isolation, availability, payments) must be proven early.

**Sprint 0 — foundation (week 1)**

- [x] Monorepo, lint + module-boundary rules, conventional commits, PR template
- [x] `docker compose up` gives Postgres 16, Redis, MinIO, Mailpit; `pnpm dev` runs all apps
- [x] `packages/db`: migration runner, schema v3 as migration 0001, seed script (2 demo clinics)
- [x] Tenant context: `nestjs-cls` + transaction interceptor running `SET LOCAL app.tenant_id`; app connects as `app_user` (no BYPASSRLS)
- [x] Integration test harness with Testcontainers; first test: tenant B cannot read tenant A
- [x] OpenAPI generation + client codegen wired into CI
- [x] Error format (RFC 9457 problem+json), structured logs with request and tenant id, Sentry
- [x] CI on GitHub Actions: lint, typecheck, tests, build; auto-deploy `main` to staging

**Walking skeleton (end of week 2)** — one ugly but real path: sign up → tenant seeded → add one branch, doctor and service → site live on a subdomain shows them → a patient books a slot → the clinic gets an email. Every layer exists, even if thin.

**Week-by-week MVP plan**

| Week | Vertical slice | Done when |
| --- | --- | --- |
| 1 | Sprint 0 foundation | Staging deploys from `main`; cross-tenant test passes in CI |
| 2 | Identity + tenancy + walking skeleton | Signup with OTP creates a seeded clinic; skeleton booking works end to end |
| 3 | Clinic setup + onboarding wizard | All 6 wizard steps save and resume; hours, holidays, doctor schedules editable |
| 4 | Website | Middleware resolves subdomains; 2 templates; section editor; Publish revalidates; catalog changes go live on save |
| 5 | Scheduling | Availability engine with 100+ unit cases; calendar day/week; holds; online booking with OTP; reminders via outbox |
| 6 | Patients + clinical | Patient profile, guardians, medical history, files, visits, prescriptions, consent signing |
| 7 | Billing + super admin | Invoices, cash payments, refunds, Arabic receipt PDF; super admin tenant list and suspend |
| 8 | Hardening + pilot | All MVP acceptance criteria pass; slot search load test; backup restore tested; first pilot clinic onboarded |

###### 8.9 Team conventions

- **ADRs:** each decision in this section becomes a short ADR in `docs/adr/` (context, decision, consequences).
- **Definition of done:** endpoint has permission check, validation, audit log entry where data is medical or financial, integration test, OpenAPI docs, Arabic and English strings.
- **Tests:** unit tests for domain logic (availability, state machines, money); integration tests against real Postgres for repositories, RLS and triggers; a few Playwright end-to-end tests for signup and booking. No mocking of the database.
- **Branching:** trunk-based with short-lived branches; feature flags per plan (`plans.features`) for unfinished work.
- **Code review:** every PR touching auth, tenancy, billing or migrations needs a second reviewer.

###### 8.10 What not to do (yet)

- Microservices, Kubernetes or event sourcing
- A separate database or schema per clinic
- GraphQL (REST + OpenAPI codegen is enough for one frontend team)
- A drag-and-drop website builder
- Generic “base repository / base service” classes that hide SQL; write explicit queries

###### 8.11 Code structure per module

Use standard NestJS modules by default and hexagonal architecture only where the business rules are hard. Payment and messaging providers always sit behind ports.

| Style | Modules | Why |
| --- | --- | --- |
| Standard NestJS module (controller → service → repository) | clinic-setup, website, patients, tenancy, identity, platform, notifications | Mostly CRUD with light rules; hexagonal here would add ports and mappers that do nothing |
| Hexagonal (domain at the centre, ports and adapters around it) | scheduling, billing | Availability, holds, state machines and money rules must be testable without HTTP or the database |
| Ports + adapters only | payment gateways, SMS/WhatsApp/email, file storage | Swap or add Paymob, Fawry, Stripe or an SMS provider without touching business code |

**Standard module**

```text
clinic-setup/
  clinic-setup.module.ts
  branches.controller.ts
  branches.service.ts        // rules + calls the repository
  branches.repository.ts     // Kysely queries
  dto/
  index.ts                   // public API for other modules
```

**Hexagonal module**

```text
billing/
  domain/                    // pure TypeScript: no NestJS, no Kysely
    invoice.ts               // state machine, totals rules
    money.ts
  application/               // use cases + ports
    issue-invoice.usecase.ts
    record-payment.usecase.ts
    ports/
      invoice.repository.port.ts
      payment-gateway.port.ts
  infrastructure/            // adapters
    kysely-invoice.repository.ts
    paymob.gateway.ts
    fawry.gateway.ts
  api/
    invoices.controller.ts
  billing.module.ts          // binds each port to its adapter
  index.ts
```

```ts
// application/ports/payment-gateway.port.ts
export interface PaymentGateway {
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
  verifyWebhook(raw: Buffer, headers: Record<string, string>): WebhookEvent;
}
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

// billing.module.ts
providers: [
  { provide: PAYMENT_GATEWAY, useClass: PaymobGateway },
  { provide: INVOICE_REPOSITORY, useClass: KyselyInvoiceRepository },
  IssueInvoiceUseCase,
]
```

Rules: `domain/` never imports NestJS, Kysely or HTTP code; modules talk only through `index.ts` or events; a standard module that grows hard rules later moves to hexagonal on its own. The database triggers stay the last line of defence; the domain layer checks the same rules first so users get clear error messages.

###### 8.12 Readiness checklist

| Item | Status |
| --- | --- |
| Functional and non-functional requirements with IDs | Ready |
| Appointment lifecycle, booking sequence, screen inventory | Ready |
| Database schema v3 reviewed and tested (incl. concurrency) | Ready |
| Architecture, patterns, data access (Kysely), code structure | Ready |
| Week-by-week MVP plan and Sprint 0 checklist | Ready |
| Open questions in 7.2 (prices, provider, hosting, legal drafts) | Need answers before weeks 4–7, not before Sprint 0 |
| API endpoint list | Generated from code (OpenAPI) during Sprint 0–2 |

---

## Part B — Approved new requirements

Rules that apply to every Part B requirement unless it says otherwise:

- **Tenant and branch.** Every record belongs to one clinic (RLS, NFR-01). Branch-scoped records also obey ACCESS-003.
- **Money.** Integer minor units plus the clinic currency, never floats. Totals, paid amounts, balances and
  statuses are derived by the database, never sent by the client (NFR-10).
- **Permissions** are checked by the API on every request (§2.3); the UI only hides what the API would refuse.
  Names are in B.1.
- **Errors** are RFC 9457 `application/problem+json` with a stable English `code`. The user sees the Arabic
  message for that code (L10N-003). Codes common to all requirements, not repeated below: `missing_permission`
  (403), `not_found` / `<entity>_not_found` (404), `validation_failed` (400, with field errors), `busy` (409,
  concurrent change; retry).
- **Audit.** Every financial and clinical change is audited (AUDIT-001…003).
- **Arabic text** is accepted in every free-text field (L10N-007).

### B.1 Permission catalogue

Permissions already in the code are marked ✓. New ones are introduced by v4. Role defaults follow the v3 matrix
(§2.2) where it covers the action. Where it does not, the default is **pending** the decision named, and until
it is decided only the owner (`*`) holds the permission.

| Permission | Meaning | Owner | Doctor | Receptionist | Assistant | Accountant |
| --- | --- | --- | --- | --- | --- | --- |
| `branches:read` ✓ / `branches:write` ✓ | Branches and hours | ✓ / ✓ | ✓ / — | ✓ / — | ✓ / — | ✓ / — |
| `settings:write` ✓ | Clinic profile, doctors, services, booking settings, holidays, rooms | ✓ | — | — | — | — |
| `website:write` ✓ | Website content | ✓ | — | — | — | — |
| `staff:manage` | Invite members, change roles and branches, disable | ✓ | — | — | — | — |
| `patients:read` ✓ / `patients:write` ✓ | Patient records | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / — | ✓ / — |
| `patients:merge` | Merge duplicates (§2.2 "Patients incl. merge") | ✓ | ✓ | ✓ | — | — |
| `patients:block` | Block a patient from online booking | ✓ | — | ✓ | — | — |
| `clinical:read` ✓ / `clinical:write` ✓ | Medical history, chart, visits, documents | ✓ / ✓ | ✓ / ✓ | ✓ / — | ✓ / — | — / — |
| `treatments:write:own` ✓ | Treatment plans and procedures for the doctor's own patients/visits | ✓ (all) | ✓ | — | — | — |
| `appointments:read` ✓ / `appointments:write` ✓ / `appointments:write:own` ✓ / `appointments:override` ✓ | Scheduling (unchanged) | ✓ | read, write:own | all four | read, write | read |
| `invoices:read` ✓ / `invoices:read:own` ✓ / `invoices:write` ✓ | Draft, issue | ✓ | read:own | read, write | — | read, write |
| `invoices:void` | Void an invoice (§2.2 column D) | ✓ | — | — | — | ✓ |
| `payments:write` ✓ | Record payments, create installment plans | ✓ | — | ✓ | — | ✓ |
| `payments:refund` | Refund a payment | ✓ | — | — | — | ✓ (CLR-05) |
| `payments:reverse` | Reverse a payment entered in error (PAY-003) | ✓ | — | ✓ own entry, same day (CLR-05) | — | — |
| `payments:adjust` | Waive / write off (PAY-006) | ✓ | — | — | — | pending CLR-12 |
| `discounts:apply` | Apply a discount within the role's limit (DISC-002) | ✓ | — | ✓ (limit) | — | ✓ (limit) |
| `discounts:approve` | Approve discounts above a limit | ✓ | — | — | — | pending CLR-02 |
| `expenses:read` / `expenses:write` ✓ | Expenses (§2.2: owner, accountant) | ✓ | — | — (owner 2026-10-20) | — | ✓ |
| `expenses:approve` | Approve expenses that need approval | ✓ | — | — | — | — (CLR-03) |
| `cash:operate` | Open and close the cash box | ✓ | — | pending CLR-04 | — | pending CLR-04 |
| `cash:reopen` | Reopen a closed cash day | ✓ | — | — | — | pending CLR-04 |
| `reports:read` ✓ / `reports:read:daily` ✓ / `reports:read:own` ✓ | Reports (§2.2) | ✓ | own | daily (own branch) | — | ✓ |
| `audit:read` ✓ | Audit trail | ✓ | — | — | — | — |

Separation rule: no seeded role other than the owner holds both a clinical write permission (`clinical:write`,
`treatments:write:own`) and a money-writing permission (`payments:*`, `discounts:*`, `invoices:write`,
`invoices:void`, `expenses:write`, `cash:*`).

### B.2 Identity and access

**AUTH-101 — Owner email verification at sign-up** · IMPLEMENTED (2026-10-17) · Phase C
- *Description:* A new owner confirms their **email address** with a 6-digit code before they can sign in. No SMS is
  sent (decision D-01, 2026-10-17). The phone number is collected and stored but not verified.
- *Role:* prospective owner (public).
- *Preconditions:* sign-up form submitted (AUTH-01); clinic provisioned (AUTH-03).
- *Behaviour:* the code goes to the sign-up email. It is valid 5 minutes, allows 5 tries, and at most 3 codes per
  10 minutes per address (the existing OTP policy). Sign-in is refused until the email is verified. Accounts that
  were verified by phone before this change stay valid (verified = email or phone verified).
- *Validation:* email format; code is 6 digits (Arabic-Indic digits accepted).
- *Permissions:* public, rate-limited.
- *Errors:* `otp_invalid`, `otp_expired`, `otp_locked`, `otp_rate_limited`, `email_not_verified` (at sign-in).
- *Acceptance:* (1) sign-up sends exactly one email with a code and no SMS; (2) sign-in before verification is
  refused with `email_not_verified`; (3) the right code signs the owner in; (4) the sixth wrong try is refused even
  with the right code; (5) production starts with no SMS provider configured.
- *Entities:* `users.email_verified_at`, `otp_codes` (`purpose = verify_email`), `auth_events`.

**AUTH-102 — Password reset by email** · IMPLEMENTED (2026-10-17) · Phase D1 (refines AUTH-06)
- *Description:* A member who forgot their password receives a 6-digit email code and sets a new password.
- *Role:* any member (public endpoint).
- *Behaviour:* the request always answers the same way whether or not the email exists (no account enumeration).
  On success the password changes and **every session of that user ends** (all refresh-token families revoked).
- *Validation:* same password rules as sign-up; code rules as AUTH-101.
- *Errors:* `otp_invalid`, `otp_expired`, `otp_locked`, `otp_rate_limited`, `weak_password`.
- *Acceptance:* (1) an unknown email gets the same response as a known one; (2) after reset, old refresh tokens
  are refused; (3) `auth_events` records `password_reset`.
- *Entities:* `users`, `otp_codes` (`reset_password`), `refresh_tokens`, `auth_events`.

**ACCESS-001 — Staff invitation by email** · IMPLEMENTED (2026-10-17) · Phase D1 (refines AUTH-08)
- *Description:* The owner invites a staff member by email with a role and branch access.
- *Role:* owner (`staff:manage`); invitee.
- *Preconditions:* the clinic is under its plan's `staff` limit.
- *Behaviour:* the invitation holds email, role, branches (all or a list) and an optional job title, and can link
  to an existing doctor record (`doctors.member_id`). The link token is stored hashed and expires after 7 days.
  The invitee opens the link, creates an account (email verified by the same link) or signs in, and becomes an
  active member. The owner can revoke a pending invitation.
- *Validation:* email; role exists in the clinic; branches belong to the clinic; doctor not already linked.
- *Errors:* `invitation_invalid` (one answer for wrong, used, revoked or expired links, so a link reveals nothing), `invitation_pending`, `already_member`, `plan_limit_reached` (`staff` = active members + open invitations), `doctor_already_linked`, `invalid_credentials` (existing account, wrong password; the link stays usable).
- *Acceptance:* (1) an invited receptionist signs in and sees only what the receptionist role allows; (2) an
  expired or revoked link does nothing; (3) a token from clinic A can never join clinic B; (4) the invitation and
  acceptance are audited.
- *Entities:* `invitations`, `tenant_members`, `member_branches`, `users`, `doctors.member_id`, `audit_log`.

**ACCESS-002 — Member management** · IMPLEMENTED (2026-10-17) · Phase D1
- *Description:* The owner lists members, changes a member's role and branches, and disables or re-enables them.
- *Behaviour:* the last active owner cannot be disabled or demoted. Changes take effect per ACCESS-005 and are audited.
- *Errors:* `last_owner`, `plan_limit_reached` (re-enable).
- *Acceptance:* (1) a disabled member's next request is refused; (2) a role change is visible in the audit trail.
- *Entities:* `tenant_members`, `roles`, `member_branches`, `audit_log`.

**ACCESS-003 — Branch-scoped access** · IMPLEMENTED (2026-10-17; cash sessions join in Phase E) · Phase C (SRS §2.3)
- *Description:* A member with `all_branches = false` sees and changes only records of their assigned branches.
- *Scope:* appointments, visits, invoices, payments, refunds, installment plans, expenses, cash sessions, branch
  settings, and branch-filtered reports. **Patients are clinic-wide** (in the v3 schema a patient has no branch).
  A branch-limited member finds any patient of the clinic, but sees only the appointments, visits and invoices of
  their branches on the profile.
- *Behaviour:* enforced in the API for every list, read and write, and backed by a database helper so a missed
  filter is caught by tests. Reading a single record of another branch answers 404. Choosing another branch in a
  filter or a write answers 403.
- *Errors:* `branch_forbidden` (403).
- *Acceptance:* (1) a receptionist limited to branch A cannot list, open, book, pay or close cash in branch B;
  (2) the same receptionist can find a patient registered at branch B, but not that patient's branch-B invoices;
  (3) all-branch members are unaffected; (4) automated tests cover each scoped resource.
- *Entities:* `tenant_members.all_branches`, `member_branches`, all branch-scoped tables.

**ACCESS-004 — Permission catalogue and clinical/financial separation** · IMPLEMENTED (2026-10-17) · Phase C
- *Description:* Permissions and role defaults are exactly those of B.1. The database function
  `default_role_permissions()` and existing clinics' seeded roles are updated to match, without removing any right
  a role already has.
- *Acceptance:* (1) the seeded doctor role cannot record a payment; (2) the seeded accountant cannot read medical
  history; (3) a test compares B.1 with `default_role_permissions()`.
- *Entities:* `roles.permissions`, `default_role_permissions()`.

**ACCESS-005 — Access changes take effect on the next request** · IMPLEMENTED (2026-10-17) · Phase D1
- *Description:* Disabling a member, changing their role or changing their branches takes effect on their next API
  request, not when their 15-minute access token expires.
- *Acceptance:* (1) after the owner disables a member, that member's very next request answers 401/403;
  (2) a role downgrade removes the rights on the next request.
- *Entities:* `tenant_members`, `roles`, access token claims.

**ACCESS-006 — Roles the owner creates** · IMPLEMENTED (2026-10-20, H4) · Phase H
- *Description:* A clinic's roles are its own. Sign-up creates one role, the owner, holding every permission (`*`);
  it is the only fixed role. The owner creates every other role — an Arabic name and any permissions of the B.1
  catalogue except `*` — and changes or deletes it at any time. Clinics created before 2026-10-20 keep their doctor,
  receptionist, assistant and accountant roles as ordinary roles (same members and permissions, minus the unused
  `inventory:*` and `subscription:read`). A role nobody ever held is deleted; one that members or invitations
  referred to is archived (kept, given to nobody new). Every page and menu item of the dashboard shows
  only to members whose permissions open it, and the API checks every request against the member's role.
- *Rules (owner 2026-10-20):* `staff:manage` may be given to a custom role. A member who is not the owner gives only
  permissions they hold, cannot change their own role or status nor edit the role they hold, and cannot give or take
  the owner role. A permission needs those its screens read first (e.g. `patients:write` needs `patients:read`).
  A role that both writes clinical records and money (B.1 separation rule) is allowed with a warning.
- *Behaviour:* editing a role's permissions applies to its members on their next request (ACCESS-005).
- *Permissions:* `staff:manage`.
- *Errors:* `owner_role_fixed`, `role_archived`, `role_in_use`, `role_name_taken`, `permission_unknown`, `permission_requires`,
  `permission_not_held`, `own_role`, `owner_role_only`.
- *Entities:* `roles` (+ `archived_at`, `updated_at`), `grantable_permissions()`, `roles_guard`, `roles_bump_access`.

### B.3 Scheduling and reception

**APPT-001 — Reschedule** · IMPLEMENTED (2026-10-17) · Phase D2
- *Description:* Reception moves a `pending` or `confirmed` appointment to another time, doctor or branch.
- *Role:* receptionist, owner (`appointments:write`).
- *Behaviour:* the same appointment record changes (it keeps its id). The same rules as a staff booking apply
  (APPT-002): inside the doctor's schedule, or outside it with an override reason and `appointments:override`.
  The old and new times are audited. Queued reminders for the old time are cancelled and new ones scheduled. If
  the **date** changes, an unused reception code is cleared and a new code is emailed to the patient when they have
  an email. A final appointment (completed, cancelled, no-show, expired) is never moved; a new booking is made instead.
- *Errors:* `invalid_transition`, `slot_taken`, `outside_schedule`, `doctor_not_at_branch`, `doctor_inactive`.
- *Acceptance:* (1) moving onto a taken slot answers 409 and changes nothing; (2) two receptionists moving two
  bookings into the same slot at once: exactly one succeeds; (3) the patient's reminder fires for the new time only.
- *Entities:* `appointments`, `notifications`, `outbox_events`, `audit_log`.

**APPT-002 — Staff booking validation** · IMPLEMENTED (2026-10-17) · Phase C
- *Description:* A staff booking or move is accepted only for an **active** doctor who **works at the chosen
  branch**, and an active service when one is given. This holds even with an override reason. The override relaxes
  the schedule, never the doctor/branch rule.
- *Errors:* `doctor_inactive`, `doctor_not_at_branch`, `service_not_found`.
- *Acceptance:* (1) an override booking for a doctor not assigned to the branch is refused; (2) the same for a
  deactivated doctor.
- *Entities:* `appointments`, `doctors`, `doctor_branches`.

**APPT-003 — Waiting list** · IMPLEMENTED (2026-10-17) · Phase D2
- *Description:* Per branch, today's checked-in patients in order of arrival, with waiting time, doctor and service.
- *Behaviour:* a doctor calls the next patient in (status `checked_in → in_progress`, which opens the visit,
  VISIT-001). The list updates without a page reload (polling is enough).
- *Acceptance:* (1) a checked-in patient appears at the bottom with a running waiting time; (2) when called in,
  they leave the list and appear "with the doctor".
- *Entities:* `appointments.checked_in_at`, status.

**APPT-004 — Doctor's day** · IMPLEMENTED (2026-10-17; CLR-10 default: the whole schedule stays readable) · Phase D2
- *Description:* A member linked to a doctor record opens on "my appointments today", including who is waiting
  for them. Whether doctors may also read the whole clinic schedule is pending CLR-10 (today: they can).
- *Entities:* `appointments`, `doctors.member_id`.

**APPT-005 — Holidays and doctor time off** · IMPLEMENTED (2026-10-17) · Phase D2
- *Description:* The owner adds closed dates (one branch or all branches) and a doctor's time off (date-time range
  with a reason). Availability already honours both.
- *Behaviour:* adding a holiday or time off over existing appointments is allowed, but those appointments are not
  cancelled automatically. The screen lists the conflicting appointments so reception can move or cancel them.
- *Validation:* end after start; branch in the clinic.
- *Acceptance:* (1) a new holiday removes that day's free slots on the website at once; (2) conflicting
  appointments are listed, not changed.
- *Entities:* `holidays`, `doctor_time_off`.

**APPT-006 — Rooms and chairs** · IMPLEMENTED (2026-10-17) · Phase D2
- *Description:* The owner defines rooms/chairs per branch. Reception may assign a room when booking or later. The
  database refuses two overlapping bookings in one room and a room of another branch (existing constraints).
- *Errors:* `slot_taken` (room), `room_not_in_branch`.
- *Entities:* `rooms`, `appointments.room_id`.

**APPT-007 — Follow-up booking from a visit** · IMPLEMENTED (2026-10-17, D4) · Phase D4
- *Description:* From a visit, staff book the next appointment pre-filled with patient, doctor, branch and the
  next planned treatment item. Booking a planned item links it (`treatment_plan_items.appointment_id`, status `scheduled`).
- *Entities:* `appointments`, `treatment_plan_items`, `visits.next_visit_note`.

**APPT-009 — Booking settings screen** · IMPLEMENTED (2026-10-17; the cancel window waits for BOOK-08) · Phase D2 (refines DSH-12)
- *Description:* The owner edits auto-confirm, website verification code on/off, minimum notice, booking horizon,
  slot step and reminder times. The values and limits are those already enforced by `tenant_settings` CHECKs.
- *Permissions:* `settings:write`.
- *Entities:* `tenant_settings`.

*(APPT-008 — withdrawn before use; appointment auditing is AUDIT-003.)*

### B.4 Patients

**PATIENT-001 — Arabic-normalised search** · IMPLEMENTED (2026-10-17, D3) · Phase D
- *Description:* Name search ignores the spelling variants Egyptian staff type interchangeably.
- *Behaviour:* the stored name and the query are both normalised: أ إ آ ٱ → ا; ة → ه; ى → ي; ؤ → و; ئ → ي; tatweel
  (ـ) and diacritics removed; spaces collapsed. Existing phone and file-number search, and Arabic-Indic digits,
  are unchanged.
- *Acceptance:* "احمد" finds "أحمد"; "فاطمه" finds "فاطمة"; "مصطفي" finds "مصطفى"; "محمّد" finds "محمد"; search stays
  index-backed (no full scan on 50 000 patients).
- *Entities:* `patients.full_name` (+ a normalised, indexed column).

**PATIENT-002 — Possible-duplicate warning** · IMPLEMENTED (2026-10-17, D3) · Phase D
- *Description:* Before a new patient is saved, reception sees existing patients with the same phone (main,
  alternative or guardian) or a closely matching normalised name with the same birth date.
- *Behaviour:* a warning, never a block (families share phones, §6.5). The receptionist opens the existing record
  or confirms "new patient".
- *Acceptance:* entering an existing patient's phone shows that patient before saving.

**PATIENT-003 — Merge duplicates** · IMPLEMENTED (2026-10-17, D5; CLR-15 default) · Phase D (refines DSH-03)
- *Description:* Two records of the same person become one.
- *Role:* `patients:merge`.
- *Behaviour:* the user picks the surviving record. Appointments, visits, chart entries, plans, prescriptions,
  documents, invoices, payments, installment plans and follow-ups of the other record move to it. The other record
  gets `merged_into_id` and disappears from lists. The merge is audited and is not reversible from the UI. Medical
  history (CLR-15): allergies, conditions and medications are combined; the survivor's other fields are kept, and the
  differences are listed before the user confirms.
- *Errors:* `already_merged`, `merge_self`.
- *Acceptance:* (1) after a merge, the survivor's balance equals the sum of both balances; (2) no row still points
  at the merged record except `merged_into_id`.
- *Entities:* `patients` and every table with `patient_id`.

**PATIENT-004 — Clinical documents and images** · IMPLEMENTED for the patient (2026-10-17, D3; attaching a file to a visit is not built yet: `patient_files.visit_id` exists, no screen sets it) · Phase D
- *Description:* Staff with `clinical:write` upload X-rays, clinical photos and documents (JPEG, PNG, WebP, PDF) to a
  patient, optionally to a visit.
- *Behaviour:* the content is checked by the server whatever the file name says, and the size is capped. Files are
  always private and opened only through short-lived signed links issued to members with `clinical:read`. Every
  view or download is audited. Clinical files are never hard-deleted; they can be archived (hidden) with a reason.
- *Errors:* `unsupported_file_type`, `file_too_large`.
- *Acceptance:* (1) a link copied after 5 minutes no longer works; (2) an accountant cannot obtain a link;
  (3) another clinic's member can never open one.
- *Entities:* `files` (kinds `xray`, `clinical_photo`, `document`; private by CHECK), `patient_files`, `audit_log`.

**PATIENT-005 — Medical history versions and alerts** · IMPLEMENTED (versions and profile alerts D3; visit-screen alert D4, 2026-10-17) · Phase D
- *Description:* Every save of medical history keeps the previous version (who, when, what). Allergies and
  important conditions are shown prominently whenever a doctor opens the patient or a visit.
- *Acceptance:* (1) after two edits, both earlier versions can be viewed; (2) an allergy is visible on the visit
  screen without scrolling.
- *Entities:* `patient_medical_history` (+ a versions table).

### B.5 Clinical

**VISIT-001 — Clinical visit** · IMPLEMENTED (2026-10-17, D4) · Phase D (refines DSH-06)
- *Description:* The doctor's workspace for one visit: chief complaint, diagnosis, clinical notes, next-visit
  note, with medical history and alerts visible.
- *Role:* doctor (own appointments), owner.
- *Preconditions:* an appointment of this doctor in `checked_in` or `in_progress`; or a walk-in visit without an
  appointment, started by the doctor.
- *Behaviour:* opening the visit moves the appointment to `in_progress`. There is one visit per appointment
  (existing unique rule). The visit's patient, doctor and branch are those of the appointment, and the database
  refuses a mismatch (SEC-101).
- *Errors:* `visit_exists`, `appointment_not_in_progress`, `not_your_appointment`.
- *Acceptance:* (1) a doctor cannot open a visit on another doctor's appointment; (2) receptionists can see that a
  visit exists but cannot write it; (3) accountants cannot read it.
- *Entities:* `visits`, `appointments`.

**VISIT-002 — Finalize and amend clinical notes** · IMPLEMENTED (2026-10-17, D4; CLR-06 default) · Phase D
- *Description:* A visit note is a draft until finalized. After finalization it is never overwritten. A change is an
  **amendment**: the new text, reason, author and time, with the original kept and both visible.
- *Behaviour:* when a note becomes final, and who may amend, are decided in CLR-06. Whatever is decided, the
  database refuses an update to a finalized note.
- *Errors:* `visit_finalized`, `amendment_reason_required`.
- *Acceptance:* (1) a direct update of a finalized note fails in the database; (2) the visit shows the original
  and every amendment in order.
- *Entities:* `visits` (+ finalization columns, amendments table).

**VISIT-003 — Procedures performed** · IMPLEMENTED (2026-10-17, D4; CLR-16 default) · Phase D
- *Description:* The doctor records what was done: service, tooth (FDI) and surfaces, notes, optionally the plan item.
- *Behaviour:* linking a plan item marks it done (TPLAN-003). The procedure's price comes from the service (rule
  pending CLR-16). Once billed on a non-void invoice it cannot be billed again (existing trigger), and it becomes
  read-only once that invoice is issued.
- *Errors:* `procedure_billed`, `plan_item_mismatch` (item of another patient).
- *Entities:* `visit_procedures`, `treatment_plan_items`, `services`.

**VISIT-004 — Prescriptions** · IMPLEMENTED (2026-10-17, D4); printing from Chrome, Edge and Safari not yet verified on paper · Phase D
- *Description:* The doctor writes a prescription in a visit: drug, dose, frequency, duration, instructions.
- *Behaviour:* the printout is Arabic, RTL, with clinic header and logo, branch address and phone, doctor name and
  title, patient name, age and file number, and date. Drug names written in Latin letters display correctly inside
  Arabic text. An issued prescription is not edited; a corrected one is issued instead and the old one is kept.
- *Acceptance:* the printout fits A5 and A4 and prints correctly from Chrome, Edge and Safari.
- *Entities:* `prescriptions`, `prescription_items`.

**VISIT-005 — Follow-up list (manual)** · IMPLEMENTED (2026-10-17, D4) · Phase D (replaces DSH-19 for v4)
- *Description:* Doctors or reception add a follow-up for a patient (reason, due date, note). Reception works the
  list of due and overdue follow-ups: record a call (note, attempts), book (links the appointment), or dismiss.
- *Behaviour:* **no automatic messages**. Calls are made by staff (Part D: WhatsApp/SMS). Reasons: check-up,
  cleaning, orthodontic adjustment, post-operative, implant follow-up, other.
- *Entities:* `recalls`.

**CHART-001 — Dental chart** · IMPLEMENTED (2026-10-17, D4) · Phase D (refines DSH-04)
- *Description:* FDI chart, permanent 11–48 and primary 51–85, per tooth and surface (M, O, D, B, L, I, F, P) with
  conditions (healthy, caries, filled, crown, bridge, missing, implant, root canal, fractured, extraction needed,
  veneer, sealant, other).
- *Behaviour:* every entry is appended (existing append-only rule). The current chart is the latest entry per
  tooth, and the history per tooth is viewable. Entries made during a visit link to it. **The chart is never
  mirrored by RTL**: it keeps the standard dental orientation (patient's right on the viewer's left), with Arabic labels.
- *Permissions:* read `clinical:read`; write `clinical:write`.
- *Acceptance:* (1) a correction adds a row, it never edits one; (2) the chart looks the same in RTL as in a
  standard dental chart.
- *Entities:* `tooth_records`.

### B.6 Treatment plans (feature F6)

**TPLAN-001 — Create and edit a treatment plan** · IMPLEMENTED (2026-10-17, D4) · Phase D (refines DSH-05)
- *Description:* A doctor builds a plan of items (service, tooth, surfaces, estimated price) for a patient.
- *Behaviour:* the plan estimate is the sum of its items (price − item discount), **derived by the database**
  (SEC-101), never typed. A discount on a plan item is an estimate only. When that item is invoiced, the discount
  becomes an invoice-line discount and needs DISC-002 authorization at that moment.
- *Permissions:* `treatments:write:own` (doctor, own patients' plans); owner all; others read.
- *Entities:* `treatment_plans`, `treatment_plan_items`.

**TPLAN-002 — Plan status** · IMPLEMENTED (2026-10-17, D4; CLR-11 default) · Phase D
- *Description:* `draft → proposed → accepted → in_progress → completed`, or `cancelled` from any non-final status.
  `accepted` records when and by whom the patient agreed (how: CLR-11). The first performed item moves an accepted
  plan to `in_progress`. The plan completes when every item is done or cancelled.
- *Errors:* `invalid_transition`.

**TPLAN-003 — Planned vs. performed** · IMPLEMENTED (2026-10-17, D4) · Phase D
- *Description:* Planned items and performed procedures are separate records. An item is `planned`, `scheduled`
  (has an appointment), `done` (a procedure links to it) or `cancelled`. The plan shows completed and remaining
  items and the remaining estimate.
- *Acceptance:* (1) recording a procedure for a planned item marks it done; (2) a cancelled item stays visible as
  cancelled (items are never deleted once the plan is accepted).

**TPLAN-004 — Plan summary** · IMPLEMENTED (2026-10-19, H1: invoiced, paid and balance per plan; D4: estimate, done, remaining, next recommended visit; invoiced, paid and balance come with billing in Phase E) · Phase D/E
- *Description:* For a plan: total estimate, invoiced so far, paid so far, the patient's balance (BILLING-005),
  remaining estimate, and the next recommended visit (next planned item and the doctor's next-visit note).
- *Entities:* plans, procedures, invoices, payments.

### B.7 Billing (invoices)

**BILLING-001 — Draft invoice** · IMPLEMENTED (2026-10-17, E1; line discounts E2) · Phase E
- *Description:* Reception or the accountant drafts an invoice from a visit's unbilled procedures, or from service
  lines for a walk-in, for one patient and one branch, in the clinic currency.
- *Behaviour:* lines hold a description (Arabic), quantity, unit price and line discount. Totals are derived by
  the database. A procedure can be on only one non-void invoice (existing trigger).
- *Permissions:* `invoices:write`.
- *Entities:* `invoices`, `invoice_items`, `visit_procedures`.

**BILLING-002 — Issue an invoice** · IMPLEMENTED (2026-10-17, E1; pending-discount refusal E2) · Phase E
- *Description:* Issuing gives the invoice its number and date and locks it.
- *Behaviour:* the number is `{prefix}-{year}-{sequence}` from `tenant_settings.invoice_prefix` and a gap-free
  per-clinic counter, assigned by the database in the issuing transaction. After issue the lines, discounts, tax,
  currency and patient cannot change (existing triggers). Tax uses `tenant_settings.tax_rate_bp` (default 0).
  Egyptian e-invoicing is out of scope (v3 §7.2 open question). An invoice with a pending discount approval
  cannot be issued (DISC-003).
- *Errors:* `invoice_empty`, `discount_pending_approval`, `invoice_locked`.
- *Acceptance:* (1) two invoices issued at the same moment get consecutive numbers with no gap and no duplicate;
  (2) editing an issued line fails in the database.
- *Entities:* `invoices`, `tenant_counters`, `tenant_settings`.

**BILLING-003 — Void an invoice** · IMPLEMENTED (2026-10-17, E1) · Phase E
- *Description:* An invoice issued by mistake is voided with a reason. It is never deleted.
- *Behaviour:* allowed only when nothing is paid (refund first, existing rule). A voided invoice's procedures can be
  billed again.
- *Permissions:* `invoices:void`.
- *Errors:* `invoice_has_payments`, `void_reason_required`.

**BILLING-004 — Printable invoice and receipt (Arabic)** · IMPLEMENTED (2026-10-17, E1; A4 invoice, A5 receipt per CLR-17); printing on paper not yet verified · Phase E
- *Description:* An Arabic RTL invoice and a receipt per payment, printed from the browser (no paid PDF service).
- *Content:* clinic name and logo, branch address and phone, invoice number and date, patient name and file number,
  lines, discounts, tax, total, paid, balance; on the receipt the amount, method, reference, date, receiver and
  remaining balance. Paper format (CLR-17): A4 invoice and A5 receipt from the browser; thermal printers later.
- *Acceptance:* Arabic, numbers and currency print correctly; nothing is cut off on the chosen paper size.

**BILLING-005 — Patient balance** · IMPLEMENTED (2026-10-19, H1: also at check-in and on the day list; E1: profile and payment screen) · Phase E
- *Description:* A patient's outstanding balance is the sum of balances of their issued, non-void invoices (derived,
  never stored by the client). It is shown on the patient profile, at check-in and on the payment screen to members
  with `invoices:read` (doctors: their own patients, `invoices:read:own`).
- *Entities:* `invoices.balance_minor`.

### B.8 Payments (features F1, F2)

**PAY-001 — Record a payment** · IMPLEMENTED (2026-10-17, E1; recorded at the current time — dating a payment and the cash-day rule come with CASH-* in E3) · Phase E
- *Description:* Reception or the accountant records money received against an issued invoice or an installment.
- *Methods offered:* cash (نقدي), bank transfer (تحويل بنكي), card (بطاقة), electronic wallet (محفظة إلكترونية),
  InstaPay (إنستاباي). (`online` and `insurance` exist in the database for later and are not offered.) This is
  recording only: no gateway, bank or wallet connection, and no automatic matching.
- *Behaviour:* the payment records method, amount, date and time (default now), a reference where it applies,
  notes, the branch (the invoice's branch), and the **staff member who received it (always the signed-in member,
  never chosen)**. A double click cannot record it twice (idempotency key). Whether a cash payment can be dated in
  a closed cash day is pending CLR-04.
- *Validation:* amount > 0 and ≤ the balance (invoice or installment); invoice issued or partially paid; currency =
  invoice currency; patient = invoice patient. A reference is required for bank transfer, wallet and InstaPay,
  optional for card (e.g. approval code), absent for cash.
- *Permissions:* `payments:write`.
- *Errors:* `amount_exceeds_balance`, `invoice_not_payable`, `reference_required`, `cash_session_closed` (CASH-*).
- *Acceptance:* (1) two receptionists paying the same invoice at the same second cannot overpay (existing DB test);
  (2) a wallet payment without a reference is refused; (3) the receipt shows who received the money.
- *Entities:* `payments` (+ `reference` column and responsible-staff FK, see database design).

**PAY-002 — Partial and multiple payments** · IMPLEMENTED (2026-10-17, E1) · Phase E
- *Description:* An invoice can be paid in any number of payments. The invoice shows its payment history and the
  remaining balance, and its status is issued → partially paid → paid (derived).
- *Acceptance:* paying 300 then 700 of a 1 000 invoice shows two payments and status *paid*; the balance never
  disagrees with the sum of payments minus refunds (database-derived).

**PAY-003 — Recorded payments are immutable** · IMPLEMENTED (database C; reversal E1, 2026-10-17) · Phase C/E
- *Description:* Nobody, through any path including direct database access by the API role, can change a recorded
  payment's amount, currency, method, date, patient, invoice, installment or receiver, or delete it.
- *Behaviour:* mistakes are corrected only by a **reversal** (a payment entered in error, marked reversed with a
  reason, keeping the original visible) or a **refund** (money actually returned, PAY-005), followed by a new
  correct payment. Who may reverse and until when is pending CLR-05.
- *Acceptance:* `UPDATE payments SET amount_minor = …` and `DELETE FROM payments` run as the API role fail in the
  database; the reversal appears in the payment history and the audit trail.
- *Entities:* `payments` (+ reversal fields), `audit_log`.

**PAY-004 — Installment plans** · IMPLEMENTED for invoices (2026-10-17, E2; a plan on a treatment plan before invoicing is not built) · Phase E (refines DSH-18)
- *Description:* An issued invoice, or a treatment plan, is split into a down payment and dated installments.
- *Behaviour:* the schedule is proposed from a start date and count (monthly) and can be edited before saving. The
  installments plus the down payment must equal the plan total, which must equal the invoice total when there is an
  invoice (database rule, SEC-101). Paying an installment also pays its invoice. An installment is overdue when it
  is unpaid after its due date. The plan completes when all installments are paid. Changing the dates or amounts of
  unpaid installments later is audited. Waiving is PAY-006.
- *Permissions:* `payments:write`.
- *Errors:* `installments_total_mismatch`, `installment_invoice_mismatch`.
- *Acceptance:* (1) a schedule that does not add up is refused by the database; (2) the overdue list shows an
  installment the day after its due date.
- *Entities:* `payment_plans`, `installments`, `payments`.

**PAY-005 — Refunds** · IMPLEMENTED (2026-10-17, E1; CLR-05; cash refunds reduce expected cash since E3) · Phase E
- *Description:* Money returned to a patient against a succeeded payment.
- *Behaviour:* the refund records amount, reason, refund method, date, branch and the staff member. Total refunds
  never exceed the payment, and concurrent refunds are serialized (existing trigger). The invoice balance reopens.
  Cash refunds reduce the expected cash of the cash day (CASH-002). Whether a refund must use the payment's method
  is pending CLR-05.
- *Permissions:* `payments:refund`.
- *Errors:* `refund_exceeds_payment`, `payment_not_refundable`, `reason_required`.
- *Entities:* `refunds` (+ method, branch, responsible-staff FK).

**PAY-006 — Authorized adjustments** · IMPLEMENTED (2026-10-17, E2; CLR-12: installment waiver and invoice write-off, owner only, no credit notes) · Phase E
- *Description:* An authorized person reduces what a patient owes without receiving or returning money (for example
  waiving an installment or writing off a small remainder). It is never an edit of a payment or an issued invoice.
  The exact forms (waiver, write-off, credit note) are decided in CLR-12.

### B.9 Discounts (feature F4)

**DISC-001 — Fixed and percentage discounts with a reason** · IMPLEMENTED (2026-10-17, E2) · Phase E
- *Description:* A discount on an invoice line or on the whole invoice, as a fixed amount or a percentage, always
  with a reason.
- *Behaviour:* a percentage is stored as basis points and converted to an amount when applied. Rounding is to the
  nearest minor unit, half up. Both the percentage and the amount are kept. Discounts can be applied only to a draft
  invoice (issued invoices are locked).
- *Validation:* amount ≤ the line or invoice subtotal; percentage 0–100 %; reason required.
- *Permissions:* `discounts:apply` (within limit, DISC-002).
- *Errors:* `discount_exceeds_subtotal`, `discount_reason_required`.
- *Entities:* `invoices`, `invoice_items` (+ discount type, percentage, reason, approver).

**DISC-002 — Authorization limits** · IMPLEMENTED (2026-10-17, E2; CLR-02: receptionist 10 %, accountant 20 %, others 0, owner unlimited; the owner changes them) · Phase E
- *Description:* Each role has a maximum discount the owner configures (a percentage of the invoice, optionally a
  maximum amount). Values are settings, not code. **Until the owner sets them, non-owner roles have a limit of 0**:
  any discount they enter needs approval.
- *Acceptance:* a receptionist with a 10 % limit applies 10 % directly; 11 % becomes a pending approval.

**DISC-003 — Discount approval** · IMPLEMENTED (2026-10-17, E2; CLR-02: in-app queue, the owner approves, the accountant does not) · Phase E
- *Description:* A discount above the applier's limit is pending until a member with `discounts:approve` approves or
  rejects it with a note. An invoice with a pending discount cannot be issued. Every request, approval and rejection
  is audited. Approving one's own discount request is not allowed.
- *Errors:* `discount_pending_approval`, `self_approval`.

### B.10 Expenses (feature F3)

**EXP-001 — Record an expense** · IMPLEMENTED (2026-10-20, H2: the supporting document; E3: everything else) · Phase E (refines DSH-08)
- *Description:* An expense with branch, category, description, amount, date, payment method (cash, bank transfer,
  card, wallet, InstaPay), reference, optional supplier and optional supporting document.
- *Behaviour:* the responsible staff member is the signed-in member who records it. The supporting document is
  private (image or PDF, same checks as PATIENT-004). It is attached when the expense is recorded or later, once, while
  the expense is not void, by a member with `expenses:write` (owner, accountant); it is never replaced or
  removed (void and record again). Expenses are separate from patient invoices and payments and never change a
  patient's balance.
- *Validation:* amount > 0; date not in the future; branch and category in the clinic; reference rules as PAY-001.
- *Permissions:* `expenses:write`.
- *Entities:* `expenses` (+ method, reference, status, approver, responsible-staff FK), `files`.

**EXP-002 — Expense categories** · IMPLEMENTED (2026-10-17, E3) · Phase E
- *Description:* Each clinic starts with categories in Arabic: rent (إيجار), salaries (رواتب), supplies (مستلزمات),
  equipment (أجهزة ومعدات), laboratory (معامل), utilities (كهرباء ومياه وإنترنت), maintenance (صيانة), other (أخرى).
  The owner adds or renames categories. A category in use is deactivated, not deleted.
- *Entities:* `expense_categories` (+ `is_active`).

**EXP-003 — Expense approval** · IMPLEMENTED (2026-10-17, E3; CLR-03; reception part removed 2026-10-20) · Phase E
- *Description:* An expense that needs approval is pending until a member with `expenses:approve` approves or rejects
  it. Which expenses need approval is decided in CLR-03: the owner's and the accountant's are approved on entry.
  Since 2026-10-20 (owner) reception records no expenses, so nothing new waits; expenses reception recorded before
  that still wait for the owner.
  Approving one's own expense is not allowed. A pending or rejected cash expense still counts on its cash day: the
  cash left the drawer either way; only voiding (recorded in error) changes the day.
- *Errors:* `self_approval`.

**EXP-004 — Expense corrections** · IMPLEMENTED (2026-10-17, E3) · Phase E
- *Description:* An approved expense is not edited. A wrong one is voided with a reason and recorded again. Voided
  expenses stay visible.
- *Errors:* `expense_locked`, `void_reason_required`.

### B.11 Daily cash reconciliation (feature F5)

The unit of reconciliation is one session per branch per business day (**CLR-04**, answered 2026-10-17): a movement
belongs to the session of its branch and its business date in the clinic's time zone.

**CASH-001 — Open a cash session** · IMPLEMENTED (2026-10-17, E3) · Phase E
- *Description:* A member with `cash:operate` opens the session with the counted opening cash. The previous
  session's counted closing cash is proposed.
- *Errors:* `session_already_open`.
- *Entities:* new `cash_sessions`.

**CASH-002 — Expected cash** · IMPLEMENTED (2026-10-17, E3) · Phase E
- *Description:* Expected cash = opening cash + **cash** payments received − **cash** refunds paid − expenses paid
  **in cash**, all within the session. It is computed from recorded transactions, never typed. Non-cash payments
  (card, bank transfer, wallet, InstaPay) are listed per method beside it and are not part of expected cash.
- *Acceptance:* a 500 cash payment, a 200 card payment and a 100 cash expense on an opening of 1 000 give expected
  cash 1 400, with card 200 shown separately.

**CASH-003 — Close a cash session** · IMPLEMENTED (2026-10-17, E3) · Phase E
- *Description:* The member counts the cash and enters the actual amount. The system shows difference = actual −
  expected. A note is required when the difference is not zero. The session records who closed it and when, and is
  then locked: its transactions can no longer change.
- *Errors:* `difference_note_required`, `session_closed`.

**CASH-004 — Reopen a closed session** · IMPLEMENTED (2026-10-17, E3; CLR-04) · Phase E
- *Description:* Reopening, if allowed, needs `cash:reopen` and a reason. It is audited, and the earlier closing
  figures stay in the history.

### B.12 Reports and dashboard home

Reports are computed from recorded transactions, by branch, for a date range in the branch's timezone. Members see
only their branches (ACCESS-003). Every report screen has a print layout (Arabic RTL).

| ID | Report | Content | Permission | Status |
| --- | --- | --- | --- | --- |
| REPORT-001 | Revenue and collections | Invoiced (issued) amount; collections by method; refunds; net collections; per branch and day | `reports:read`; `reports:read:daily` for today at own branch | IMPLEMENTED (2026-10-19, E4) |
| REPORT-002 | Expenses | By category, branch, period, method; collections − expenses (cash basis) | `reports:read` | IMPLEMENTED (2026-10-19, E4) |
| REPORT-003 | Attendance | Appointments by status; no-show and cancellation rates; by doctor and branch | `reports:read`; doctors `reports:read:own` | IMPLEMENTED (2026-10-19, E4) |
| REPORT-004 | Outstanding balances | Patients with balances; overdue installments with days overdue | `reports:read` | IMPLEMENTED (2026-10-19, E4) |
| REPORT-005 | Branch and doctor performance | Completed appointments, procedures (count, value), collections per branch; per doctor procedures and value (no commissions) | `reports:read`; doctors own figures | IMPLEMENTED (2026-10-19, E4) |
| REPORT-006 | Home screen per role | Receptionist: today's appointments, waiting list, today's collections, cash session state. Doctor: my day, waiting for me, follow-ups due. Owner/accountant: today and month revenue, collections, expenses, outstanding, no-shows | role-based | IMPLEMENTED (2026-10-19, F4) |

*Acceptance (all reports):* the totals equal the sum of the underlying records for the same filters (tested with
fixed data); a branch-limited member never sees another branch's figures.

### B.13 Arabic-only experience (feature F7 + Arabic-only requirement)

**L10N-001 — Arabic is the only language** · IMPLEMENTED (2026-10-19, F1 dashboard, F3 website; brand names may be Latin) · Phase F
- *Description:* Every user-facing surface is Arabic: dashboard, website, booking, emails, printouts, validation
  and error messages, empty states. There is **no English interface, no language switcher and no language setting**,
  and English localization is not planned. English remains in code identifiers, database names, API routes, logs
  and developer documentation.
- *Acceptance:* (1) no screen offers a language choice; (2) a scan of the built dashboard and website finds no
  English user-facing strings (an allow-list covers brand names, units and technical tokens such as "QR").

**L10N-002 — Right-to-left everywhere** · IMPLEMENTED (2026-10-19, checked in G at phone and desktop width) · Phase F
- *Description:* `<html lang="ar" dir="rtl">` on every page; layouts use logical CSS properties; tables, forms,
  calendars, dialogs and dashboards follow RTL. Phone numbers, emails, codes, invoice numbers and Latin drug names
  are isolated (`bdi` / `dir="ltr"`) so they display in the right order. The dental chart keeps its clinical
  orientation (CHART-001).
- *Acceptance:* every screen checked at phone and desktop widths with no mirrored icons that carry meaning (e.g.
  "next") pointing the wrong way.

**L10N-003 — Arabic errors and validation messages** · IMPLEMENTED (2026-10-19, F2; website booking messages in F3) · Phase F
- *Description:* Every API error code and every validation failure is shown in Arabic. The API keeps the stable
  English `code` and English `detail` for developers.
- *Acceptance:* an automated test fails when the API defines an error code that has no Arabic message.

**L10N-004 — Arabic emails** · IMPLEMENTED (2026-10-19, F2) · Phase F
- *Description:* Subjects and bodies of every email (verification codes, booking confirmations, reminders,
  invitations, password reset) are Arabic only, RTL in HTML mail, with a plain-text alternative.

**L10N-005 — Currency** · IMPLEMENTED (2026-10-19, F2/F3; E1: clinic setting, locked after the first invoice per CLR-09; one formatter used by billing and clinical screens; the price list and website still show ج.م) · Phase F
- *Description:* Amounts display in the clinic currency (`tenants.currency`, default `EGP`, shown as "ج.م" /
  "جنيه مصري") through one shared formatter. No screen, email or printout hard-codes a currency. Stored values are
  integer minor units; display formatting never changes them. Whether a clinic may change its currency after
  invoices exist is CLR-09.

**L10N-006 — Dates and times** · IMPLEMENTED (2026-10-19, F2/F3) · Phase F — CLR-08: Latin digits, 12-hour clock with ص/م
- *Description:* Dates use one Arabic format throughout (Gregorian calendar, Arabic month names), and times show in
  the branch's timezone (falling back to the clinic's, default Africa/Cairo). Timestamps are stored as `timestamptz`
  (UTC). Date-only values (birth date, expense date, due date) are never shifted by timezone.

**L10N-007 — Arabic data** · PARTIALLY_IMPLEMENTED · Phase D/F
- *Description:* Arabic is accepted in every name, address, note, diagnosis, treatment and description field. No
  validation rejects Arabic letters except technical fields (subdomain, email, phone). Search follows PATIENT-001.
  Exports are UTF-8 (CSV with a byte-order mark so Excel shows Arabic). Printouts render Arabic shaping correctly.
- *Acceptance:* Arabic patient names can be created, searched, edited, printed and exported unchanged.

**L10N-008 — Remove the multilingual infrastructure** · IMPLEMENTED (2026-10-19, F1/F3/F5) · Phase F
- *Description:* Remove the dashboard language toggle and stored preference, the English half of the dictionary,
  the `lang` plumbing, English inputs in forms (doctor, service and branch names, titles, addresses), and language
  choices (patient preferred language, clinic default locale) from forms. **Keep** the `_en` and locale columns and
  their data (no destructive migration). How existing English content is treated is CLR-07. Nothing is removed
  until the tests and a full screen check confirm nothing depends on it.

### B.14 Audit, integrity, operations

**AUDIT-001 — Financial audit trail** · IMPLEMENTED for existing money tables (2026-10-17) · Phase C
- *Description:* Every creation and state change of invoices, invoice lines, discounts and approvals, payments,
  reversals, refunds, installment plans, adjustments, expenses and cash sessions writes an append-only audit row
  (actor, time, action, old and new amounts and statuses). It is written by the database (trigger) in the same
  transaction, so no code path can skip it.
- *Entities:* `audit_log`.

**AUDIT-002 — Clinical audit trail** · IMPLEMENTED (2026-10-17, D4) · Phase D
- *Description:* Opening, finalizing and amending visits, chart entries, plans, procedures, prescriptions, and
  every view or download of clinical documents are audited. As in v3 §6.9, the audit row says *what* changed,
  never the clinical text itself (that lives, versioned, in the clinical tables).

**AUDIT-003 — Operational audit trail** · IMPLEMENTED (2026-10-17: bookings, clinic and booking settings, branches, hours, holidays, rooms, doctors, schedules, time off, services, members, branches of members, invitations, roles) · Phase C/D1
- *Description:* Appointment creation, moves and status changes; clinic settings, booking settings, doctors and
  services changes; invitations, role and branch changes; discount and expense approvals.

**SEC-101 — Cross-record consistency in the database** · IMPLEMENTED (2026-10-17) · Phase C
- *Description:* The database refuses: a visit whose patient, doctor or branch differs from its appointment; a
  payment whose branch differs from its invoice's; a payment whose installment belongs to a plan of another invoice;
  installments + down payment ≠ plan total; a plan total ≠ its invoice total; a plan estimate that differs from its
  items; a procedure linked to another patient's plan item.

**SEC-102 — Responsible staff is always a real member** · IMPLEMENTED (2026-10-17) · Phase C
- *Description:* "Who received / refunded / recorded / created / approved" columns on payments, refunds, expenses,
  invoices, visits and approvals reference a member of the same clinic (composite foreign key).

**SEC-103 — Least privilege on user accounts** · IMPLEMENTED (2026-10-17) · Phase C
- *Description:* The API's database role cannot read password hashes directly. Password checks go through a
  narrowly scoped database function.

**OPS-001 — Green build and CI** · IMPLEMENTED (2026-10-17; first GitHub run green on `v4/phase-d2-scheduling`) · Phase C
- *Description:* `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass, and the CI workflow runs them on
  every push.

---

## Part C — Requirements needing clarification

Nothing listed here is implemented until it is answered. Each item has the default I propose. `CLR-n`
corresponds to `D-n` in `docs/implementation-audit.md`.

**Answered 2026-10-17:** CLR-01 (email), and the proposed defaults below for **CLR-02, CLR-03, CLR-04, CLR-05, CLR-06, CLR-09,
CLR-10, CLR-11, CLR-12, CLR-13, CLR-14, CLR-15, CLR-16 and CLR-17**. These defaults are now the requirement.
**Answered 2026-10-19:** CLR-07 and CLR-08 (defaults; brand names may be in Latin letters). Nothing is open.

| ID | Question | Blocks | Proposed default |
| --- | --- | --- | --- |
| CLR-01 | ~~Sign-up verification without SMS~~ | — | **Resolved 2026-10-17: email code (AUTH-101)** |
| CLR-02 | Discounts: initial limit per role (% and/or amount); approval on the spot (manager signs in on the same screen) or as a request in a queue; may the accountant approve? | DISC-002, DISC-003, B.1 | Owner configures limits (start: receptionist 10 %, accountant 20 %); in-app request approved by owner; accountant cannot approve |
| CLR-03 | Expenses: which need approval (all, above an amount, some categories)? Who approves? Can receptionists record petty-cash expenses? | EXP-003, B.1 | Expenses by owner/accountant are approved on entry. ~~Receptionists may record cash expenses up to a clinic-set amount, which wait for owner approval~~ — **owner 2026-10-20: reception records and sees no expenses** |
| CLR-04 | Cash: one session per branch per day, or per staff member/drawer? Who opens and closes? Can a closed session be reopened? Can a cash payment be dated into a closed session? | CASH-001…004, PAY-001 | One session per branch per business day; receptionist or accountant opens/closes; only the owner reopens, with a reason; no back-dating into a closed session |
| CLR-05 | Refunds and reversals: who may refund or reverse? Must a refund use the original method (can a card payment be refunded in cash)? Is a reversal allowed only on the same day? | PAY-003, PAY-005, B.1 | Owner and accountant refund; reception may reverse its own entry the same day before the cash session closes; refund method recorded explicitly and may differ, with a reason |
| CLR-06 | Clinical notes: when does a visit become final (doctor presses "finalize", the appointment is completed, or after N hours)? Who may amend (author only, any doctor, owner)? | VISIT-002 | Final when the doctor finalizes or when the appointment is completed, whichever is first; the author or the owner may amend, with a reason |
| CLR-07 | Existing English content (`name_en`, `bio_en`, …): keep as hidden fallback, or clear? Website `locales` → `{ar}`? | L10N-008 | Keep the data, hide the inputs, show English only where no Arabic exists; set locales to `{ar}` |
| CLR-08 | Digits and clock: Latin digits (0123) or Arabic-Indic (٠١٢٣) in the dashboard and printouts (the website uses Arabic-Indic today, the dashboard Latin)? 12-hour with ص/م or 24-hour? | L10N-006 | Latin digits everywhere; 12-hour clock with ص/م |
| CLR-09 | Currency: EGP only, or configurable per clinic? May it change after invoices exist? | L10N-005 | Configurable per clinic at setup (default EGP); locked once the first invoice is issued |
| CLR-10 | Doctors: read the whole clinic schedule, or only their own appointments? See patients' balances? | APPT-004, BILLING-005 | Whole schedule read-only; own appointments writable; own patients' balances visible |
| CLR-11 | Treatment plan acceptance: a staff tick with date, or a patient signature? | TPLAN-002 | Staff records acceptance (member, date); signature later with consents |
| CLR-12 | Adjustments: waive an installment, write off a remainder, issue a credit note — which, who approves, any limit? | PAY-006 | Waiver and write-off rows with reason, owner only; no credit notes in v4 |
| CLR-13 | Order of work: pause the website-content roadmap (Phase 2 "Offers", display-only marketing, unrelated to billing discounts) until this plan's Phase E is done? | roadmap | Pause website phases 2–6 |
| CLR-14 | Consent signing (DSH-16, M in v3) and the super-admin panel (ADM, M in v3) are not in the v4 brief: defer both? | DSH-16, ADM-* | Defer both (Part D) |
| CLR-15 | Patient merge: how are medical histories combined? | PATIENT-003 | Union of allergies, conditions and medications (never lose an allergy); survivor's other fields kept; conflicts listed for the user |
| CLR-16 | Procedure price: may the doctor change it, or do all reductions go through discounts? | VISIT-003, DISC-* | Price = service price, or within the service's price range when it has one; any other reduction is a discount |
| CLR-17 | Print format for invoices and receipts: A4, A5, or 80 mm receipt printer? | BILLING-004 | A4 invoice and A5 receipt from the browser; thermal printers later |

---

## Part D — Deferred requirements

Not built in v4. Reasons and target phases are in `docs/roadmap.md`.

| Item | Source | Reason |
| --- | --- | --- |
| WhatsApp Business API, WhatsApp message automation | NTF-01, brief §8 | Explicitly deferred; paid service. Staff use their own WhatsApp manually; the clinic's WhatsApp number is display only |
| SMS (any provider), paid messaging, messaging subscriptions | NTF-01, NTF-05, AUTH-02 | Explicitly deferred (D-01: email instead). The existing `SMS_SENDER` port stays, unused |
| Payment gateways (Paymob, Fawry, Stripe), online booking payment, gateway keys | BOOK-04 (V1), BIL-03, NFR-04, DSH-12 | No paid or external integrations; payments are recorded manually |
| Automatic bank / wallet / InstaPay transaction sync | brief §7 F1 | Not assumed |
| Dental laboratory tracking | DSH-17 | Brief §8 |
| Doctor commissions and payouts | DSH-20 | Brief §8 (DB rules already exist and stay) |
| Advanced patient financing | brief §8 | Beyond installments (PAY-004) |
| Advanced analytics | DSH-11 (part), brief §8 | Beyond REPORT-001…006 (CSV export of these reports was added 2026-10-20, H3) |
| Automatic recalls | DSH-19 | v4 has the manual follow-up list (VISIT-005) |
| Inventory | DSH-09 (V2) | Not in brief |
| Consent signing | DSH-16 | Pending CLR-14 |
| Super-admin panel, impersonation, platform metrics, tickets | ADM-01…06 | Pending CLR-14 / V1–V2 |
| SaaS subscription billing states, upgrades, platform invoices | BIL-03…07 | Paid gateway; V1 |
| Waitlist | BOOK-12 | V2 |
| Patient self-service cancel/reschedule link | BOOK-08 | V1 |
| Editable notification templates, in-app notifications | NTF-02, NTF-01 (in-app) | V1 |
| Google sign-in, two-factor authentication | AUTH-04 (V1), AUTH-07 | V1 |
| Website: sections editor, SEO fields, custom domains, blog, analytics IDs, reviews, more templates | WEB-*, DSH-13, DSH-14 | Website-content roadmap (CLR-13) |
| Landing page, pricing, leads, demo | LND-* | Not in brief |
| Patient import from Excel | ONB-03 | V1 |
| Data export and tenant deletion | NFR-08 | Not in brief |
| Egyptian Tax Authority e-invoicing | v3 §7.2 | Open question in v3 |

**English localization is not deferred, it is dropped:** the product is Arabic only (L10N-001) and English is not
planned as a future feature.
