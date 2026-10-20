# Phase H6 review — legal documents at sign-up (2026-10-20)

NFR-15: the platform's Terms of Service, Privacy Policy and Data Processing Agreement, versioned and accepted. Built on
`v4/phase-h6-legal` (from `main` 632da69). Migration 0032, applied to the dev database with placeholder documents.

## Decisions (owner, 2026-10-20)

1. **Who accepts:** the clinic owner accepts all three at sign-up (the DPA for that clinic — the clinic is the data
   controller, the platform the processor); invited staff accept Terms and Privacy when they join (an invited owner,
   the DPA too).
2. **New versions:** the platform admin ticks "must accept again" when publishing. If ticked, everyone who accepted an
   older version sees a must-accept screen at their next sign-in and cannot use the system (the API refuses too)
   until they accept. If not ticked, the new version applies to new sign-ups only.

**The legal text is yours to provide.** Nothing in the code or migration contains legal wording. Your dev database has
clearly marked placeholders ("نص مؤقت للتطوير فقط — ليس نصًا قانونيًا"); before launch, publish the approved text from
the panel (`#/platform` → «المستندات القانونية»). Production starts with no documents, and sign-up asks for acceptance
only of what has been published.

## What changed

- **Database (0032):** `legal_documents` (every version kept; the API role only reads; the panel publishes through
  `platform_publish_legal()`, audited) and `legal_acceptances` (who accepted which version, when, from which IP and
  browser; never changed or deleted; the DPA per clinic). `legal_pending()` decides what a person still owes.
- **API:** `GET /public/legal` and `/public/legal/:kind` (anyone); sign-up and invitation acceptance require the ids of
  the current documents and record them in the same transaction as the account (refused with
  `legal_acceptance_required`, listing what is missing). A session lists `legalPending`; while it is not empty the
  access token carries a flag and every clinic route answers 403 `legal_acceptance_required` except `POST
  /legal/accept`. Panel: `GET /platform/legal`, `POST /platform/legal`.
- **Dashboard:**
  - sign-up and the invitation page: «قرأت وأوافق على شروط الاستخدام وسياسة الخصوصية واتفاقية معالجة البيانات» with each
    title opening the document in a new tab; the button stays disabled until it is ticked;
  - `#/legal/terms|privacy|dpa`: the current text, readable without signing in (linkable from the website later);
  - the must-accept screen after sign-in when something is pending (with a sign-out button);
  - panel tab «المستندات القانونية»: every version with its date, publisher and number of acceptances; publish a new
    version (starting from the current text), with the "must accept again" switch and a confirmation that says what
    it will do.

## Tests (run 2026-10-20)

| Check | Result |
| --- | --- |
| `typecheck`, `lint` (API, dashboard), dashboard build | passed |
| Database tests (`pnpm db:test`) | **509 checks passed** (14 new in `30_legal_documents.sql`: placeholders and the demo acceptances; who owes what — owner vs staff, the DPA per clinic; only the platform publishes; a version that asks again vs one that does not; accepting clears it; recorded once; never changed or deleted; audited) |
| Migration 0032 down and up again on the test database | passed |
| API unit + e2e on the fresh test database | 34 suites, **325 tests passed** (new `legal.e2e-spec.ts`: public reading; a member who never accepted is refused everywhere until they accept all listed documents, then works; publishing from the panel without "accept again" stops nobody. Sign-up refused without the DPA and the owner's session has nothing pending after sign-up; staff joining with the documents) |
| Dashboard unit | 21 files, **92 passed** (new `legal-model.test.ts`) |
| Website unit | 23 passed |

The "accept again" flow is exercised at the database level (`legal_pending`) and by the API test with a member who
never accepted; publishing a version that asks everyone to accept again is not run in the shared API test database,
because it would stop every other test suite's sign-ins.

Not checked in a browser: the extension's browsers cannot reach `localhost:5173`.
