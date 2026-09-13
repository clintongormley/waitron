# Build Categories

Branch: `products-categories`. Read the [spec](../specs/2026-09-12-product-categories-design.md) and
[shared contract](../specs/2026-09-12-products-overhaul-design.md).
Implementation and validation receipts are recorded below.

Naming update, 2026-09-13: label the product field and replacement prompts **Reporting Category**;
see the dated decision in the shared contract. This plan's primary-category references use that label.

## 1. Trace the single-category consumers

Read data, UI and testing conventions. Run
`rg -n 'categoryId|category_id|categoryName|categories\.name' packages apps scripts docs`.
Trace reporting labels, kitchen routes, menu list joins, browser-local types, seed/configuration
transfer and media use. Start with `packages/db/src/schema/catalogue.ts`, catalogue operations,
`packages/venue-service/src/operations.ts`, server working orders and media `images.ts`.

Record the primary-category decision before changing the column's meaning. Add failing tests for
multiple memberships, primary selection, translated category names and parent cycles. Assert exact
list results so duplicate rows from a join cannot pass unnoticed.

## 2. Schema and shared category operations

Add catalogue-owned metadata and membership schema referencing existing core IDs; generate its
migrations and grants, classify tables and update transfer/dependency order. Keep the primary
category reference consistent with membership in one transaction and one operation. No new core
domain tables or duplicated independently editable names are needed.

Implement list/read/create/update/delete and membership replacement in section-owned files, with
default-language validation, same-tenant image validation, hierarchy traversal and meaningful errors.
Serialize reparenting; prove the A/B opposing update and delete/attach races on real PostgreSQL as
the deployment role. Test rollback when any membership or replacement primary is invalid.

## 3. Media and existing consumers

Before UI, write failing tests for an image referenced only by a category: usage list, count,
delete refusal and successful delete after removal. Extend media references and lock discipline,
configuration transfer, restore ordering and relevant module graph assertions. Test cross-tenant
image assignment. Reuse the existing image picker rather than creating upload storage.

Update primary-category reads in catalogue offers, preparation routing, dashboard operations and
reporting snapshot creation. Keep the existing route precedence assertions; add a product with two
categories whose routes differ and assert one chosen route and one reporting amount. Test moving
or renaming a category after an order snapshot is recorded.

## 4. API and the two membership entry points

Extend `/management-api/categories`, introduce the shared product-membership operation, and wire
browser-local client methods and passive subscriptions. Implement `categories-screen.ts` and
`category-form.ts` with the shared form event contract. Add the Categories navigation entry; leave
the old combined catalogue screen to Products integration.

Browser tests start red for translated fields, parent exclusion, images, dependency errors,
category-side product assignment and explicit replacement of a primary category. Test nested
creation in a host harness, retained drafts, write-success/load-failure handling, keyboard controls
and accessibility in both themes. Products composes the real product-side membership picker later.

## 5. Verify and hand off

Run focused catalogue hierarchy/membership tests, PostgreSQL grants/races, media reference tests,
affected venue-service/order routing tests and the changed browser suites. Coordinate browser
testing with sibling sessions. Run relevant root classification, migration graph/journal, live
subscription and media-reference guards after schema registration changes.

Document membership API, primary semantics, reusable form properties and migration changes for
Products. Update the backlog/operator docs when the implementation changes their claims. Record
commands/results and announce readiness for `finish-branch`; do not merge without the owner.

## Implementation decisions and receipts (2026-09-12)

`products.categoryId` remains the internal primary category. Names stay in the existing core
category row as translated JSON, avoiding a second editable name. Catalogue owns hierarchy/image
metadata and product membership. The old single-category product selector delegates to the shared
operation and cannot clear additional memberships accidentally.

Read the [integration guide](../../developers/product-categories.md) for the membership API,
reusable forms, migration files and Products handoff. The Products branch still owns composing
these forms into its replacement product editor.

These focused suites passed. Reproduce a package row with
`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/<package> test -- <files>`.
Browser runs were sequential across packages after checking host processes and memory.

