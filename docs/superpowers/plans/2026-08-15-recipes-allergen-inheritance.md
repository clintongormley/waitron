# Recipes / BOM — slice 1 (allergen inheritance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional recipe/ingredient model so a product's EU-1169 allergen declaration is derived from its ingredients (add-only over a manual overlay), while the shipped direct-tag path keeps working unchanged.

**Architecture:** Two new tenant-scoped tables (`ingredients`, `recipe_lines`) live in `packages/db` beside `products` (the catalogue precedent). A product's published `products.allergens` becomes a *computed* union of two overlays on the same row — `manual_allergens` (what staff typed) and `recipe_derivation` (`{allergens, pending}`, written by the recipe module). The pure merge/publish logic lives in `@waitron/catalogue`; the new package `@waitron/recipes` owns the ingredient/recipe ops and calls catalogue to republish. Nothing depends on `@waitron/recipes`, so with zero recipe rows the system behaves exactly as today.

**Tech Stack:** TypeScript, Drizzle ORM (`^0.45.2`), PostgreSQL (real, via Testcontainers) + PGlite (`@electric-sql/pglite`), Vitest (`^3`), pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-08-15-recipes-bom-allergen-inheritance-design.md](../specs/2026-08-15-recipes-bom-allergen-inheritance-design.md)

## Global Constraints

- **No backwards-compat / data-migration code** — pre-production; schema changes drop & recreate. No backfill from the old `allergens` semantics into `manual_allergens`.
- **Fiscal boundary (H2):** touch nothing in `packages/verifactu` / `packages/fiscal-verifactu` source, `registros_facturacion`, the hash chain, invoice numbers, `envios`, `acks`, or `computeHuella`. `products.allergens` feeds no fiscal path (verified in the spec §5).
- **Every tenant-scoped table needs FORCE RLS + a tenant-isolation policy + grants** in a hand-written custom migration — `.enableRLS()` alone is insufficient. Verified by the fiscal-verifactu `inmutabilidad` guard.
- **Never build SQL by string concatenation** — Drizzle query builders / parameterised `sql` only. Utility statements (none here) would be the only exception.
- **Never widen a grant to pass a test.** `ingredients` gets `SELECT, INSERT, UPDATE` (no DELETE — deactivate via `active`); `recipe_lines` gets `SELECT, INSERT, UPDATE, DELETE` (recipe replacement deletes lines).
- **Error codes name the domain concept**, `import "./errors.js"` in any file that throws one. This slice adds none (reuses catalogue's `allergen.*`; relies on FK constraints for referential integrity — matching catalogue's deferral of `*.not_found` pre-checks).
- **Coverage thresholds:** statements 98 / lines 98 / functions 98 / branches 95 (non-browser packages).
- **Commit every commit with `-s`** (`git commit -s`). CI's `dco` job walks the range.
- **Gate before pushing:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus `pnpm --filter <pkg> test:coverage` for touched packages, plus the whole-workspace run for the cross-cutting guard task (Task 7).

---

## File structure

**`packages/db`** (schema + migrations — tables live here per spec D8):
- Create `packages/db/src/schema/recipes.ts` — `ingredients`, `recipeLines` Drizzle tables.
- Modify `packages/db/src/schema/catalogue.ts` — add `manualAllergens`, `recipeDerivation` columns to `products`.
- Modify `packages/db/src/schema/index.ts` and `packages/db/src/index.ts` — export the new tables.
- Create `packages/db/drizzle/0038_recipes_and_allergen_overlays.sql` (auto, drizzle-kit) and `packages/db/drizzle/0039_recipes_rls.sql` (custom, hand-written).

**`packages/catalogue`** (pure derivation + republication):
- Create `packages/catalogue/src/derivation.ts` — pure `mergeAllergenMaps`, `republish`.
- Modify `packages/catalogue/src/operations.ts` — `republishProduct`, `applyRecipeDerivation`, retarget `createProduct`/`updateProduct` to `manual_allergens` + republish.
- Modify `packages/catalogue/src/index.ts` — export the new symbols.

**`packages/recipes`** (new package — ops only):
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`.
- `src/ingredients.ts` — ingredient CRUD.
- `src/recipes.ts` — `setProductRecipe`/`getProductRecipe`/`recomputeProductAllergens` + propagation.
- `src/testing/postgres.ts` — real-PG starter (mirrors catalogue's).
- `test/fixtures.ts` — `seedVenue` + product seed.
- `src/*.test.ts` (PGlite) + `src/*.rls.test.ts` (real PG).

**Cross-cutting:**
- Modify `packages/db/src/english-only.ts` — add `"recipes"` to `GENERIC_PACKAGES`.
- Modify `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` — update the pinned `GENERIC_PACKAGES` regex.

**Demo:**
- Create `apps/server/scripts/recipes-demo.ts`.

---

## Task 1: Pure allergen derivation core (`@waitron/catalogue`)

**Files:**
- Create: `packages/catalogue/src/derivation.ts`
- Test: `packages/catalogue/src/derivation.test.ts`
- Modify: `packages/catalogue/src/index.ts`

**Interfaces:**
- Consumes: `AllergenDeclaration`, `ProductAllergens` from `./allergens.js`.
- Produces:
  - `type RecipeDerivation = { allergens: ProductAllergens; pending: boolean }`
  - `mergeAllergenMaps(a: ProductAllergens, b: ProductAllergens): ProductAllergens`
  - `republish(manual: ProductAllergens | null, derivation: RecipeDerivation | null): ProductAllergens | null`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/catalogue/src/derivation.test.ts
import { describe, expect, it } from "vitest";
import { mergeAllergenMaps, republish } from "./derivation.js";

describe("mergeAllergenMaps", () => {
  it("unions keys; contains dominates may_contain", () => {
    const a = { eggs: { presence: "contains" as const } };
    const b = { eggs: { presence: "may_contain" as const }, nuts: { presence: "may_contain" as const } };
    expect(mergeAllergenMaps(a, b)).toEqual({
      eggs: { presence: "contains" },
      nuts: { presence: "may_contain" },
    });
  });

  it("comma-joins distinct non-empty sources into one string", () => {
    const a = { eggs: { presence: "contains" as const, source: "egg" } };
    const b = { eggs: { presence: "contains" as const, source: "mayonnaise" } };
    expect(mergeAllergenMaps(a, b)).toEqual({
      eggs: { presence: "contains", source: "egg, mayonnaise" },
    });
  });

  it("keeps a lone code's own presence (may_contain stays may_contain)", () => {
    expect(mergeAllergenMaps({}, { nuts: { presence: "may_contain" as const } })).toEqual({
      nuts: { presence: "may_contain" },
    });
  });
});

describe("republish", () => {
  it("is PENDING (null) when nothing is reviewed", () => {
    expect(republish(null, null)).toBeNull();
  });
  it("is PENDING (null) when the recipe has an unreviewed ingredient", () => {
    expect(republish({ nuts: { presence: "contains" } }, { allergens: {}, pending: true })).toBeNull();
  });
  it("returns the manual map when there is no recipe", () => {
    expect(republish({ gluten: { presence: "contains" } }, null)).toEqual({
      gluten: { presence: "contains" },
    });
  });
  it("returns {} for a product reviewed with no allergens", () => {
    expect(republish({}, null)).toEqual({});
  });
  it("unions the derived floor with manual additions (add-only)", () => {
    expect(
      republish(
        { nuts: { presence: "may_contain" } },
        { allergens: { eggs: { presence: "contains" } }, pending: false },
      ),
    ).toEqual({ eggs: { presence: "contains" }, nuts: { presence: "may_contain" } });
  });
  it("publishes a complete recipe with no manual overlay", () => {
    expect(republish(null, { allergens: { eggs: { presence: "contains" } }, pending: false })).toEqual({
      eggs: { presence: "contains" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/catalogue test derivation`
Expected: FAIL — `derivation.js` not found / functions not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/catalogue/src/derivation.ts
import type { AllergenDeclaration, ProductAllergens } from "./allergens.js";

/** The recipe module's overlay: the derived allergen floor, plus whether the derivation is
 * incomplete (a recipe with at least one unreviewed ingredient). `pending` forces the product
 * PENDING regardless of the floor, so an unreviewed ingredient never reads as allergen-free. */
