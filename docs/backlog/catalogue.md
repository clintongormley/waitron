# Menus and the catalogue — detail

The open entries are listed in [the backlog](../backlog.md), under "Menus and the catalogue". This file holds
their full text.

## `mergeAllergenMaps` (`src/derivation.ts`) can list a source twice and order sources differently from run to run

- Found by #603 (`packages/catalogue`). **`mergeAllergenMaps` (`src/derivation.ts`) can list a
  source twice and order sources differently from run to run**: `recomputeProductDerivations`
  (`packages/recipes/src/recipes.ts`) feeds it ingredient rows in no fixed order, and #603's
  review measured, with three or more sources, barley/rye/wheat folded in two orders giving
  "barley, rye, wheat" and "barley, wheat, rye", and barley/rye/barley giving "barley, barley,
  rye". The comment now says so; the code is unchanged. Read only, not run: `writeItems`
  (`src/extras.ts`) and `writeLabels` (`src/options.ts`) each keep a refusal after their insert
  that looks unreachable now (duplicate and foreign ids are refused earlier and one write runs at
  a time). `MAX_MODIFIER_INTEGER` (`src/modifier-limits.ts`, 2147483647) and the extras
  contract's `whole` bound were PostgreSQL's integer maximum and have no stated reason on this
  engine; the test names "refuses a pick bound above what the column can hold" and "refuses a
  maxQuantity above what the column can hold" (`src/extra-contract.test.ts`) assume a column
  limit. `assertRefsExist` (`src/product-modifiers.ts`) still reads lists in sorted key order,
  which served PostgreSQL's lock ordering only. Four configuration-transfer cases (in
  `options.test.ts`, `product-modifiers.test.ts`, `extras.test.ts` and
  `extra-projection.test.ts`) pin an insert order that the importer's
  `pragma defer_foreign_keys` makes unnecessary for foreign keys — whether to keep pinning it is
  the owner's call. Test titles a comments-only change cannot touch: `describe("validateContainsTag
(Task 4)")` and `describe("validateDietOverride (Task 4)")` (`src/dietary.test.ts`), "settles
  a product id sent in upper case in the database" (`src/product-modifiers.test.ts`, the code
  settles it now), "rebuilds every lookup index without the tenant" (`src/migrations.test.ts`).

## The media library still reads every matching image for search and name sorting, inside the venue write lock

**The media library still reads every matching image for search and name sorting, inside the venue
write lock — OPEN (found 2026-09-23, task F1's review wave).** The unsearched date sort counts,
orders and pages in SQL, reading only the page's metadata. Search still scores and pages in
JavaScript, and name sorting still uses `Intl.Collator` for accented names.
`listImageTranslationGaps` still reads all rows of its selected columns. The route
(`GET /management-api/images`) uses `withTransaction`, the venue's exclusive write lock, so these
remaining scans can delay a sale. **Next action:** decide how far to push search ranking into SQL;
measure a way to bound name sorting without changing its results.

## A negative catalogue price can still be stored by a direct call

**A negative catalogue price can still be stored by a direct call — OPEN (left by #487).** A
negative catalogue price is never valid (owner ruling 2026-09-21); the product-create and menu-item writes in
`apps/server/src/catalogue-api.ts` refuse one at the request boundary. `createProduct` and
`updateProduct` (`packages/catalogue/src/operations.ts`) still accept and store a negative when
called directly — a seed, a script or a future caller — and `products.unit_price` carries no
`>= 0` check. Decide whether the screen belongs in the ops or as a `products.unit_price >= 0` check
beside the sibling price checks the other catalogue tables carry; the column is an integer count of
cents, so a check constraint is now the only thing that would refuse it at the database.

## Two price rules disagree about a value that is not negative

**Two price rules disagree about a value that is not negative — OPEN (found 2026-09-21, task N4).**
`isProductPrice` (`packages/catalogue/src/modifier-limits.ts:12`) allows at most two decimal places
and ten whole digits; `stringToCents` (the `decimal()` + `decimalToCents` pair) that the
screened catalogue writes use allows any number of decimals and twelve whole digits, and ROUNDS the
excess. So `POST /management-api/products` with `unitPrice: "1.999"` stores `2.00` without saying
so, while the product-editor route refuses the same value with `product.invalid`; an eleven-digit
price splits the same way, and `-0.00` is accepted by one and refused by the other. Widening the
four routes to `isProductPrice` would start refusing values that save today. **Next action:** decide
whether one rule should govern every catalogue price, and if so which — and check each dashboard
form against it before changing the server, since a server stricter than its own form is the
failure #485 met.
