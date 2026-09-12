# Build Categories

Branch: `products-categories`. Read the [spec](../specs/2026-09-12-product-categories-design.md) and
[shared contract](../specs/2026-09-12-products-overhaul-design.md).
Implementation and validation receipts are recorded below.

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
venue-service, media, db and recipes typechecks passed. Branch finishing, the normal push hook,
external review and current-head CI remain for the owner's `finish-branch` instruction.
