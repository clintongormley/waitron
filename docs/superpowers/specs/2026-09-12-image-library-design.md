# Image library

## Implementation status, 2026-09-12

The `image-library` branch implements the mandatory media module, database image storage, language
metadata, labels, search, product selection and deletion blocked by product references. The
[operator guide](../../content-and-images.md) describes the current controls. Labels are entered
as comma-separated text; the saved label set supplies the filter choices. The library does not
provide a separate label manager.

[Focused test evidence](../plans/2026-09-12-image-library.md#focused-evidence-2026-09-12) includes the
real populated-image restore regression and browser checks. [Final validation](../plans/2026-09-12-image-library.md#final-validation-2026-09-12)
is complete; `finish-branch` is underway. The repository starting points below are historical observations
from before implementation; their filesystem storage and fixed language assumptions are superseded
by the media module and content-language configuration.

You need to find and reuse photographs without uploading a fresh copy for every product.
The library gives you one place to upload, describe, label, find and remove them.

Build [content languages](2026-09-12-content-languages-design.md) first. This design depends on
that runtime configuration; the shipped interface language list is not its language source.

## Agreed behaviour

- Upload JPEG, PNG and WebP photographs using the existing upload size limit.
- Give each photograph a name and alt text in the supported languages. Require both in
  the configured default content language; allow the other translations to follow later. Derive
  language choices from the tenant's enabled content languages, rather than the interface list.
- Apply several labels. Choose an existing label or type a new one. Labels are shared across
  languages and come from current assignments, so removing their last assignment removes them
  from suggestions and filters. Trim whitespace and treat case variants as the same label.
- Search names, alt text and labels across languages. Name matches rank above alt-text matches.
  Use word search, including language-appropriate word forms, rather than a substring filter.
- Combine search with a label filter. Offer relevance, upload date and name sorting, with
  direction controls for date and name. Default to newest first without a query and relevance
  with one. Use a stable final tie-breaker so paging neither repeats nor skips equal matches.
- Show thumbnails, the translated name, labels, upload date and whether the image is used.
  Open metadata editing in a modal. Use the same browsing controls in a product image picker.
- Confirm deletion of unused images. Block deletion of used images and show the products using
  them, including inactive products. Removing an image from a product does not delete the image.
  Recheck uses at deletion and enforce the reference in the database to cover concurrent edits.

Translation display uses the shared content resolver: requested language, then the configured
content default. Do not invent a translated alt description from a filename. The product
picker can clear the product's image separately from deleting the library record.

## Storage and boundaries

Add a mandatory `@waitron/media` module with its own migrations, permissions, change sources,
configuration-transfer contribution and dashboard contribution. The composition packages name
the implementation; generic app code uses the existing module contracts.

Store bytes and metadata in Postgres. Preserve content-addressed `/media/<sha256>.<extension>`
URLs, with the existing public serving policy and immutable caching. Metadata changes do not
change the URL. Uploading identical bytes finds the existing image and does not overwrite its
descriptions or labels. An upload cancelled before Save creates no library record.

The module owns image records, translations and label assignments. Keep image bytes out of
list responses and change notifications. Catalogue product references remain nullable filenames;
the media migration adds a tenant-consistent foreign key from products to the image table.
This is a constraint on an existing core table, not a new domain table in core. Future image
consumers must contribute actual database references and a corresponding usage description.

The module serves both the authenticated library API and public image bytes through its route
contribution. Reads scope to the deployment tenant, including filename and by-id reads. Management
operations require a module permission granted to managers and admins. Automatic refreshes are
passive session activity and must not replace an open editor's draft.

Move demo images into the same storage path. Backups and replication carry the module tables;
configuration transfer carries the library with the product configuration. Remove the filesystem
image contribution and its image-specific export/import path. There is no filesystem backfill or
old-format compatibility layer before production.

## Verification

Write failing behavioural tests before implementation. Exercise upload validation and duplicates,
translation requirements and fallback, label creation and last-use disappearance, ranked word
search, combined filters, every sort direction and pagination. Exercise actual product attachment,
usage reporting, deletion and the concurrent attach/delete case as `app_user` on real Postgres.

Browser tests cover upload/edit/pick/clear/delete, field errors, keyboard submission, translated
copy, stale requests and live refresh without lost drafts. Test the native controls and run axe
in both themes. Verify public bytes through real trading boot, then round-trip images through
configuration export/import and backup/restore. Register the migration and classification guards
and run all tests which pin those lists. Run package coverage and the repository gate before
announcing branch readiness.

## Repository starting points

These are implementation locations inspected on 2026-09-12, not test results:

- `apps/server/src/catalogue-api.ts:945`: current multipart upload writes to `mediaDir`.
- `apps/server/src/media-api.ts`: public filename validation and filesystem serving.
- `apps/dashboard/src/widgets/image-upload.ts`: existing product upload widget.
- `apps/dashboard/src/widgets/product-form.ts:780`: product image control.
- `packages/db/src/schema/catalogue.ts:96`: nullable product image filename.
- `packages/shared/src/locales.ts`: shipped interface languages, inspected before content-language configuration existed.
- `apps/server/src/configuration-transfer.ts:217`: filesystem media export.
- `apps/server/scripts/demo-seed/seed-media.ts`: filesystem demo image seed.
- `packages/composition/src/modules.ts`: module and filesystem backup contributions.
- `packages/dashboard-modules/src/index.ts`: dashboard contributions.
- `docs/backlog.md:57`: decision to store product images in Postgres.