export interface RecipeDerivation {
  allergens: ProductAllergens;
  pending: boolean;
}

/** Union two allergen maps. A code present in both takes `contains` if either does (contains
 * dominates may_contain); its `source` is the distinct non-empty sources comma-joined into one
 * string (catalogue's type keeps `source` a single string). */
export function mergeAllergenMaps(a: ProductAllergens, b: ProductAllergens): ProductAllergens {
  const out: ProductAllergens = {};
  for (const code of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const da = a[code];
    const db = b[code];
    const presence: AllergenDeclaration["presence"] =
      da?.presence === "contains" || db?.presence === "contains" ? "contains" : "may_contain";
    const sources = [...new Set([da?.source, db?.source].filter((s): s is string => Boolean(s)))];
    const decl: AllergenDeclaration = { presence };
    if (sources.length > 0) decl.source = sources.join(", ");
    out[code] = decl;
  }
  return out;
}

/** Compute the published declaration from the two overlays. `null` = PENDING (unreviewed). */
export function republish(
  manual: ProductAllergens | null,
  derivation: RecipeDerivation | null,
): ProductAllergens | null {
  if (derivation?.pending) return null; // unreviewed ingredient in the recipe
  if (manual === null && derivation === null) return null; // nothing reviewed at all
  return mergeAllergenMaps(derivation?.allergens ?? {}, manual ?? {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/catalogue test derivation`
Expected: PASS (all cases).

- [ ] **Step 5: Export from the barrel and prove by deletion**

Add to `packages/catalogue/src/index.ts` (the barrel is `export *` style — match it):
```typescript
export * from "./derivation.js";
```
Then prove the `contains`-dominates guard: change `da?.presence === "contains" || db?.presence === "contains"` to `false`, run the test, confirm the "contains dominates" case FAILS, restore, confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/catalogue/src/derivation.ts packages/catalogue/src/derivation.test.ts packages/catalogue/src/index.ts
git commit -s -m "feat(catalogue): pure allergen merge + republish (recipes slice 1)"
```

---

## Task 2: Schema + migrations (`packages/db`)

**Files:**
- Create: `packages/db/src/schema/recipes.ts`
- Modify: `packages/db/src/schema/catalogue.ts` (add two columns to `products`)
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts` (exports)
- Create: `packages/db/drizzle/0038_recipes_and_allergen_overlays.sql` (drizzle-kit generate)
- Create: `packages/db/drizzle/0039_recipes_rls.sql` (custom, hand-written)
- Test: `packages/db/src/schema/recipes.test.ts`

**Interfaces:**
- Produces (Drizzle tables, imported by later tasks from `@waitron/db`):
  - `ingredients` — columns `id, tenantId, name, allergens (jsonb|null), active, createdAt, updatedAt`
  - `recipeLines` — columns `id, tenantId, productId, ingredientId, createdAt`
  - `products.manualAllergens` (jsonb|null), `products.recipeDerivation` (jsonb|null, `{allergens, pending}`)

- [ ] **Step 1: Add the products overlay columns**

In `packages/db/src/schema/catalogue.ts`, inside the `products` table definition (after `allergens`), add:
```typescript
    // Staff-authored allergen overlay — what a human explicitly declared. NULL = not reviewed.
    // `allergens` (published) is the computed union of this and `recipe_derivation`; the recipe
    // module (@waitron/recipes) writes `recipe_derivation`, catalogue republishes `allergens`.
    manualAllergens:
      jsonb("manual_allergens").$type<
        Record<string, { presence: "contains" | "may_contain"; source?: string }>
      >(),
    // The recipe module's derived floor + a `pending` flag (a recipe with an unreviewed ingredient).
    // NULL = no recipe / module unused. Written only via catalogue's applyRecipeDerivation.
    recipeDerivation:
      jsonb("recipe_derivation").$type<{
        allergens: Record<string, { presence: "contains" | "may_contain"; source?: string }>;
        pending: boolean;
      }>(),
```

- [ ] **Step 2: Create the recipes schema**

```typescript
// packages/db/src/schema/recipes.ts
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { products } from "./catalogue.js";

/** A raw material / prep item. Carries its own EU-1169 allergen declaration (the same shape as
 * `products.allergens`); NULL = not yet reviewed (a PENDING ingredient, contagious up a recipe).
 * Deactivate via `active`, never DELETE — it may be referenced by `recipe_lines`. */
export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    allergens:
      jsonb("allergens").$type<
        Record<string, { presence: "contains" | "may_contain"; source?: string }>
      >(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("ingredients_tenant_id_idx").on(t.tenantId)],
).enableRLS();

/** The flat composition: which ingredients a product is made of. No quantity this slice (allergen
 * presence is qualitative). One row per (product, ingredient). */
export const recipeLines = pgTable(
  "recipe_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("recipe_lines_product_id_idx").on(t.productId),
    unique("recipe_lines_product_ingredient_key").on(t.productId, t.ingredientId),
  ],
).enableRLS();
```

Note: if v8 coverage flags an uncovered `.references(() => …)` thunk, switch that FK to the array `foreignKey({ columns: [...], foreignColumns: [...] })` form, as `packages/workforce/src/schema/shifts.ts` does and documents. `catalogue.ts` uses `.references()` and passes, so try `.references()` first.

- [ ] **Step 3: Wire the exports (two barrels — both required)**

1. `packages/db/src/schema/index.ts` — add `export * from "./recipes.js";` beside the `./catalogue.js` line. **This barrel is what `drizzle-kit generate` reads** (`packages/db/drizzle.config.ts` points `schema` at `./src/schema/index.ts`), so the new tables are invisible to Step 4's generate without it.
2. `packages/db/src/index.ts` — add `export { ingredients, recipeLines } from "./schema/recipes.js";` beside the existing `export { catalogues, categories, products } from "./schema/catalogue.js";` line (this barrel uses **named** per-table exports, not `export *`). This is the public API `@waitron/catalogue` and `@waitron/recipes` import from.

- [ ] **Step 4: Generate the auto migration**

Run: `pnpm --filter @waitron/db db:generate --name recipes_and_allergen_overlays`
Expected: creates `packages/db/drizzle/0038_recipes_and_allergen_overlays.sql` containing `CREATE TABLE "ingredients"`, `CREATE TABLE "recipe_lines"`, `ALTER TABLE "ingredients"/"recipe_lines" ENABLE ROW LEVEL SECURITY`, and `ALTER TABLE "products" ADD COLUMN "manual_allergens" jsonb` + `"recipe_derivation" jsonb`. Inspect the file; confirm no unexpected drift on other tables. (If the db script is not literally `db:generate`, check `packages/db/package.json` scripts — identity uses `db:generate`/`db:generate:custom`.)

- [ ] **Step 5: Hand-write the custom RLS migration**

Run: `pnpm --filter @waitron/db db:generate:custom --name recipes_rls` to get an empty `0039_recipes_rls.sql`, then write:
```sql
-- Hand-written (--custom; drizzle-kit has no concept of policies, FORCE, or privileges), same as
-- packages/credentials/drizzle/0001_credentials_rls.sql. current_tenant_id() already exists
-- (packages/db 0001_tenancy_rls.sql). ingredients: no DELETE (deactivate via `active`); recipe_lines:
-- DELETE granted (setProductRecipe replaces a product's lines).
--> statement-breakpoint
ALTER TABLE "ingredients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "ingredients_tenant_isolation" ON "ingredients"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "ingredients" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "ingredients" TO app_user;--> statement-breakpoint

ALTER TABLE "recipe_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "recipe_lines_tenant_isolation" ON "recipe_lines"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "recipe_lines" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "recipe_lines" TO app_user;
```

- [ ] **Step 6: Write the migration-applies test**

```typescript
// packages/db/src/schema/recipes.test.ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";

const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

describe("recipes schema", () => {
  it("creates the ingredients and recipe_lines tables and the products overlay columns", async () => {
    const tables = await fx.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_name in ('ingredients','recipe_lines') order by table_name`);
    expect(tables.rows.map((r) => r.table_name)).toEqual(["ingredients", "recipe_lines"]);

    const cols = await fx.db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_name = 'products' and column_name in ('manual_allergens','recipe_derivation')
      order by column_name`);
    expect(cols.rows.map((r) => r.column_name)).toEqual(["manual_allergens", "recipe_derivation"]);
  });
});
```

- [ ] **Step 7: Run migration + typecheck**

Run: `pnpm --filter @waitron/db test recipes` — Expected: PASS.
Run: `pnpm --filter @waitron/db typecheck` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/recipes.ts packages/db/src/schema/catalogue.ts packages/db/src/schema/index.ts packages/db/src/index.ts packages/db/drizzle/0038_recipes_and_allergen_overlays.sql packages/db/drizzle/0039_recipes_rls.sql packages/db/drizzle/meta packages/db/src/schema/recipes.test.ts
git commit -s -m "feat(db): ingredients + recipe_lines tables, products allergen overlays (recipes slice 1)"
```

---

## Task 3: Catalogue republication wiring

**Files:**
- Modify: `packages/catalogue/src/operations.ts`
- Modify: `packages/catalogue/src/index.ts`
- Test: `packages/catalogue/src/operations.test.ts` (add cases)

**Interfaces:**
- Consumes: `republish`, `RecipeDerivation` (Task 1); `ingredients`/`recipeLines` not needed here.
- Produces:
  - `applyRecipeDerivation(tx: Transaction, productId: string, derivation: RecipeDerivation | null): Promise<void>` — used by `@waitron/recipes` (Task 5).
  - `createProduct`/`updateProduct` now write `manual_allergens` and republish `allergens`.

- [ ] **Step 1: Write the failing tests** (add to `operations.test.ts`)

```typescript
// A product with no recipe still publishes exactly the manual value (today's behavior).
it("createProduct publishes the manual allergen map when there is no recipe", async () => {
  const result = await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "C" });
    const p = await createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en: "sandwich" },
      pricingUnit: "each", unitPrice: "3.00", vatClass: "general",
      allergens: { gluten: { presence: "contains" } },
    });
    return p;
  });
  expect(result.allergens).toEqual({ gluten: { presence: "contains" } });
});

// applyRecipeDerivation unions the floor over the manual overlay (add-only).
it("applyRecipeDerivation republishes allergens as floor ∪ manual", async () => {
  const seen = await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "C" });
    const p = await createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en: "sandwich" },
      pricingUnit: "each", unitPrice: "3.00", vatClass: "general",
      allergens: { nuts: { presence: "may_contain" } },
    });
    await applyRecipeDerivation(tx, p.id, { allergens: { eggs: { presence: "contains" } }, pending: false });
    const [row] = await listProducts(tx, cat.id);
    return row!.allergens;
  });
  expect(seen).toEqual({ eggs: { presence: "contains" }, nuts: { presence: "may_contain" } });
});

// A pending derivation forces PENDING (null), even with a manual overlay present.
it("applyRecipeDerivation with pending=true publishes PENDING (null)", async () => {
  const seen = await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "C" });
    const p = await createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en: "x" },
      pricingUnit: "each", unitPrice: "1.00", vatClass: "general",
      allergens: { nuts: { presence: "contains" } },
    });
    await applyRecipeDerivation(tx, p.id, { allergens: {}, pending: true });
    const [row] = await listProducts(tx, cat.id);
    return row!.allergens;
  });
  expect(seen).toBeNull();
});
```
Add `applyRecipeDerivation` to the import from `./operations.js` at the top of the test file.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @waitron/catalogue test operations`
Expected: FAIL — `applyRecipeDerivation` not exported; the create test may already pass (allergens still round-trips) — that's fine, it's the guard against regression.

- [ ] **Step 3: Implement in `operations.ts`**

Add imports and a `PRODUCTS` overlay column reference; add the helpers and retarget create/update:
```typescript
import { republish, type RecipeDerivation } from "./derivation.js";

// Republish products.allergens from the two overlays on the row. Called after any change to
// manual_allergens (createProduct/updateProduct) or recipe_derivation (applyRecipeDerivation).
async function republishProduct(tx: Transaction, id: string): Promise<void> {
  const [row] = await tx
    .select({ manual: products.manualAllergens, derivation: products.recipeDerivation })
    .from(products)
    .where(eq(products.id, id));
  const published = republish(row?.manual ?? null, row?.derivation ?? null);
  await tx.update(products).set({ allergens: published }).where(eq(products.id, id));
}

/** Set a product's recipe-derived overlay and republish its declaration. Called by @waitron/recipes;
 * `null` clears the derivation (no recipe). */
export async function applyRecipeDerivation(
  tx: Transaction,
  productId: string,
  derivation: RecipeDerivation | null,
): Promise<void> {
  await tx
    .update(products)
    .set({ recipeDerivation: derivation, updatedAt: sql`now()` })
    .where(eq(products.id, productId));
  await republishProduct(tx, productId);
}
```

Change `createProduct`'s insert to write both overlays (at create there is no recipe, so `allergens` = republish(manual, null) = manual):
```typescript
  const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);
  const [row] = await tx
    .insert(products)
    .values({
      tenantId: CURRENT_TENANT,
      catalogueId: input.catalogueId,
      categoryId: input.categoryId,
      descriptions: input.descriptions,
      pricingUnit: input.pricingUnit,
      unitPrice: input.unitPrice,
      vatClass: input.vatClass,
      active: input.active ?? true,
      manualAllergens: allergens,
      allergens: republish(allergens, null),
      image: input.image ?? null,
    })
    .returning(PRODUCT_COLUMNS);
  return toProduct(row!);
