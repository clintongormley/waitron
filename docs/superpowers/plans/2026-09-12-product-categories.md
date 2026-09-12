# Build Categories

Branch: `products-categories`. Read the [spec](../specs/2026-09-12-product-categories-design.md) and
[shared contract](../specs/2026-09-12-products-overhaul-design.md). Implementation is not started.

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
