# Phase D3 review — patients: Arabic search, duplicate warning, history versions, X-rays and documents (2026-10-17)

Scope: SRS PATIENT-001, PATIENT-002, PATIENT-004, PATIENT-005 (`docs/roadmap.md`, Phase D3). PATIENT-003 (merge)
stays in D5. Branch: `v4/phase-d3-patients` (on top of D2).

## What changed

| Requirement | Change | Where |
| --- | --- | --- |
| PATIENT-001 | Name search compares normalised text: أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي, diacritics and tatweel dropped, Latin lower-cased, spaces collapsed. Both the stored name (`patients.full_name_norm`) and the query go through the same `ar_normalize()`, so "احمد" finds "أحمد", "فاطمه" finds "فاطمة", "مصطفي" finds "مصطفى". The search is backed by a trigram index on the normalised name. Phone and file-number search are unchanged | migrations 0019/0020; `patients.repository.ts` |
| PATIENT-002 | `GET /patients/duplicates?phone&fullName&dateOfBirth` returns up to 5 existing patients with the same main, alternative or guardian phone, the same normalised name, or a close name (trigram ≥ 0.5) with the same birth date. The new-patient form asks it as reception types (debounced) and shows the matches with a link to each. **It never blocks saving** (families share phones) | `patients.service.ts`, `patients.controller.ts`; `screens/patients/form.tsx` |
| PATIENT-004 | `POST /patients/:id/files` (multipart, `clinical:write`): X-ray, clinical photo or document. The type is read from the file's bytes (PDF, JPEG, PNG, WebP), never from its name or the browser's claim; 20 MB cap; counted against the plan's storage. Files are always private. `GET /patients/:id/files` (`clinical:read`) lists them with 5-minute links signed for the clinic, the file **and the signed-in user**; a changed or expired link fails. Each opening writes an audit entry as that user. `POST …/files/:fileId/archive` hides a file with a reason; nothing is deleted; "show archived" lists them | `patient-files.*`, `clinical-files.ts`, `config.ts` `CLINICAL_FILE_POLICY`; dashboard `files-card.tsx` on the patient profile |
| PATIENT-005 | Every save of the medical history keeps a version (who, when, what) through a database trigger; existing histories became the first version. `GET /patients/:id/medical-history/versions` (`clinical:read`, the reading is audited). The profile card has "النسخ السابقة". Allergies and pregnancy stay in the red alert at the top of the card | migration 0019; `patients.service.ts`; `medical-history.tsx` |

Not done in D3 (moved to D4, needs visits): the alert on the visit screen (PATIENT-005 acceptance 2) and attaching a
file to a visit (PATIENT-004 "optionally to a visit").

## Migrations and their risks

- `20261029000019_patients_search_history_files` — **Medium** (one item), otherwise low.
  - `patients.full_name_norm` is a **stored generated column**, not the trigger + batched back-fill proposed in D-03.
    It can never drift from `full_name`, needs no back-fill job and does not change `updated_at`. The cost: adding
    it rewrites the `patients` table once under an exclusive lock. On the dev/test data this is instant; on a large
    production table it would block patient writes for the length of the rewrite, so run it in a quiet window.
    **Decision for you:** accept this, or ask for the trigger + batched back-fill version before production.
  - `patient_medical_history_versions`: new table, RLS (tenant isolation, forced), `REVOKE UPDATE, DELETE` from the
    API role; back-fill inserts one row per existing history.
  - `patient_files`: `archived_at`, `archived_by` (member FK), `archive_reason`, with CHECKs (archived fields set
    together, caption ≤ 200). Nullable, no rewrite.
  - `files`: the 0001 `files_check` is replaced by `files_clinical_private`, which also forces `document` files to be
    private. Added `NOT VALID` then validated; existing rows satisfy it.
- `20261029000020_patients_name_norm_index` — **Low**. `CREATE INDEX CONCURRENTLY` in a migration without a
  transaction (dbmate `transaction:false`), so writes are not blocked. If it fails half-way it leaves an invalid
  index: drop it and rerun. The old raw-name trigram index is kept.

Applied to the test and dev databases; types regenerated. No data is deleted or rewritten by value.

## Tests (run 2026-10-17)

| Suite | Result |
| --- | --- |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | passed |
| Database tests | **265 checks passed** (new `19_patients_search_history_files.sql`: 17 checks: normaliser cases, generated column follows the name, search without hamza, two versions after two saves with the saver, another clinic sees no versions, versions not editable, archive fields together, documents must be private) |
| API e2e + unit | **18 suites, 194 tests passed** (new `patients-d3.e2e-spec.ts`, 7 cases: normalised search, duplicates by phone/name and never a block, versions and reception refused, X-ray upload with the type taken from the bytes, signed link bound to the member + tampering + audit, reception and another clinic refused, archive with reason; new `clinical-files.spec.ts`, 5 cases: file sniffing, link signing/expiry/binding, storage keys) |
| Dashboard unit | **51 passed** |
| Website unit | 20 passed |
| GitHub CI | D2 branch run 39055317969 **success**; D3 runs when the branch is pushed |

**Not done: the browser check.** Same limit as in D1/D2: the connected Chrome could not open `localhost:5173`.

## Notes and follow-ups

- The e2e test refuses reception (no `clinical:read`); the accountant role has no `clinical:read` either, so the
  same check applies, but there is no separate accountant case.
- Clinical files go to the same object storage as website images, under a separate key prefix, and are only served
  through the signed `GET /clinical-files/…` route (never a public URL).
- The 413 the API returns for oversize uploads is the shared one (it mentions the website image limit); the
  dashboard shows its own "larger than 20 MB" message instead.
- Medical history versions are shown with their lists and notes; a side-by-side "what changed" view is not built.
- The dashboard copy is still bilingual until Phase F; new strings exist in Arabic and English.