```

Change `updateProduct` to split the allergens patch out, write it to `manual_allergens`, then republish:
```typescript
export async function updateProduct(
  tx: Transaction,
  id: string,
  patch: UpdateProductInput,
): Promise<void> {
  const { allergens, ...rest } = patch;
  const setValues: Record<string, unknown> = { ...rest, updatedAt: sql`now()` };
  if (allergens !== undefined) {
    if (allergens != null) validateAllergens(allergens);
    setValues.manualAllergens = allergens;
  }
  await tx.update(products).set(setValues).where(eq(products.id, id));
  if (allergens !== undefined) await republishProduct(tx, id);
}
```

- [ ] **Step 4: Run (no barrel edit needed)**

`packages/catalogue/src/index.ts` already does `export * from "./operations.js";`, so `applyRecipeDerivation` is exported automatically — no index change.
Run: `pnpm --filter @waitron/catalogue test operations` — Expected: PASS.

- [ ] **Step 5: Prove the republish path by deletion**

In `updateProduct`, temporarily delete the `if (allergens !== undefined) await republishProduct(tx, id);` line, run the "applyRecipeDerivation republishes" test's sibling — actually confirm via a targeted mutation: in `republishProduct`, replace `republish(row?.manual ?? null, row?.derivation ?? null)` with `row?.manual ?? null` (skip the floor) and confirm the "floor ∪ manual" test FAILS; restore and confirm PASS.

- [ ] **Step 6: Coverage check + commit**

Run: `pnpm --filter @waitron/catalogue test:coverage` — Expected: PASS at 98/98/98/95.
```bash
git add packages/catalogue/src/operations.ts packages/catalogue/src/index.ts packages/catalogue/src/operations.test.ts
git commit -s -m "feat(catalogue): publish allergens from manual + recipe overlays (recipes slice 1)"
```

---

## Task 4: `@waitron/recipes` package scaffold + ingredient ops

**Files:**
- Create: `packages/recipes/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`
- Create: `packages/recipes/src/ingredients.ts`
- Create: `packages/recipes/test/fixtures.ts`, `packages/recipes/src/testing/postgres.ts`
- Test: `packages/recipes/src/ingredients.test.ts`

**Interfaces:**
- Consumes: `ingredients` table (`@waitron/db`), `validateAllergens`/`ProductAllergens` (`@waitron/catalogue`), `Transaction`, `usePgliteDb`, `withTenant`, `asAppUser`.
- Produces:
  - `interface Ingredient { id: string; name: string; allergens: ProductAllergens | null; active: boolean }`
  - `createIngredient(tx, { name, allergens? }): Promise<Ingredient>`
  - `updateIngredient(tx, id, { name?, allergens?, active? }): Promise<void>` (propagation added in Task 5)
  - `listIngredients(tx): Promise<Ingredient[]>`, `getIngredient(tx, id): Promise<Ingredient | null>`

- [ ] **Step 1: Scaffold the package**

`packages/recipes/package.json` (model on `packages/catalogue/package.json`):
```json
{
  "name": "@waitron/recipes",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@waitron/catalogue": "workspace:*",
    "@waitron/db": "workspace:*",
    "@waitron/shared": "workspace:*",
    "drizzle-orm": "^0.45.2"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.4",
    "@testcontainers/postgresql": "^12.0.4",
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```
Copy `packages/catalogue/tsconfig.json` and `packages/catalogue/vitest.config.ts` verbatim into `packages/recipes/` (they are package-relative; confirm coverage thresholds match 98/98/98/95). Run `pnpm install` at the repo root to register the workspace package.

- [ ] **Step 2: Write the test harness**

`packages/recipes/src/testing/postgres.ts` — copy `packages/catalogue/src/testing/postgres.ts` verbatim (it runs `[CORE_MIGRATIONS]`, which now contains the recipe tables), adjusting the doc comment to say "recipes".

`packages/recipes/test/fixtures.ts` — a `seedVenue` + a product seed, importing catalogue's `createCatalogue`/`createProduct`:
```typescript
import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { asAppUser, withTenant } from "@waitron/db";
import { createCatalogue, createProduct } from "@waitron/catalogue";
import { locationId as brandLocationId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";

export interface SeededVenue { tenantId: TenantId; locationId: string }

export async function seedVenue(db: Database): Promise<SeededVenue> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en-GB'], 'Test op') returning id`);
  const locationId = loc.rows[0]!.id;
  await seedNode(db, tenantId, brandLocationId(locationId));
  return { tenantId, locationId };
}

/** Seed a catalogue + one product; returns the product id, for recipe tests. */
export async function seedProduct(db: Database, tenantId: TenantId): Promise<string> {
  return withTenant(db, tenantId, async (tx: Transaction) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Deli" });
    const p = await createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en: "bocadillo" },
      pricingUnit: "each", unitPrice: "3.50", vatClass: "general",
    });
    return p.id;
  });
}
```
(Confirm `seedTenant`/`seedNode` signatures against `packages/catalogue/test/fixtures.ts`.)

- [ ] **Step 3: Write the failing ingredient test**

```typescript
// packages/recipes/src/ingredients.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { createIngredient, getIngredient, listIngredients, updateIngredient } from "./ingredients.js";
import { seedVenue } from "../test/fixtures.js";

