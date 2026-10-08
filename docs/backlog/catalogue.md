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
