# Roadmap — clinic website content (gallery, offers, success stories, banners, multi-page site)

Decided 2026-10-16. One phase at a time; each phase ends with migrations verified, API + permission + tenant-isolation
tests, dashboard and website checks in the browser, and a short review before the next starts.

## Architecture decision

Gallery, success stories, offers and banners are **separate modules**, each with its own table(s), linked to the clinic
(`tenant_id`) and optionally a branch (`branch_id`), never columns on `tenants`. They share one foundation: the
**media** module (uploads, image processing, storage, signed and public delivery). Every write that changes what
visitors see goes through `LiveSiteWrite` (purges the website cache). Public reads return published, in-window
records only.

| Module | Tables | Notes |
|---|---|---|
| media (shared) | `files` (+ width, height, generated sizes) | Storage port: `local` disk adapter (dev/test) and `s3` adapter (R2/S3/any S3-compatible server; production refuses `local`). Images are decoded, EXIF/GPS stripped, re-encoded to WebP sizes per purpose (gallery, photo, logo). Served publicly only while `file_is_public()` says something visitors can see shows them. Unattached uploads are purged nightly. |
| record images | columns on the records themselves | Clinic logo (`tenants.logo_file_id`), doctor photo, service image, branch photo (`branches.photo_file_id`, new). One image per record, owned by that record's module; set through the record's normal create/update request. |
| gallery | `gallery_items` (+ branch, alt text, featured, updated_at) | Clinic-wide or per branch; ordering; one featured image per scope. |
| offers | `offers` (new) | Clinic / branch / service scope; percent or fixed; schedule; draft/published/archived; overlapping published offers for the same service+branch rejected by the database. Display only — never changes prices or booking totals. |
| success stories | `success_stories` (new) | Draft/published/archived; before/after images; documented consent required to publish (database CHECK); no patient identifiers in public fields. |
| banners | `banners` (new) | Homepage carousel; schedule; optional safe link. |

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | **Gallery + image uploads** — storage port + S3 adapter, upload validation and processing, signed/public delivery, storage plan limit, gallery API, dashboard gallery management with reusable `ImageUploader`; plus (added 2026-10-16 on request) images for the clinic logo, doctors, services and branches, shown on the current website | done — see `docs/reviews/2026-10-16-website-content-phase-1.md` |
| 2 | Offers & discounts — linked to services and branches, active-only on the public side | pending |
| 3 | Success stories — consent and publish approval, patient privacy | pending |
| 4 | Public website pages — about + gallery (lightbox), services, doctors, offers, stories, branch directory and branch pages | pending |
| 5 | Homepage integration — banner carousel, featured offers / stories / photos | pending |
| 6 | QA & performance — permissions, real data, mobile, image loading, speed | pending |