const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

describe("ingredient operations", () => {
  let tenantId: TenantId;
  beforeEach(async () => {
    ({ tenantId } = await seedVenue(fx.db));
  });

  it("creates an ingredient with allergens and reads it back", async () => {
    const result = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const created = await createIngredient(tx, {
        name: "alioli",
        allergens: { eggs: { presence: "contains" } },
      });
      return { created, list: await listIngredients(tx), fetched: await getIngredient(tx, created.id) };
    });
    expect(result.created.name).toBe("alioli");
    expect(result.created.allergens).toEqual({ eggs: { presence: "contains" } });
    expect(result.list).toHaveLength(1);
    expect(result.fetched?.id).toBe(result.created.id);
  });

  it("creates an unreviewed (PENDING) ingredient when allergens are omitted", async () => {
    const created = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return createIngredient(tx, { name: "mystery paste" });
    });
    expect(created.allergens).toBeNull();
  });

  it("rejects an invalid allergen code", async () => {
    await expect(
      withTenant(fx.db, tenantId, async (tx) => {
        await asAppUser(tx);
        return createIngredient(tx, { name: "x", allergens: { banana: { presence: "contains" } } as never });
      }),
    ).rejects.toThrow();
  });

  it("updates name and allergens", async () => {
    const after = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const c = await createIngredient(tx, { name: "alioli" });
      await updateIngredient(tx, c.id, { allergens: { eggs: { presence: "contains" } } });
      return getIngredient(tx, c.id);
    });
    expect(after?.allergens).toEqual({ eggs: { presence: "contains" } });
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @waitron/recipes test ingredients`
Expected: FAIL — `ingredients.js` / functions missing.

- [ ] **Step 5: Implement `ingredients.ts`**

```typescript
// packages/recipes/src/ingredients.ts
import { eq, sql } from "drizzle-orm";
import { ingredients } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { validateAllergens, type ProductAllergens } from "@waitron/catalogue";