| Package | Files | Passed |
| --- | --- | --- |
| catalogue | `src/categories.test.ts src/categories.pg.test.ts src/operations.test.ts src/content-languages.test.ts src/content-languages.pg.test.ts src/integration.test.ts` | 100 |
| media | `src/configuration-transfer.test.ts src/images.test.ts` | 38 |
| media | `src/images.pg.test.ts` | 6 |
| server | `src/catalogue-api.test.ts src/catalogue-api.pg.test.ts src/category-fks.pg.test.ts src/configuration-transfer.test.ts` | 153 |
| server | `src/working-order.test.ts` | 113 |
| server | `src/kitchen.test.ts` | 18 |
| venue-service | `src/operations.test.ts src/routes.test.ts` | 13 |
| venue-service | `src/category-dependencies.test.ts` | 2 |
| db | `src/schema/routing-station.test.ts` | 2 |
| recipes | `src/ingredients.test.ts` | 12 |
| fiscal-verifactu | `src/privileges.test.ts` | 5 |
| fiscal-verifactu | `src/inmutabilidad.test.ts` | 6 |
| dashboard | `src/widgets/category-form.test.ts src/widgets/category-form.a11y.test.ts src/screens/categories-screen.test.ts src/screens/categories-screen.a11y.test.ts` | 38 |
| dashboard | `src/widgets/product-form.test.ts src/widgets/product-form.a11y.test.ts` | 52 |
| media | `src/dashboard/image-library.test.ts src/dashboard/image-library.a11y.test.ts src/dashboard/image-picker.test.ts` | 34 |
| venue-service | `src/dashboard/client.test.ts src/dashboard/venue-operations-screen.test.ts src/dashboard/venue-operations-screen.a11y.test.ts` | 38 |

After the final product-query refinement, `src/operations.test.ts src/integration.test.ts`
passed 73 catalogue checks and `src/working-order.test.ts` passed 113 server checks.

Existing dashboard client, catalogue, product-list, category-manager, navigation and recipe-widget
checks also passed after their category/product fixtures adopted the new wire shapes.

`pnpm exec vitest run scripts/append-only-enable-always.test.ts scripts/claude-md-pointers.test.ts
scripts/journal-monotonic.test.ts scripts/live-subscriptions.test.ts
scripts/classification-complete.test.ts scripts/module-graph-honesty.test.ts` passed 47 checks.

The exact privilege matrix first failed because it lacked `category_details` and
`product_categories`; adding their observed `SIUD` grants made it pass. Three final browser
regressions first failed for disabled-language search and missing inline parent/image errors;
all passed after the fixes, with accessibility checked in both themes.

Formatting and ESLint passed over the changed TypeScript files. The catalogue, server, dashboard,
venue-service, media, db and recipes typechecks passed. The initial implementation stopped before branch finishing; the next section records its review.


## Branch review (2026-09-13)

Claude Opus 5 reviewed the candidate at `8ae83ec7` against captured base `f1139e12` in 235 seconds.
Artifacts: `/tmp/waitron-categories-review.Fwk9xa/brief.md`, `report.md`, `report.md.timing`,
`report.md.usage`, and the driver `triage.md` in that directory.

Accepted: permanent regression tests now distinguish domain errors from database constraint
errors for duplicate memberships and a route attached during deletion. Removing each guard in the
disposable candidate failed the new assertion; restoring it passed. Optional-media lookup now
returns `category.image_not_found` when the media table is absent (the test first failed with
`42P01`). Direct category products use one grouped membership query after the category lookup.

The raw SQL/prose consumer sweep found two demo test files comparing JSON category names to text.
Both failed with `22P02`; selecting the English JSON value preserves their routing assertions and
both now pass. The previous error-shape assertion lesson is recorded in the testing guide.

The legacy primary selector keeps its documented additive behavior: a new test checks retained
memberships and clearing only the final membership. Tenant-wide authoring serialization remains
the plan's explicit design; the reviewer reported no throughput measurement. The privilege matrix
uses the complete manifest, and its five real-PG checks already passed. Media already declared its
catalogue dependency at the captured base; no new module dependency was introduced.

Further focused checks: six real-PG category races/privilege tests passed, including default-language
and name/hierarchy edits in both commit orders; nine category operation tests passed; nine browser
screen tests passed, including the image-usage deep link; and the route/deletion race passed.
Existing image-race and configuration-transfer receipts remain applicable. These probes exercise
the named races; they do not claim freedom from every possible deadlock. CI supplies wider package
coverage after the push.

The disposable populated-name migration probe ran the actual `0020` SQL against a category with a
text name. It asserted `23502` from adding the required JSON column, and confirmed transaction
rollback retained the original name. Source and receipt are `migration-probe.ts` and
`migration-probe.txt` beside the review report. No shared development database was touched.


## CI fixture corrections (2026-09-13)

The first PR run (`34746189323`, head `c472fc21`) exposed two missed fixture shapes. The recipes
suite and recipe API suite owned separate core-only databases, so product creation failed with
`42P01` on `product_categories`. Both now install catalogue migrations. The recipes package's exact
`test:coverage` command passed 24 tests at 100% coverage; the recipe API suite passed 18 tests.

Provisioned Spanish venues also rejected the mechanically converted English-only category maps
with `content.translation_required`. Their test fixtures now use the venue's `LOCALE`, retaining
the same labels and behavioral assertions. The affected server batch passed 19 files / 354 tests,
and server typechecking passed. The four provisioned Spanish demo inputs use Spanish category
translations as well. The standalone catalogue demo command needs an explicitly supplied database;
its initial launch without `DATABASE_URL` stopped before database access.
