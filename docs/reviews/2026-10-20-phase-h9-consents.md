# Phase H9 review — patient consents (2026-10-20)

DSH-16 and NFR-16: consent forms patients sign before treatment, stored with the exact text signed. Built on
`v4/phase-h9-consents` (from `main` 876d4f3). Migration 0035, applied to the dev database.

## Decisions (owner, 2026-10-20)

1. **Signing:** on the clinic's tablet or phone with a finger, or on paper with a photo or scan attached.
2. **Texts:** each clinic writes its own. New clinics get starter drafts that can't be signed until the owner reviews
   and saves them.
3. **Enforcement:** a missing consent warns the doctor, but never blocks treatment.

## What changed

- **«نماذج الموافقات» (`#/consents`, needs `settings:write`):**
  - Every clinic starts with four drafts: general, extraction, local anesthesia, implant.
  - Each draft shows a banner saying it is a platform draft, not legal advice, and must be reviewed and adapted.
  - Saving asks for a tick, «راجعت هذا النص وأعتمده», and creates a new version. Earlier versions stay forever,
    since signed consents point at them.
  - A text can be archived and restored. The page lists each version with who approved it and how many times it was
    signed.
- **On the patient's page, a «الموافقات» card:**
  - Lists every consent with its date, who signed and on whose behalf, and whether it was on screen or paper.
  - «توقيع موافقة» opens the signing page. «موافقة ورقية» records a paper form: which text, who signed, and the photo
    or PDF.
  - Each consent opens as a printable page with its text and signature.
  - «سحب الموافقة» withdraws one with a reason; it stays in the record, marked withdrawn.
- **Signing page (for a tablet):**
  - The text is shown large. For a patient under 18, the guardian on file is suggested as the signer, and the minor
    can't be marked as signing for themself.
  - The signer ticks «قرأت النص أعلاه وفهمته» and signs in the box, which can be cleared.
  - What is stored is the text as the database holds it (the reviewed, current version). The page can't change it.
- **Services:** each service has «تحتاج موافقة» to pick the text it needs.
- **Visit:** when a recorded treatment needs a consent the patient hasn't signed, a red notice shows with «وقّع الآن».
  The button opens signing with that text and links the consent to the visit. The treatment stays recorded, so it
  never blocks. A consent counts if signed for that visit or in the past 12 months, and not withdrawn.
- **Who can do what:**
  - Signing or recording paper: anyone who can edit patients or record treatment, so reception can hand over the
    tablet.
  - Reading: `patients:read`. Writing texts: `settings:write`.
  - No new permissions were needed.
- **Safety:**
  - Signatures and scans are private files behind 5-minute links, and every opening is recorded.
  - A consent can't be edited or deleted, even by a direct database call from the API.
  - The text is copied by the database, so a forged text from the browser is ignored (tested).
  - Patient merge, clinic export (H8) and clinic erase (H8) all include consents and their files.

## Please check

- **The four draft texts** are plain, general wording written for this build. They are not legal or medical advice.
  Each clinic must review them, which the system enforces; you may want your lawyer to read them first.
- **The 12-month rule** for "this patient already consented" is my default. Tell me if a consent should count only
  for the visit it was signed for.
- **Reception can see consents:** consents are visible to everyone with `patients:read`, reception included (the
  title and who signed). Reception sees no medical notes. Say if you want it limited to clinical staff.

## Tests (run 2026-10-20)

| Check | Result |
| --- | --- |
| `typecheck`, `lint` (API, dashboard, website), dashboard build | passed |
| Database tests (`pnpm db:test`) | **578 checks passed**, 17 new in `33_patient_consents.sql`. They cover: four drafts per clinic; a draft refused; a reviewed new version signable; a version never edited and texts never deleted; the client's text replaced by the database's; an old version refused; a non-consent file refused; screen and paper mixed up refused; a sibling guardian on paper; never changed or deleted; withdrawal needs a reason, happens once, at the real time; an archived text refused; clinics isolated |
| Migration 0035 down and up again on the test database | passed |
| API unit + e2e on a fresh test database | 39 suites, **346 tests passed**. New `consents.e2e-spec.ts` covers drafts, review, a new text, signing on screen with a signed link (tampered link refused), the accountant refused, paper with a guardian, withdrawal, another patient's path refused, the service's consent with the visit warning cleared by signing, another patient's visit refused, archive and restore. New `consent-files.spec.ts` covers signature decoding and keys |
| Dashboard unit | 23 files, **106 passed** (new `consents-model.test.ts`: who signs, the form's checks, missing consents, access, the service field) |

Not checked in a browser (the extension's browsers can't reach the local addresses), so the signature pad hasn't been
tried on a real tablet. Please try it on the clinic's device.