/** The tenant scope as an insertable value — reads the GUC the caller set via withTenant. */
const CURRENT_TENANT = sql`current_tenant_id()`;

export interface Ingredient {
  id: string;
  name: string;
  /** EU-1169 declaration, or null when not yet reviewed (a PENDING ingredient). */
  allergens: ProductAllergens | null;
  active: boolean;
}

const INGREDIENT_COLUMNS = {
  id: ingredients.id,
  name: ingredients.name,
  allergens: ingredients.allergens,
  active: ingredients.active,
};

export interface CreateIngredientInput {
  name: string;
  /** Omitted leaves it null (unreviewed); validated against the EU-14 taxonomy on insert. */
  allergens?: ProductAllergens;
}

export interface UpdateIngredientInput {
  name?: string;
  /** `null` clears the declaration back to unreviewed; omitted leaves it unchanged. */
  allergens?: ProductAllergens | null;
  active?: boolean;
}

export async function createIngredient(
  tx: Transaction,
  input: CreateIngredientInput,
): Promise<Ingredient> {
  const allergens = input.allergens === undefined ? null : validateAllergens(input.allergens);
  const [row] = await tx
    .insert(ingredients)
    .values({ tenantId: CURRENT_TENANT, name: input.name, allergens })
    .returning(INGREDIENT_COLUMNS);
  return row!;
}

export async function listIngredients(tx: Transaction): Promise<Ingredient[]> {
  return tx
    .select(INGREDIENT_COLUMNS)
    .from(ingredients)
    .orderBy(ingredients.createdAt, ingredients.id);
}

export async function getIngredient(tx: Transaction, id: string): Promise<Ingredient | null> {
  const [row] = await tx.select(INGREDIENT_COLUMNS).from(ingredients).where(eq(ingredients.id, id));
  return row ?? null;
}

