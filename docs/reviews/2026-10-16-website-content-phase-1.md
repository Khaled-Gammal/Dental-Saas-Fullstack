# Website content — Phase 1 review: gallery, image uploads, record images

Date: 2026-10-16. Roadmap: `docs/roadmap-website-content.md`. Phase 2 (offers) has not started.

## Scope delivered

1. **Media foundation** (shared by every content module)
   - Storage port with two adapters: `local` (dev/test, files under `STORAGE_DIR`, default `.storage/`) and `s3`
     (any S3-compatible service). Production refuses `local`.
   - Upload `POST /media?purpose=gallery|photo|logo` (multipart `file`, 10 MB cap while reading). The server decodes the
     image whatever its name or declared type, accepts JPEG/PNG/WebP only, applies EXIF orientation, strips all
     metadata (GPS, camera), and stores WebP renditions per purpose:

     | Purpose | Stored kind | Smallest side | Widths |
     |---|---|---|---|
     | gallery | `gallery` | 200 px | 480, 960, 1600 |
     | photo (doctor, service, branch) | `image` | 200 px | 320, 640, 1280 |
     | logo | `logo` | 48 px | 128, 256, 512 |

   - Permission depends on the purpose and is checked by a guard before the body is read: gallery needs
     `website:write`, photo and logo need `settings:write`.
   - Storage plan limit (`plans.limits.storage_mb`) checked in the same transaction as the insert.
   - Dashboard previews use HMAC-signed links valid 15 minutes. The website uses `/public/media/:file/:w.webp?host=`,
     allowed only while `file_is_public()` is true for that clinic.
   - Nightly worker job `purge-orphan-images` (03:45 Cairo) deletes website images older than a day that nothing uses.
     Medical file kinds are never touched.

2. **Gallery** (`modules/gallery`): clinic-wide or per-branch photos, alt text required to publish, one featured photo
   per scope, reorder per scope, keyset pagination, public list endpoint. Dashboard screens: list with filters,
   publish and feature switches, reorder, delete; multi-file upload page; edit page.

3. **Record images** (added on request): clinic logo, doctor photo, service image, branch photo.
   - Each record's module owns its column and accepts the image id in its normal create or update request
     (`logoFileId`, `photoFileId`, `imageFileId`; `null` removes). A replaced or removed image is deleted after the commit.
   - An image of the wrong kind, a missing one or another clinic's is refused (`wrong_image_kind`, `file_not_found`).
   - Branch and profile edits now purge the website cache (they did not before).
   - Dashboard: reusable `ImageField` (upload with progress, cancel, change, remove, drag and drop) on the doctor form,
     service form, branch edit form and clinic profile. The doctor list shows the photo; the profile brand preview
     shows the logo.
   - Website: logo in header and footer (tooth mark when none), doctor photo in the card circle (initials when none),
     service and branch images at the top of their cards. Images are served same-origin through
     `app/sites/[host]/media/[file]/[rendition]`, with width/height set to avoid layout shift.

## Database

- `20261024000010_media_and_gallery.sql`: image size columns on `files`; gallery branch, alt text, featured,
  constraints and indexes.
- `20261025000011_entity_images.sql`: `branches.photo_file_id` (same-clinic foreign key), indexes on every column that
  points at `files`, functions `file_is_public(uuid)`, `file_in_use(uuid)` and `purge_orphan_images(interval)`
  (worker only). Additive; both have working `down` sections.

Visibility is decided live: hiding a doctor or service, closing a branch or unpublishing a photo takes the image off
the website at once (subject to caching, below).

## Tests (actual results)

| Suite | Result |
|---|---|
| Database (`pnpm db:test`) | 147 checks passed (gallery 9, record images 15) |
| API (`pnpm --filter @dental/api test`) | 13 suites, 145 tests passed, plus 1 new unit test for purpose rules (media unit suite 9/9) |
| Dashboard (vitest) | 37 passed |
| Web (vitest) | 20 passed |
| Lint (`pnpm lint`) | clean |
| Web production build | passes |

Covered: invalid and disguised files, other formats, tiny images, 11 MB upload (413), permissions per purpose, signed link
tampering and expiry, cross-clinic isolation for files and branches, public visibility following each record's state,
replaced images deleted from storage, gallery publish rules, featured swap, reorder, delete.

## Browser verification (your running dev servers)

- Gallery: uploaded 3 photos, publish blocked without description, published and featured, featuring a second photo
  un-featured the first, featuring a draft refused with the Arabic message, reorder persisted, edit saved.
- Doctor photo, clinic logo, service image and branch photo uploaded and saved from the dashboard.
- Website `clinic-a.lvh.me:3000`: all five images load from the clinic's own hostname. At 390 px width there is no
  horizontal scroll and the logo shrinks to 34 px.
- Public image responses are WebP with no EXIF or camera data; another clinic's host and drafts get 404.

## Open items and risks

- **Dev object storage.** The MinIO compose image cannot be pulled here (Docker Hub and quay.io refuse it). Dev and
  tests use the `local` driver. The `s3` adapter was verified once against a temporary S3 mock. Pick an S3-compatible
  dev server (or use R2/S3 directly) before staging.
- **Caching after hiding.** A hidden image is refused by the API at once, but browsers may keep it for up to 1 hour and a
  CDN for up to 1 day.
- **Branch photo on create.** A branch photo can be added only after the branch exists (the create request does not take one).
- **One unexplained reorder.** During browser testing a reorder once appeared not to persist. Repeating the same sequence
  three ways did not reproduce it. Watch for it.
- **No upload-specific rate limit** beyond the API's general limits and the storage plan limit.
- **Demo data.** The dev database now has sample gallery photos and images on doctor Ahmed, the clinic logo, the
  Consultation service and the Maadi branch. Remove them from the dashboard if unwanted.
- Public gallery page, lightbox and branch pages are Phase 4.