export async function updateIngredient(
  tx: Transaction,
  id: string,
  patch: UpdateIngredientInput,
): Promise<void> {
  if (patch.allergens != null) validateAllergens(patch.allergens);
  await tx
    .update(ingredients)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(ingredients.id, id));
  // Propagation to dependent products is added in Task 5.
}
```

- [ ] **Step 6: Barrel + run**

`packages/recipes/src/index.ts`:
```typescript
export * from "./ingredients.js";
```
Run: `pnpm --filter @waitron/recipes test ingredients` — Expected: PASS.
Run: `pnpm --filter @waitron/recipes typecheck` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/recipes pnpm-lock.yaml
git commit -s -m "feat(recipes): new package + ingredient ops (slice 1)"
```

---

## Task 5: Recipe composition, derivation, and propagation

**Files:**
- Create: `packages/recipes/src/recipes.ts`
- Modify: `packages/recipes/src/ingredients.ts` (wire propagation into `updateIngredient`)
- Modify: `packages/recipes/src/index.ts`
- Test: `packages/recipes/src/recipes.test.ts`

**Interfaces:**
- Consumes: `recipeLines`/`ingredients` (`@waitron/db`), `applyRecipeDerivation`/`mergeAllergenMaps`/`RecipeDerivation` (`@waitron/catalogue`), `createIngredient` (Task 4).
- Produces:
  - `setProductRecipe(tx, productId, ingredientIds: string[]): Promise<void>`
  - `getProductRecipe(tx, productId): Promise<Ingredient[]>`
  - `recomputeProductAllergens(tx, productId): Promise<void>`

- [ ] **Step 1: Write the failing tests** (the headline scenarios)

```typescript
// packages/recipes/src/recipes.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, products, withTenant } from "@waitron/db";
import { eq } from "drizzle-orm";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { createIngredient, updateIngredient } from "./ingredients.js";
import { getProductRecipe, setProductRecipe } from "./recipes.js";
import { seedProduct, seedVenue } from "../test/fixtures.js";

const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

async function publishedAllergens(tenantId: TenantId, productId: string) {
  return withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const [row] = await tx.select({ a: products.allergens }).from(products).where(eq(products.id, productId));
    return row!.a;
  });
}

describe("recipe composition and allergen derivation", () => {
  let tenantId: TenantId;
  let productId: string;
  beforeEach(async () => {
    ({ tenantId } = await seedVenue(fx.db));
    productId = await seedProduct(fx.db, tenantId);
  });

  it("derives a product's allergens from its ingredients (the alioli scenario)", async () => {
    const published = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const alioli = await createIngredient(tx, { name: "alioli", allergens: { eggs: { presence: "contains" } } });
      const bread = await createIngredient(tx, { name: "bread", allergens: { gluten: { presence: "contains" } } });
      await setProductRecipe(tx, productId, [alioli.id, bread.id]);
      const [row] = await tx.select({ a: products.allergens }).from(products).where(eq(products.id, productId));
      return row!.a;
    });
    expect(published).toEqual({ eggs: { presence: "contains" }, gluten: { presence: "contains" } });
  });

  it("keeps a product PENDING (null) when an ingredient is unreviewed", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mystery = await createIngredient(tx, { name: "mystery" }); // allergens null → PENDING
      await setProductRecipe(tx, productId, [mystery.id]);
    });
    expect(await publishedAllergens(tenantId, productId)).toBeNull();
  });

  it("propagates an ingredient's allergen change to every product using it", async () => {
    const before = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const alioli = await createIngredient(tx, { name: "alioli" }); // unreviewed
      await setProductRecipe(tx, productId, [alioli.id]);
      const [r] = await tx.select({ a: products.allergens }).from(products).where(eq(products.id, productId));
      // tag alioli AFTER it is already in the recipe:
      await updateIngredient(tx, alioli.id, { allergens: { eggs: { presence: "contains" } } });
      return r!.a;
    });
    expect(before).toBeNull(); // was PENDING before the ingredient was tagged
    expect(await publishedAllergens(tenantId, productId)).toEqual({ eggs: { presence: "contains" } });
  });

  it("clearing the recipe drops back to the manual overlay", async () => {
    await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const egg = await createIngredient(tx, { name: "egg", allergens: { eggs: { presence: "contains" } } });
      await setProductRecipe(tx, productId, [egg.id]);
      await setProductRecipe(tx, productId, []); // clear
    });
    // seedProduct created the product with no manual allergens → PENDING again.
    expect(await publishedAllergens(tenantId, productId)).toBeNull();
  });

  it("getProductRecipe returns the ingredient list", async () => {
    const recipe = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const a = await createIngredient(tx, { name: "a", allergens: {} });
      const b = await createIngredient(tx, { name: "b", allergens: {} });
      await setProductRecipe(tx, productId, [a.id, b.id]);
      return getProductRecipe(tx, productId);
    });
    expect(recipe.map((i) => i.name).sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @waitron/recipes test recipes`
Expected: FAIL — `recipes.js` / functions missing.

- [ ] **Step 3: Implement `recipes.ts`**

```typescript
// packages/recipes/src/recipes.ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { ingredients, recipeLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  applyRecipeDerivation,
  mergeAllergenMaps,
  type ProductAllergens,
  type RecipeDerivation,
} from "@waitron/catalogue";
import type { Ingredient } from "./ingredients.js";

const CURRENT_TENANT = sql`current_tenant_id()`;

const INGREDIENT_COLUMNS = {
  id: ingredients.id,
  name: ingredients.name,
  allergens: ingredients.allergens,
  active: ingredients.active,
};

/** The ingredients that make up a product, in insertion order. */
export async function getProductRecipe(tx: Transaction, productId: string): Promise<Ingredient[]> {
  return tx
    .select(INGREDIENT_COLUMNS)
    .from(recipeLines)
    .innerJoin(ingredients, eq(ingredients.id, recipeLines.ingredientId))
    .where(eq(recipeLines.productId, productId))
    .orderBy(recipeLines.createdAt, recipeLines.id);
}

/** Recompute a product's derived allergen floor from its recipe and republish its declaration.
 * No recipe lines → clears the derivation (null → falls back to the manual overlay). Any unreviewed
 * (allergens = null) ingredient → pending = true (the product publishes PENDING). */
export async function recomputeProductAllergens(tx: Transaction, productId: string): Promise<void> {
  const rows = await tx
    .select({ allergens: ingredients.allergens })
    .from(recipeLines)
    .innerJoin(ingredients, eq(ingredients.id, recipeLines.ingredientId))
    .where(eq(recipeLines.productId, productId));

  if (rows.length === 0) {
    await applyRecipeDerivation(tx, productId, null);
    return;
  }
  let pending = false;
  let floor: ProductAllergens = {};
  for (const row of rows) {
    if (row.allergens === null) pending = true;
    else floor = mergeAllergenMaps(floor, row.allergens);
  }
  const derivation: RecipeDerivation = { allergens: floor, pending };
  await applyRecipeDerivation(tx, productId, derivation);
}

/** Replace a product's recipe with exactly `ingredientIds`, then recompute its allergens. */
export async function setProductRecipe(
  tx: Transaction,
  productId: string,
  ingredientIds: string[],
): Promise<void> {
  await tx.delete(recipeLines).where(eq(recipeLines.productId, productId));
  if (ingredientIds.length > 0) {
    await tx.insert(recipeLines).values(
      ingredientIds.map((ingredientId) => ({
        tenantId: CURRENT_TENANT,
        productId,
        ingredientId,
      })),
    );
  }
  await recomputeProductAllergens(tx, productId);
}

/** Every product whose recipe includes the given ingredient — used to propagate an ingredient's
 * allergen change. */
export async function productsUsingIngredient(
  tx: Transaction,
  ingredientId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ productId: recipeLines.productId })
    .from(recipeLines)
    .where(eq(recipeLines.ingredientId, ingredientId));
  return rows.map((r) => r.productId);
}
```

- [ ] **Step 4: Wire propagation into `updateIngredient`**

In `packages/recipes/src/ingredients.ts`, replace the `// Propagation ... Task 5` comment with:
```typescript
  const { recomputeProductAllergens, productsUsingIngredient } = await import("./recipes.js");
  for (const productId of await productsUsingIngredient(tx, id)) {
    await recomputeProductAllergens(tx, productId);
  }
```
(Use a dynamic `import` only if a static import would create a cycle between `ingredients.ts` and `recipes.ts`; if `recipes.ts` imports only the `Ingredient` *type* from `ingredients.ts`, a static `import` is fine — prefer the static import and move the shared `Ingredient` type or `INGREDIENT_COLUMNS` into a small `columns.ts` if needed to avoid the cycle.)

- [ ] **Step 5: Barrel + run + prove by deletion**

Add `export * from "./recipes.js";` to `packages/recipes/src/index.ts`.
Run: `pnpm --filter @waitron/recipes test recipes` — Expected: PASS.
Prove the PENDING-contagion guard: in `recomputeProductAllergens`, delete `if (row.allergens === null) pending = true;`, confirm the "keeps a product PENDING" test FAILS, restore, confirm PASS.
Prove propagation: delete the loop body in `updateIngredient`, confirm the "propagates an ingredient's allergen change" test FAILS, restore.

- [ ] **Step 6: Coverage + commit**

Run: `pnpm --filter @waitron/recipes test:coverage` — Expected: PASS at 98/98/98/95.
```bash
git add packages/recipes/src pnpm-lock.yaml
git commit -s -m "feat(recipes): product recipes + allergen derivation + propagation (slice 1)"
```

---

## Task 6: Real-Postgres RLS + grants

**Files:**
- Test: `packages/recipes/src/ingredients.rls.test.ts`
- Test: `packages/recipes/src/recipe-lines.rls.test.ts`

**Interfaces:**
- Consumes: `useRealPostgres`, `asAppUser`, `withTenant`, `captureError`, `pgErrorCode`, `pgErrorMessage` (`@waitron/db`), `startRealPostgres` (Task 4 harness), `seedVenue` (fixtures).

- [ ] **Step 1: Write `ingredients.rls.test.ts`** (model on `packages/catalogue/src/operations.rls.test.ts`)

```typescript
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, captureError, pgErrorCode, pgErrorMessage, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { createIngredient, listIngredients } from "./ingredients.js";
import { startRealPostgres } from "./testing/postgres.js";
import { seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";

const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: 180_000,
});

describe("ingredients under real row-level security", () => {
  let tenantA: SeededVenue;
  let tenantB: SeededVenue;

  beforeAll(async () => {
    tenantA = await seedVenue(suite.admin);
    tenantB = await seedVenue(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        await createIngredient(tx, { name: "alioli", allergens: { eggs: { presence: "contains" } } });
      });
    } finally {
      await probe.close();
    }
  });

  it("isolates one tenant's ingredients from another", async () => {
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const own = await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        return listIngredients(tx);
      });
      expect(own.map((i) => i.name)).toEqual(["alioli"]);

      const seenByB = await withTenant(probe, tenantB.tenantId, async (tx) => {
        await asAppUser(tx);
        return listIngredients(tx);
      });
      expect(seenByB).toEqual([]);
    } finally {
      await probe.close();
    }
  });

  it("denies DELETE to app_user (grant is SELECT/INSERT/UPDATE only)", async () => {
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const error = await captureError(() =>
        withTenant(probe, tenantA.tenantId, async (tx) => {
          await asAppUser(tx);
          await tx.execute(sql`delete from ingredients where tenant_id = ${tenantA.tenantId}`);
        }),
      );
      expect(pgErrorMessage(error)).toMatch(/permission denied for table ingredients/);
      expect(pgErrorCode(error)).toBe("42501");
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 2: Write `recipe-lines.rls.test.ts`** — same shape, but seed a product + recipe under tenant A (import `seedProduct` and `setProductRecipe`), assert tenant B sees no recipe lines (query `getProductRecipe` under B's GUC → `[]`), and assert DELETE is ALLOWED (recipe_lines grants DELETE) by deleting a line successfully under `app_user`. Prove isolation by deletion: temporarily weaken the `recipe_lines_tenant_isolation` USING clause to `true` in `0039_recipes_rls.sql`, confirm the cross-tenant assertion fails, restore.

- [ ] **Step 3: Run (Docker required)**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/recipes test rls`
Expected: PASS. (Ryuk disabled per CLAUDE.md §4 or the container suite hangs locally.)

- [ ] **Step 4: Commit**

```bash
git add packages/recipes/src/ingredients.rls.test.ts packages/recipes/src/recipe-lines.rls.test.ts
git commit -s -m "test(recipes): real-PG RLS + grant proofs for ingredients and recipe_lines"
```

---

## Task 7: Cross-cutting registration + guards

**Files:**
- Modify: `packages/db/src/english-only.ts` (add `"recipes"` to `GENERIC_PACKAGES`)
- Modify: `scripts/english-only.test.ts` (**pin #1** — the root project's `expect([...GENERIC_PACKAGES]).toEqual([...])` list, plus the "thirteen generic packages" → "fourteen" wording)
- Modify: `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` (**pin #2** — the regex that pins the ordered array, plus its "thirteen" comment → "fourteen")

**Why this task exists:** `GENERIC_PACKAGES` is a hardcoded cross-package list with **TWO** pinned copies; adding a package leaves both stale, and neither `fiscal-verifactu` nor the root guard is in a `packages/recipes` scoped run — so the failure only surfaces on the unfiltered `main` run unless caught here (CLAUDE.md §2). **Verified empirically 2026-08-15** (probe: add `"recipes"`, run `scripts/english-only.test.ts`): the guard scans `recipes/src` CLEANLY (the src-test food words `alioli`/`salsa` are NOT in `SPANISH_WORDS`; `test/fixtures.ts` is under `test/`, not scanned) — the ONLY failure is pin #1's `toEqual`. The new tenant tables also need the fiscal-verifactu `inmutabilidad` FORCE-RLS guard to pass (already run green during Task 2).

- [ ] **Step 1: Add `recipes` to the English-only guard**

In `packages/db/src/english-only.ts`, add `"recipes"` to the `GENERIC_PACKAGES` array (append after `"catalogue"` or at the end — match the array's ordering choice).

- [ ] **Step 2: Update the pinned regex**

In `packages/fiscal-verifactu/src/vocabulary-scope.test.ts`, update BOTH the doc comment count and the regex to include `"recipes"` in the exact position it was added, e.g. append `,\s*"recipes"` before the closing `\]` (matching where you placed it in Step 1).

- [ ] **Step 3: Run the English-only guard and the vocabulary-scope pin**

Run: `pnpm vitest run scripts/english-only.test.ts` (root project) — Expected: PASS (recipes' `src/` is English-only; the demo with Spanish words lives in `apps/`, out of scope).
Run: `pnpm --filter @waitron/fiscal-verifactu test vocabulary-scope` — Expected: PASS (the pin now matches).

- [ ] **Step 4: Run the immutability (FORCE-RLS) guard**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS — `ingredients` and `recipe_lines` report `relforcerowsecurity = true`. If it fails, the custom RLS migration (Task 2, Step 5) is missing a FORCE line.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/english-only.ts packages/fiscal-verifactu/src/vocabulary-scope.test.ts
git commit -s -m "chore(recipes): register recipes in the English-only guard"
```

---

## Task 8: Demo

**Files:**
- Create: `apps/server/scripts/recipes-demo.ts`

- [ ] **Step 1: Write the demo** (model on `apps/server/scripts/allergens-demo.ts`)

A runnable script that: provisions/seeds a venue; creates `alioli` (eggs), `bread` (gluten), `mystery` (unreviewed); creates a bocadillo product; `setProductRecipe(bocadillo, [alioli, bread])` and prints the derived `{eggs, gluten}`; adds a manual `may_contain nuts` via `updateProduct` and prints the add-only union; adds `mystery` to the recipe and prints the product going PENDING (null). Read `allergens-demo.ts` first for the exact bootstrap (connection, `withTenant`, `asAppUser`) and mirror it.

- [ ] **Step 2: Run it**

Run: `pnpm --filter @waitron/server exec tsx scripts/recipes-demo.ts` (match how `allergens-demo.ts` is invoked — check `apps/server/package.json` for a `demo:*` script convention and add `demo:recipes` mirroring it).
Expected: prints the three scenarios with the expected allergen sets.

- [ ] **Step 3: Commit**

```bash
git add apps/server/scripts/recipes-demo.ts apps/server/package.json
git commit -s -m "docs(recipes): end-to-end allergen-inheritance demo"
```

---

## Final gate (before finish-branch)

- [ ] `pnpm install` (lockfile committed) then `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
- [ ] `pnpm --filter @waitron/recipes test:coverage`, `pnpm --filter @waitron/catalogue test:coverage`, `pnpm --filter @waitron/db test:coverage` — all green at threshold
- [ ] Whole-workspace run once (the cross-cutting guards in Task 7 are invisible to a `packages/recipes` scoped run): `TESTCONTAINERS_RYUK_DISABLED=true pnpm test`
- [ ] Confirm no `packages/verifactu` / `packages/fiscal-verifactu` *source* changed (only its `vocabulary-scope.test.ts` pin) — the H2 boundary
- [ ] Hand off to `superpowers:finishing-a-development-branch` / the `finish-branch` skill (simplify → whole-branch review → fix wave → Copilot).

## Self-review notes (spec coverage)

- Spec §1 D1–D10 → Tasks 1–8 (D1 allergen-inheritance target = the whole plan; D2 separate master = Task 2; D3 optional package = Task 4; D4 floor+add-only+PENDING = Tasks 1,3,5; D5 flat = Task 2/5 (no nesting); D6 no qty = Task 2 schema; D7 published surface = Task 3; D8 tables-in-core = Task 2; D9 headless+demo = Task 8; D10 grants = Task 2/6).
- Spec §3 publication table → Task 1 (`republish` cases) + Task 3 (persisted).
- Spec §5 H2 → Final gate boundary check + Task 7 `inmutabilidad`.
- Spec §6 testing → Tasks 1–6 (pure, PGlite ops, real-PG RLS, propagation, guard).
- Spec §7 deferred → not built (nesting, qty, costing, stock, UI, dietary flags, browse).
