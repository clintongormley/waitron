# Dietary Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dietary-classification dimension (contains-meat/fish tags + vegan/vegetarian/halal/kosher labels) alongside the existing EU-14 allergen subsystem, derived from a single per-ingredient origin, overridable per dish, recomputed per selected option, and shown on the till/basket/expo/KDS + recipe-authoring UI.

**Architecture:** One nullable `dietary_origin` enum on `ingredients` is the single source. A pure, runtime-dependency-free leaf (`packages/catalogue/src/dietary.ts`) derives a product's diet profile from its ingredients' origins (rolled up the recipe exactly like allergens), folds a manual product override on top, and recomputes an as-served profile from selected options' origin overlays. Everything mirrors the allergen subsystem's shapes and call sites so the two dimensions stay symmetric.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL 18), Vitest, PGlite + Testcontainers, Lit (dashboard/till widgets), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-31-dietary-classification-design.md`

## Global Constraints

- **Cautious posture:** any ingredient with a NULL `dietary_origin` makes the product's diet `pending`; a pending product's `vegan`/`vegetarian` read `"unknown"`, NEVER `"yes"`. Contains-tags may still assert (monotonic presence).
- **No backfill / no backwards-compat** — pre-production; existing rows get NULL origin (correct empty state). (CLAUDE.md §3)
- **Error codes name the domain concept, `diet.*`; never renamed once shipped.** Grep sibling families before adding. (CLAUDE.md §3)
- **Additive nullable columns on existing RLS tables ride the existing FORCE RLS + policy + `app_user` grants** — plain `db:generate`, no custom migration. A pgEnum column's `CREATE TYPE` is emitted by drizzle-kit. (map §10)
- **After any schema change run** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (scans every `tenant_id` table for FORCE RLS). (CLAUDE.md §3)
- **The till/KDS diet leaf must be runtime-dependency-free and deep-imported** (`@waitron/catalogue/src/dietary.js`), exactly as `as-served.ts` deep-imports `derivation.js`, to keep the browser bundle free of drizzle/db. (map §7/§8)
- **Spanish-vocabulary guard is not engaged:** all identifiers here are English; user-visible labels come from i18n values. (CLAUDE.md §3)
- **Coverage thresholds:** 98/98/98/95 for logic packages; browser packages (ui/till/dashboard) 95/95/90/88. Run `pnpm --filter <pkg> test:coverage`, and the whole package unfiltered (guard suites). (CLAUDE.md §2/§4)
- **TESTCONTAINERS_RYUK_DISABLED=true** locally; `pnpm reap` if a run is interrupted. (CLAUDE.md §4)

### Shared types (defined once in Task 2; every later task consumes these verbatim)

```ts
// packages/catalogue/src/dietary.ts
export const DIETARY_ORIGINS = [
  "plant", "meat", "fish", "shellfish", "dairy", "egg", "honey", "other_animal",
] as const;
export type DietaryOrigin = (typeof DIETARY_ORIGINS)[number];

// The contains-tags surfaced to the user (meat/fish only; shellfish/dairy/egg are already
// covered by allergens). Extensible later without touching the origin enum.
export const CONTAINS_TAGS = ["meat", "fish"] as const;
export type ContainsTag = (typeof CONTAINS_TAGS)[number];

export type DietLabel = "yes" | "no" | "unknown";

/** Rolled up from the recipe: the set of reviewed ingredient origins + a pending flag. */
export interface DietDerivation {
  origins: DietaryOrigin[]; // sorted, deduped
  pending: boolean;         // any recipe-line ingredient with NULL origin
}

/** Staff override on the product. Unset keys fall through to derivation; halal/kosher exist ONLY here. */
export interface DietOverride {
  vegan?: "yes" | "no";
  vegetarian?: "yes" | "no";
  halal?: "yes" | "no";
  kosher?: "yes" | "no";
  addContains?: ContainsTag[];
  removeContains?: ContainsTag[];
}

/** The published, display profile (menu grid, filter, badges). */
export interface DietProfile {
  vegan: DietLabel;
  vegetarian: DietLabel;
  contains: ContainsTag[]; // sorted
  halal?: "yes" | "no";    // present only when set in the override
  kosher?: "yes" | "no";
}

/** A selected option's origin overlay: the origins it ADDS and the origins it REMOVES. */
export interface OptionOriginOverlay {
  add: DietaryOrigin[] | null;
  remove: DietaryOrigin[] | null;
}
```

---

## Task 1: Schema — `dietary_origin` enum + additive columns + migration

**Files:**
- Modify: `packages/db/src/schema/recipes.ts:1` (import), `:8-22` (ingredients table) — add `dietaryOrigin` pgEnum + column.
- Modify: `packages/db/src/schema/catalogue.ts:78-145` (products) — add `dietDerivation`, `dietOverride`, `diet`; `:183-225` (option_group_items) — add `addOrigins`, `removeOrigins`.
- Create: `packages/db/drizzle/0086_*.sql` (drizzle-kit generated).
- Test: `packages/db/src/schema/recipes.test.ts`, `packages/db/src/schema/catalogue.test.ts`.

**Interfaces:**
- Produces: pgEnum `dietaryOrigin` ("dietary_origin"); `ingredients.dietaryOrigin` (nullable); `products.dietDerivation` (`{origins:string[];pending:boolean}|null`), `products.dietOverride` (`DietOverride|null` typed as jsonb), `products.diet` (`DietProfile|null`); `optionGroupItems.addOrigins` (`string[]|null`), `optionGroupItems.removeOrigins` (`string[]|null`).

- [ ] **Step 1: Write the failing schema test** — append to `packages/db/src/schema/recipes.test.ts` a shape assertion that the new enum + column exist. Mirror the file's existing column-introspection test style. Example:

```ts
it("ingredients carries a nullable dietary_origin enum column", async () => {
  const { rows } = await db.execute(sql`
    select column_name, is_nullable, udt_name
    from information_schema.columns
    where table_name = 'ingredients' and column_name = 'dietary_origin'`);
  expect(rows).toEqual([{ column_name: "dietary_origin", is_nullable: "YES", udt_name: "dietary_origin" }]);
});
```

- [ ] **Step 2: Run it, watch it fail** — `pnpm --filter @waitron/db test recipes` → FAIL (column absent).

- [ ] **Step 3: Add the enum + column in `recipes.ts`**

```ts
// recipes.ts:1 — add `pgEnum` to the drizzle import
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

// after the imports, before `ingredients`:
/** A single dietary origin per ingredient. NULL = not yet categorised (a diet-PENDING ingredient,
 * contagious up a recipe — the diet analogue of `allergens IS NULL`). Drives BOTH the contains-tags
 * and the vegan/vegetarian derivation (see @waitron/catalogue `dietary.ts`). */
export const dietaryOrigin = pgEnum("dietary_origin", [
  "plant", "meat", "fish", "shellfish", "dairy", "egg", "honey", "other_animal",
]);

// inside the ingredients columns, after `allergens`:
    dietaryOrigin: dietaryOrigin("dietary_origin"),
```

- [ ] **Step 4: Add the product + option columns in `catalogue.ts`** — after the products `recipeDerivation` block (`:127`):

```ts
    // Diet analogue of `recipe_derivation`: the set of reviewed ingredient origins + pending, written
    // by @waitron/recipes. Separate from `recipe_derivation` because allergen-pending and diet-pending
    // are independent (an ingredient may have reviewed allergens but an uncategorised origin).
    dietDerivation: jsonb("diet_derivation").$type<{ origins: string[]; pending: boolean }>(),
    // Staff override — forced vegan/vegetarian/halal/kosher + hand contains-tags. halal/kosher live
    // ONLY here (no derivation). NULL = no override.
    dietOverride: jsonb("diet_override").$type<{
      vegan?: "yes" | "no"; vegetarian?: "yes" | "no"; halal?: "yes" | "no"; kosher?: "yes" | "no";
      addContains?: string[]; removeContains?: string[];
    }>(),
    // Published, display diet profile — the diet twin of the published `allergens` column, recomputed
    // by @waitron/catalogue whenever derivation or override changes. Read by the menu filter/grid.
    diet: jsonb("diet").$type<{
      vegan: "yes" | "no" | "unknown"; vegetarian: "yes" | "no" | "unknown";
      contains: string[]; halal?: "yes" | "no"; kosher?: "yes" | "no";
    }>(),
```

And after the option_group_items `removeAllergens` (`:207`):

```ts
    // Per-option ORIGIN overlay (the diet twin of add/remove_allergens). `add_origins`: origins this
    // option introduces ("add bacon" → ["meat"]). `remove_origins`: origins it removes ("no cheese" →
    // ["dairy"]). NULL = none. Additive nullable — rides option_group_items' existing RLS/policy/grants.
    addOrigins: jsonb("add_origins").$type<string[]>(),
    removeOrigins: jsonb("remove_origins").$type<string[]>(),
```

- [ ] **Step 5: Generate the migration** — `pnpm --filter @waitron/db db:generate`. Inspect the new `drizzle/0086_*.sql`: it must be a `CREATE TYPE "dietary_origin" AS ENUM (...)` plus five `ADD COLUMN` statements and no FORCE/POLICY/GRANT DDL (additive columns ride existing policies). If drizzle-kit tries to add anything else, stop and reconcile.

- [ ] **Step 6: Run the schema tests + inmutabilidad**

Run: `pnpm --filter @waitron/db test recipes catalogue` → PASS.
Run: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` → PASS (no new unforced `tenant_id` table; columns are additive).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/recipes.ts packages/db/src/schema/catalogue.ts packages/db/drizzle/ packages/db/src/schema/recipes.test.ts packages/db/src/schema/catalogue.test.ts
git commit -s -m "feat(db): dietary_origin enum + product diet columns + option origin overlays"
```

---

## Task 2: Dietary pure leaf `packages/catalogue/src/dietary.ts` (TDD)

**Files:**
- Create: `packages/catalogue/src/dietary.ts`
- Modify: `packages/catalogue/src/errors.ts` (add `diet.*` codes)
- Modify: `packages/catalogue/src/index.ts` (export the new symbols)
- Test: `packages/catalogue/src/dietary.test.ts`

**Interfaces:**
- Consumes: nothing (pure leaf; only `@waitron/shared` `AppError`).
- Produces (consumed by Tasks 3–8): the Shared-types block above, plus
  - `validateOrigin(value: unknown): DietaryOrigin`
  - `deriveDietProfile(d: DietDerivation): DietProfile` — derived only (no halal/kosher)
  - `overlayDietProfile(derived: DietProfile, override: DietOverride | null): DietProfile`
  - `deriveAsServedDiet(d: DietDerivation, override: DietOverride | null, overlays: readonly OptionOriginOverlay[]): DietProfile`
  - `assertDietOverrideDisjoint(override: DietOverride | null): void`

- [ ] **Step 1: Add the error codes** in `packages/catalogue/src/errors.ts` (inside the `ErrorParams` augmentation, beside the `allergen.*` block):

```ts
    "diet.invalid_origin": { origin: string };
    "diet.invalid_label": { field: string; value: string };
    "diet.add_remove_conflict": { tag: string };
```

- [ ] **Step 2: Write the failing derivation tests** — `packages/catalogue/src/dietary.test.ts`. Table-driven over the taxonomy. Include the crux cases:

```ts
import { describe, it, expect } from "vitest";
import {
  deriveDietProfile, overlayDietProfile, deriveAsServedDiet, validateOrigin,
  assertDietOverrideDisjoint, type DietDerivation,
} from "./dietary.js";

describe("deriveDietProfile", () => {
  it("all-plant, reviewed → vegan+vegetarian yes, no contains", () => {
    expect(deriveDietProfile({ origins: ["plant"], pending: false }))
      .toEqual({ vegan: "yes", vegetarian: "yes", contains: [] });
  });
  it("dairy present → vegetarian yes, vegan no", () => {
    expect(deriveDietProfile({ origins: ["dairy", "plant"], pending: false }))
      .toEqual({ vegan: "no", vegetarian: "yes", contains: [] });
  });
  it("meat present → both no, contains meat", () => {
    expect(deriveDietProfile({ origins: ["meat", "plant"], pending: false }))
      .toEqual({ vegan: "no", vegetarian: "no", contains: ["meat"] });
  });
  it("fish present → both no, contains fish", () => {
    expect(deriveDietProfile({ origins: ["fish"], pending: false }))
      .toEqual({ vegan: "no", vegetarian: "no", contains: ["fish"] });
  });
  it("other_animal (gelatine) → vegetarian no", () => {
    expect(deriveDietProfile({ origins: ["other_animal", "plant"], pending: false }).vegetarian).toBe("no");
  });
  it("PENDING withholds vegan/veg but NOT a known contains-meat", () => {
    expect(deriveDietProfile({ origins: ["meat"], pending: true }))
      .toEqual({ vegan: "unknown", vegetarian: "unknown", contains: ["meat"] });
  });
  it("PENDING all-plant → unknown, NOT vegan (cautious)", () => {
    expect(deriveDietProfile({ origins: ["plant"], pending: true }))
      .toEqual({ vegan: "unknown", vegetarian: "unknown", contains: [] });
  });
});

describe("overlayDietProfile", () => {
  const base = { vegan: "unknown", vegetarian: "unknown", contains: [] } as const;
  it("override forces a label", () => {
    expect(overlayDietProfile(base, { vegan: "yes" }).vegan).toBe("yes");
  });
  it("halal/kosher appear only from the override", () => {
    const out = overlayDietProfile(base, { halal: "yes" });
    expect(out.halal).toBe("yes");
    expect(out.kosher).toBeUndefined();
  });
  it("addContains adds, removeContains removes, result sorted", () => {
    expect(overlayDietProfile({ ...base, contains: ["meat"] }, { addContains: ["fish"], removeContains: ["meat"] }).contains)
      .toEqual(["fish"]);
  });
});

describe("deriveAsServedDiet", () => {
  it("remove dairy from a reviewed {plant,dairy} → vegan", () => {
    const d: DietDerivation = { origins: ["dairy", "plant"], pending: false };
    expect(deriveAsServedDiet(d, null, [{ add: null, remove: ["dairy"] }]).vegan).toBe("yes");
  });
  it("add meat → not vegetarian, contains meat", () => {
    const d: DietDerivation = { origins: ["plant"], pending: false };
    const out = deriveAsServedDiet(d, null, [{ add: ["meat"], remove: null }]);
    expect(out).toMatchObject({ vegan: "no", vegetarian: "no", contains: ["meat"] });
  });
  it("CRUX: remove over a PENDING base cannot manufacture vegan", () => {
    const d: DietDerivation = { origins: ["dairy"], pending: true };
    expect(deriveAsServedDiet(d, null, [{ add: null, remove: ["dairy"] }]).vegan).toBe("unknown");
  });
  it("CRUX: add meat downgrades even when base is pending", () => {
    const d: DietDerivation = { origins: ["plant"], pending: true };
    expect(deriveAsServedDiet(d, null, [{ add: ["meat"], remove: null }]).contains).toEqual(["meat"]);
  });
});

describe("validateOrigin / assertDietOverrideDisjoint", () => {
  it("accepts a valid origin, rejects junk", () => {
    expect(validateOrigin("meat")).toBe("meat");
    expect(() => validateOrigin("wombat")).toThrow();
  });
  it("rejects an override that adds and removes the same tag", () => {
    expect(() => assertDietOverrideDisjoint({ addContains: ["meat"], removeContains: ["meat"] })).toThrow();
    expect(() => assertDietOverrideDisjoint({ addContains: ["meat"], removeContains: ["fish"] })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests, watch them fail** — `pnpm --filter @waitron/catalogue test dietary` → FAIL (module not found).

- [ ] **Step 4: Implement `packages/catalogue/src/dietary.ts`**

```ts
import { AppError } from "@waitron/shared";
import "./errors.js"; // load the code registry for the throws below

export const DIETARY_ORIGINS = [
  "plant", "meat", "fish", "shellfish", "dairy", "egg", "honey", "other_animal",
] as const;
export type DietaryOrigin = (typeof DIETARY_ORIGINS)[number];

export const CONTAINS_TAGS = ["meat", "fish"] as const;
export type ContainsTag = (typeof CONTAINS_TAGS)[number];

export type DietLabel = "yes" | "no" | "unknown";

export interface DietDerivation { origins: DietaryOrigin[]; pending: boolean; }
export interface DietOverride {
  vegan?: "yes" | "no"; vegetarian?: "yes" | "no"; halal?: "yes" | "no"; kosher?: "yes" | "no";
  addContains?: ContainsTag[]; removeContains?: ContainsTag[];
}
export interface DietProfile {
  vegan: DietLabel; vegetarian: DietLabel; contains: ContainsTag[];
  halal?: "yes" | "no"; kosher?: "yes" | "no";
}
export interface OptionOriginOverlay { add: DietaryOrigin[] | null; remove: DietaryOrigin[] | null; }

const ORIGINS = new Set<string>(DIETARY_ORIGINS);
const CONTAINS = new Set<string>(CONTAINS_TAGS);
// The origins compatible with each diet. vegan = plant only; vegetarian also allows the non-slaughter
// animal products. Anything not listed excludes the diet.
const VEGAN_OK = new Set<DietaryOrigin>(["plant"]);
const VEGETARIAN_OK = new Set<DietaryOrigin>(["plant", "dairy", "egg", "honey"]);

export function validateOrigin(value: unknown): DietaryOrigin {
  if (typeof value !== "string" || !ORIGINS.has(value)) {
    throw new AppError("diet.invalid_origin", { origin: String(value) });
  }
  return value as DietaryOrigin;
}

/** Derived-only profile (no halal/kosher — those come from the override). Cautious: any pending
 * withholds vegan/vegetarian as "unknown"; contains-tags assert from KNOWN presence regardless. */
export function deriveDietProfile(d: DietDerivation): DietProfile {
  const present = new Set(d.origins);
  const label = (ok: Set<DietaryOrigin>): DietLabel =>
    d.pending ? "unknown" : [...present].every((o) => ok.has(o)) ? "yes" : "no";
  const contains = [...CONTAINS_TAGS].filter((t) => present.has(t));
  return { vegan: label(VEGAN_OK), vegetarian: label(VEGETARIAN_OK), contains };
}

/** Fold a staff override over a derived profile. Override wins; halal/kosher appear only when set. */
export function overlayDietProfile(derived: DietProfile, override: DietOverride | null): DietProfile {
  if (!override) return { ...derived, contains: [...derived.contains].sort() };
  const contains = new Set<ContainsTag>(derived.contains);
  for (const t of override.addContains ?? []) contains.add(t);
  for (const t of override.removeContains ?? []) contains.delete(t);
  const out: DietProfile = {
    vegan: override.vegan ?? derived.vegan,
    vegetarian: override.vegetarian ?? derived.vegetarian,
    contains: [...contains].sort(),
  };
  if (override.halal !== undefined) out.halal = override.halal;
  if (override.kosher !== undefined) out.kosher = override.kosher;
  return out;
}

/** As-served: recompute the DERIVED profile from (base origins − removed) ∪ added, carry base
 * `pending`, then re-apply the product override (override wins, same as product level).
 *
 * SAFETY (inverted from allergens): for allergens the safe direction is over-declaring (add wins); for
 * diet SUITABILITY the danger is a remove that manufactures a false "vegan". That is impossible here
 * because base.pending carries through untouched — a remove over a pending base leaves labels
 * "unknown". Adds that downgrade (add meat ⇒ not-veg) always apply. Removal is coarse (set-level),
 * identical to the allergen remove. */
export function deriveAsServedDiet(
  d: DietDerivation, override: DietOverride | null, overlays: readonly OptionOriginOverlay[],
): DietProfile {
  const origins = new Set<DietaryOrigin>(d.origins);
  for (const o of overlays) for (const code of o.remove ?? []) origins.delete(code);
  for (const o of overlays) for (const code of o.add ?? []) origins.add(code);
  const derived = deriveDietProfile({ origins: [...origins].sort(), pending: d.pending });
  return overlayDietProfile(derived, override);
}

/** Reject an override that both adds and removes the same contains-tag (mirrors
 * assertAllergenOverlayDisjoint). Defence-in-depth at the core (CLAUDE.md §3). */
export function assertDietOverrideDisjoint(override: DietOverride | null): void {
  if (!override?.addContains || !override.removeContains) return;
  const removing = new Set<string>(override.removeContains);
  for (const t of override.addContains) {
    if (removing.has(t)) throw new AppError("diet.add_remove_conflict", { tag: t });
  }
}
```

Note: removes are applied **before** adds so an add re-introduces an origin a remove stripped (add wins a cross-option conflict, the downgrade-safe direction). The `CONTAINS` set is used by the validation task (Task 4) and re-exported; keep it here for that import.

- [ ] **Step 5: Export from the barrel** — add to `packages/catalogue/src/index.ts` the `export * from "./dietary.js";` (match how `allergens`/`derivation` are exported).

- [ ] **Step 6: Run tests + prove a guard by deletion**

Run: `pnpm --filter @waitron/catalogue test dietary` → PASS.
Deletion proof: temporarily change `deriveDietProfile`'s pending branch to always compute the positive label; confirm the two CRUX "unknown"/pending tests fail; restore. Note the result in the commit body.

- [ ] **Step 7: Coverage + commit**

Run: `pnpm --filter @waitron/catalogue test:coverage` → PASS (thresholds).

```bash
git add packages/catalogue/src/dietary.ts packages/catalogue/src/dietary.test.ts packages/catalogue/src/errors.ts packages/catalogue/src/index.ts
git commit -s -m "feat(catalogue): dietary derivation leaf (origins → diet profile, override, as-served)"
```

---

## Task 3: Recipe roll-up + product republish

**Files:**
- Modify: `packages/recipes/src/recipes.ts:43-94` — add `recomputeProductDiet`; call it beside `recomputeProductAllergens`.
- Modify: `packages/catalogue/src/operations.ts` — add `applyDietDerivation` (twin of `applyRecipeDerivation` `:322-332`) + `republishProductDiet` (twin of `republishProduct` `:308-315`); wire `dietOverride` into `createProduct` (`:334-358`) and `updateProduct` (`:369-391`).
- Test: `packages/recipes/src/recipes.test.ts`, `packages/catalogue/src/operations.test.ts`.

**Interfaces:**
- Consumes: `deriveDietProfile`, `overlayDietProfile`, `DietDerivation`, `DietOverride`, `DietProfile`, `validateOrigin` from `@waitron/catalogue` (Task 2); `dietaryOrigin` column, `products.dietDerivation`/`dietOverride`/`diet` (Task 1).
- Produces (consumed by Task 4): `applyDietDerivation(tx, productId, derivation: DietDerivation | null): Promise<void>`; `republishProductDiet(tx, id): Promise<void>`; `recomputeProductDiet(tx, productId): Promise<void>`. `createProduct`/`updateProduct` now accept `dietOverride?: DietOverride | null`.

- [ ] **Step 1: Write the failing roll-up test** — `packages/recipes/src/recipes.test.ts` (PGlite target — this suite needs no privilege/concurrency behaviour, only that the fold reads/writes rows; state the reason in a comment):

```ts
it("recomputeProductDiet: an uncategorised ingredient makes the product diet-pending", async () => {
  // product with one plant ingredient (categorised) + one NULL-origin ingredient
  await setProductRecipe(tx, productId, [plantIngredientId, uncategorisedIngredientId]);
  const [row] = await tx.select({ diet: products.diet, deriv: products.dietDerivation })
    .from(products).where(eq(products.id, productId));
  expect(row.deriv).toEqual({ origins: ["plant"], pending: true });
  expect(row.diet).toMatchObject({ vegan: "unknown", vegetarian: "unknown" });
});

it("recomputeProductDiet: all-plant reviewed → vegan", async () => {
  await setProductRecipe(tx, productId, [plantIngredientId]);
  const [row] = await tx.select({ diet: products.diet }).from(products).where(eq(products.id, productId));
  expect(row.diet).toMatchObject({ vegan: "yes", vegetarian: "yes", contains: [] });
});
```

- [ ] **Step 2: Run it, watch it fail** — `pnpm --filter @waitron/recipes test recipes` → FAIL (`recomputeProductDiet`/`dietDerivation` undefined).

- [ ] **Step 3: Add `applyDietDerivation` + `republishProductDiet` to `operations.ts`** (beside their allergen twins):

```ts
import {
  deriveDietProfile, overlayDietProfile, type DietDerivation, type DietOverride,
} from "./dietary.js";

async function republishProductDiet(tx: Transaction, id: string): Promise<void> {
  const [row] = await tx
    .select({ deriv: products.dietDerivation, override: products.dietOverride })
    .from(products)
    .where(eq(products.id, id));
  const derivation = (row?.deriv ?? { origins: [], pending: false }) as DietDerivation;
  const derived = deriveDietProfile(derivation);
  const published = overlayDietProfile(derived, (row?.override ?? null) as DietOverride | null);
  await tx.update(products).set({ diet: published }).where(eq(products.id, id));
}

export async function applyDietDerivation(
  tx: Transaction, productId: string, derivation: DietDerivation | null,
): Promise<void> {
  await tx.update(products)
    .set({ dietDerivation: derivation, updatedAt: sql`now()` })
    .where(eq(products.id, productId));
  await republishProductDiet(tx, productId);
}
```

- [ ] **Step 4: Add `recomputeProductDiet` to `recipes.ts`** (mirror `recomputeProductAllergens` `:43-62`, but fold origins):

```ts
import { applyDietDerivation } from "@waitron/catalogue"; // or the existing deep path used for applyRecipeDerivation
import type { DietaryOrigin } from "@waitron/catalogue";
import { ingredients } from "@waitron/db"; // dietaryOrigin column already on the row

export async function recomputeProductDiet(tx: Transaction, productId: string): Promise<void> {
  const rows = await tx
    .select({ origin: ingredients.dietaryOrigin })
    .from(recipeLines)
    .innerJoin(ingredients, eq(ingredients.id, recipeLines.ingredientId))
    .where(eq(recipeLines.productId, productId));
  if (rows.length === 0) { await applyDietDerivation(tx, productId, null); return; }
  let pending = false;
  const set = new Set<DietaryOrigin>();
  for (const r of rows) {
    if (r.origin === null) pending = true;
    else set.add(r.origin as DietaryOrigin);
  }
  await applyDietDerivation(tx, productId, { origins: [...set].sort(), pending });
}
```

- [ ] **Step 5: Call it beside the allergen roll-up** — in `setProductRecipe` (`recipes.ts:65-81`) add `await recomputeProductDiet(tx, productId);` right after the `recomputeProductAllergens` call. In the ingredient-change propagation (`packages/recipes/src/ingredients.ts`, where `recomputeProductAllergens` is fanned out over `productsUsingIngredient`), add the diet recompute in the same loop. Grep `recomputeProductAllergens` to find every call site and add the diet twin at each.

- [ ] **Step 6: Wire `dietOverride` into create/update** — in `operations.ts` `createProduct` add a `dietOverride` param, `assertDietOverrideDisjoint(dietOverride)`, persist it on insert, and set `diet: overlayDietProfile(deriveDietProfile({origins:[],pending:false}), dietOverride)` inline (the recipe fold overwrites it once a recipe is set). In `updateProduct`, split `dietOverride` out like `manualAllergens`, and `if (dietOverride !== undefined) await republishProductDiet(tx, id);`.

- [ ] **Step 7: Write the override republish test** — `operations.test.ts`:

```ts
it("a forced vegan override wins over an uncategorised (pending) recipe", async () => {
  await updateProduct(tx, id, { dietOverride: { vegan: "yes" } });
  const [row] = await tx.select({ diet: products.diet }).from(products).where(eq(products.id, id));
  expect(row.diet).toMatchObject({ vegan: "yes" });
});
```

- [ ] **Step 8: Run tests + coverage**

Run: `pnpm --filter @waitron/recipes test:coverage` and `pnpm --filter @waitron/catalogue test:coverage` → PASS.
Run the packages UNFILTERED once (guard suites): `pnpm --filter @waitron/recipes test:coverage` already runs the whole package; also `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.

- [ ] **Step 9: Commit**

```bash
git add packages/recipes/src packages/catalogue/src/operations.ts packages/catalogue/src/operations.test.ts
git commit -s -m "feat(recipes): roll ingredient origins into product diet derivation + republish"
```

---

## Task 4: Server read projection + write validation

**Files:**
- Modify: `packages/catalogue/src/operations.ts` — `AvailableProduct` (`:148-173`), `ResolvedOptionItem` (`:111-126`), `listAvailableProducts` (`:576-703`).
- Modify: `apps/server/src/catalogue-api.ts` — product/option write routes (`:391-441`, `:462-520`, `:668-753`) to validate `dietOverride` + `addOrigins`/`removeOrigins`.
- Test: `packages/catalogue/src/operations.test.ts`, `apps/server/src/catalogue-api.test.ts`, `apps/server/src/till-api.test.ts`.

**Interfaces:**
- Consumes: Task 2 validators/types, Task 1 columns, Task 3 create/update override wiring.
- Produces (consumed by Task 6): `AvailableProduct.diet: DietProfile | null`, `AvailableProduct.dietDerivation: DietDerivation | null`, `AvailableProduct.dietOverride: DietOverride | null`; `ResolvedOptionItem.addOrigins: string[] | null`, `ResolvedOptionItem.removeOrigins: string[] | null`.

- [ ] **Step 1: Failing projection test** — `operations.test.ts`: `listAvailableProducts` returns `diet` on a product and `addOrigins`/`removeOrigins` on an option item.

```ts
it("listAvailableProducts carries the diet profile and option origin overlays", async () => {
  const [p] = await listAvailableProducts(tx, { catalogueId });
  expect(p.diet).toMatchObject({ vegan: expect.any(String) });
  expect(p.dietDerivation).toBeDefined();
  expect(p.optionGroups[0].items[0]).toHaveProperty("addOrigins");
});
```

- [ ] **Step 2: Run, watch fail.** `pnpm --filter @waitron/catalogue test operations` → FAIL.

- [ ] **Step 3: Extend the interfaces + projection.** In `operations.ts`: add to `AvailableProduct` `diet`, `dietDerivation`, `dietOverride`; to `ResolvedOptionItem` `addOrigins`, `removeOrigins`. In `listAvailableProducts`: project `diet: products.diet` (`:590` area), `dietDerivation: products.dietDerivation`, `dietOverride: products.dietOverride`; in the option-items SELECT project `addOrigins: optionGroupItems.addOrigins`, `removeOrigins: optionGroupItems.removeOrigins` (`:633-634` area); cast them onto the assembled item (`:681-682` area) and final row map (`:696` area).

- [ ] **Step 4: Failing write-validation test** — `catalogue-api.test.ts`: POST/PATCH a product with a bad `dietOverride.addContains`/an option with a bad `addOrigins` is rejected with the right code.

```ts
it("rejects an option add_origins containing a non-origin", async () => {
  const res = await request(app).post("/api/option-groups/.../items").send({ addOrigins: ["wombat"] });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("diet.invalid_origin");
});
```

- [ ] **Step 5: Run, watch fail.**

- [ ] **Step 6: Add validation in `catalogue-api.ts`** — where the untrusted `allergens`/`addAllergens`/`removeAllergens` are validated, add: for a product write, `assertDietOverrideDisjoint(body.dietOverride)` and per-tag `validateOrigin` over its `addContains`/`removeContains` (these are `ContainsTag`s — validate against `CONTAINS_TAGS`, not the full origin set; add a `validateContainsTag` helper in `dietary.ts` if cleaner, or inline the `CONTAINS` set check) and each label ∈ {"yes","no"}; for an option write, `validateOrigin` over every `addOrigins`/`removeOrigins` entry. Throw `diet.invalid_origin` / `diet.invalid_label` / `diet.add_remove_conflict`.

- [ ] **Step 7: Run tests + coverage** — `pnpm --filter @waitron/catalogue test:coverage`, `pnpm --filter @waitron/server test:coverage` (apps/server). PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/catalogue/src/operations.ts apps/server/src/catalogue-api.ts packages/catalogue/src/operations.test.ts apps/server/src/catalogue-api.test.ts apps/server/src/till-api.test.ts
git commit -s -m "feat(server): expose product diet + option origin overlays; validate diet writes"
```

---

## Task 5: Server-side as-served diet on station/expo reads

**Files:**
- Modify: `apps/server/src/working-order.ts:3296-3318` (fold), `:3416-3461` (station queue), `:3503`/`:3713-3779` (expo); the `StationQueueItem`/`ExpoItem` wire interfaces (`:3146-3153`, `:3503`).
- Test: `apps/server/src/working-order.test.ts`.

**Interfaces:**
- Consumes: `deriveAsServedDiet`, `DietProfile`, `DietDerivation`, `DietOverride`, `OptionOriginOverlay` (Task 2); `products.dietDerivation`/`dietOverride`, `optionGroupItems.addOrigins`/`removeOrigins` (Task 1).
- Produces (consumed by Task 6 for parity): `StationQueueItem.asServedDiet?: DietProfile`, `ExpoItem.asServedDiet?: DietProfile`.

- [ ] **Step 1: Failing test** — `working-order.test.ts`: an expo item whose selected option removes the only dairy origin reads `asServedDiet.vegan === "yes"`.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Extend the fold** — in `readQueueSubItems` (`:3296-3318`) add `dietDerivation`/`dietOverride` to the parent base SELECT and build `OptionOriginOverlay[]` per parent from each option's `addOrigins`/`removeOrigins` (mirror the existing `OptionAllergenOverlay` assembly). Compute `asServedDiet: deriveAsServedDiet(base.dietDerivation ?? {origins:[],pending:false}, base.dietOverride ?? null, overlays)` and store it on `asServedByParent`.

- [ ] **Step 4: Carry it onto the reads** — add `asServedDiet` to `StationQueueItem` (`:3457-3460` default) and `ExpoItem` (`:3775-3779`), defaulting to a derived-empty profile `{ vegan: "unknown", vegetarian: "unknown", contains: [] }` when the parent has no derivation (parity with the `{allergens:{},pending:true}` allergen default).

- [ ] **Step 5: Run tests + coverage** — `pnpm --filter @waitron/server test:coverage`. PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/working-order.ts apps/server/src/working-order.test.ts
git commit -s -m "feat(server): compute as-served diet on station/expo reads"
```

---

## Task 6: Till types + client-side as-served + menu filter

**Files:**
- Modify: `apps/till/src/api/client.ts:147-238` (types), `:448-451` (AsServed) — add diet fields + a `DietProfile` type.
- Create: append `asServedDiet` to `apps/till/src/state/as-served.ts`.
- Modify: `apps/till/src/menu-filter.ts` — add diet predicates.
- Test: `apps/till/src/menu-filter.test.ts`, `apps/till/src/state/order-line.test.ts` (or a new `as-served-diet.test.ts`).

**Interfaces:**
- Consumes: Task 4 wire (`diet`, `dietDerivation`, `dietOverride`, option `addOrigins`/`removeOrigins`); `deriveAsServedDiet` deep-imported from `@waitron/catalogue/src/dietary.js`.
- Produces (consumed by Task 7): `TillProduct.diet`, `TillProduct.dietDerivation`, `TillProduct.dietOverride`; `TillOptionItem.addOrigins`/`removeOrigins`; `asServedDiet(line: OrderLine): DietProfile`; `filterProductsByDiet(products, predicate)`.

- [ ] **Step 1: Add local diet types + fields to `client.ts`** — a local `DietProfile`/`DietDerivation`/`DietOverride` (redefined locally, NOT imported — same rationale as the local allergen shapes). Add to `TillOptionItem`: `addOrigins: string[] | null; removeOrigins: string[] | null;`. To `TillProduct`: `diet?: DietProfile | null; dietDerivation?: DietDerivation | null; dietOverride?: DietOverride | null;`.

- [ ] **Step 2: Failing menu-filter test** — `menu-filter.test.ts`:

```ts
it("filterProductsByDiet('vegan') keeps only vegan-yes products", () => {
  const out = filterProductsByDiet([veganProduct, meatProduct], "vegan");
  expect(out).toEqual([veganProduct]);
});
it("filterProductsByDiet('no-meat') drops contains-meat products", () => {
  expect(filterProductsByDiet([veganProduct, meatProduct], "no-meat")).toEqual([veganProduct]);
});
```

- [ ] **Step 3: Run, watch fail.**

- [ ] **Step 4: Implement the filter** — in `menu-filter.ts`:

```ts
export type DietPredicate = "vegan" | "vegetarian" | "no-meat" | "no-fish";
export function filterProductsByDiet(products: TillProduct[], p: DietPredicate): TillProduct[] {
  return products.filter((prod) => {
    const d = prod.diet;
    if (!d) return false; // unknown diet never satisfies a positive filter
    if (p === "vegan") return d.vegan === "yes";
    if (p === "vegetarian") return d.vegetarian === "yes";
    if (p === "no-meat") return !d.contains.includes("meat");
    return !d.contains.includes("fish");
  });
}
```

- [ ] **Step 5: Failing as-served-diet test** — mirror `asServedAllergens` in `as-served.ts`; test that selecting a "no cheese" option flips a `{plant,dairy}` line to vegan.

- [ ] **Step 6: Implement `asServedDiet`** in `as-served.ts` (deep-import `deriveAsServedDiet` from `@waitron/catalogue/src/dietary.js`, build overlays from `line.product.optionGroups` items' `addOrigins`/`removeOrigins`, exactly like `asServedAllergens` builds `OptionAllergenOverlay[]`):

```ts
import { deriveAsServedDiet } from "@waitron/catalogue/src/dietary.js";
import type { DietProfile, OptionOriginOverlay } from "@waitron/catalogue/src/dietary.js";

export function asServedDiet(line: OrderLine): DietProfile {
  const itemById = new Map((line.product.optionGroups ?? []).flatMap((g) => g.items).map((i) => [i.id, i]));
  const overlays: OptionOriginOverlay[] = (line.options ?? []).map((sel) => {
    const item = itemById.get(sel.optionGroupItemId);
    return { add: item?.addOrigins ?? null, remove: item?.removeOrigins ?? null };
  });
  const d = line.product.dietDerivation ?? { origins: [], pending: false };
  return deriveAsServedDiet(d, line.product.dietOverride ?? null, overlays);
}
```

- [ ] **Step 7: Run tests + coverage** — `pnpm --filter @waitron/till test:coverage` (browser mode — do NOT run alongside another browser-package coverage run; memory). PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/till/src/api/client.ts apps/till/src/state/as-served.ts apps/till/src/menu-filter.ts apps/till/src/menu-filter.test.ts apps/till/src/state
git commit -s -m "feat(till): diet types, client-side as-served diet, menu diet filter"
```

---

## Task 7: Till + KDS rendering (diet & contains badges)

**Files:**
- Modify: the till screens that render allergen chips today — `apps/till/src/screens/till-allergen-screen.ts` (and the basket/expo renders that show `asServed`); `apps/dashboard`/KDS expo screen rendering (`apps/dashboard/src/screens/kitchen-screen.ts` / expo).
- Modify: the menu grid / filter UI to expose the diet predicates from Task 6.
- Test: the corresponding `*.test.ts` + `*.a11y.test.ts` for each touched screen.

**Interfaces:**
- Consumes: Task 6 `asServedDiet`, `filterProductsByDiet`, `TillProduct.diet`; Task 5 `asServedDiet` on expo/queue reads.

- [ ] **Step 1: Failing render test** — a basket line whose `asServedDiet` is vegan shows a "vegan" badge; a contains-meat line shows a "meat" chip. Add to the relevant screen `*.test.ts`. Mirror how the allergen chip test asserts (grep `data-test="allergen"` / the allergen chip test in `till-allergen-screen.test.ts`).

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Render the badges** — beside the existing allergen chips, render diet labels (vegan/vegetarian when `"yes"`; halal/kosher when present) and contains-tags. Use i18n keys for the labels (add `diet.vegan`, `diet.vegetarian`, `diet.halal`, `diet.kosher`, `diet.contains.meat`, `diet.contains.fish` to the till locale files — grep an existing allergen i18n key to find the locale file). A `"pending"`/`"unknown"` diet shows a neutral "not reviewed" note, never a positive claim.

- [ ] **Step 4: Wire the menu-filter UI** — add diet filter controls (vegan/vegetarian/no-meat/no-fish) to the menu grid, calling `filterProductsByDiet`. Follow the existing menu-selection UI pattern in the counter/table-order screens.

- [ ] **Step 5: Run tests + a11y + coverage** — `pnpm --filter @waitron/till test:coverage`. PASS. (Serialise browser-package coverage runs.)

- [ ] **Step 6: Commit**

```bash
git add apps/till/src apps/dashboard/src
git commit -s -m "feat(till/kds): render diet & contains badges; menu diet filter UI"
```

---

## Task 8: Dashboard — ingredient origin picker + product diet override editor

**Files:**
- Create: `apps/dashboard/src/widgets/dietary-origin-picker.ts` (a single-select `ha`-free themed select over `DIETARY_ORIGINS`, mirroring `allergen-picker.ts`'s shape/tests).
- Modify: `apps/dashboard/src/widgets/ingredient-form.ts:11,97-98,114-115,131-133,157-222` — mount the origin picker beside the allergen picker; seed from `ingredient.dietaryOrigin`; emit in `#onSubmit`.
- Modify: `apps/dashboard/src/widgets/product-form.ts:11,18-19,59` — add a diet-override editor (vegan/veg/halal/kosher tri-state + contains toggles) beside the allergen picker.
- Test: `dietary-origin-picker.test.ts` + `.a11y.test.ts`; update `ingredient-form.test.ts`, `product-form.test.ts` (+ a11y).

**Interfaces:**
- Consumes: `DIETARY_ORIGINS`, `DietOverride`, `CONTAINS_TAGS` (Task 2); the ingredient/product write routes' new fields (Task 4).

- [ ] **Step 1: Failing picker test** — `dietary-origin-picker.test.ts`: renders one option per `DIETARY_ORIGINS` entry, emits `origin-changed` with the selected value, seeds from a passed value. Mirror `allergen-picker.test.ts`.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement `dietary-origin-picker.ts`** — a Lit element with a labelled `<select>` (or the project's field primitive) over `DIETARY_ORIGINS`, i18n labels (`origin.plant` … `origin.other_animal`), a "not categorised" empty option (maps to NULL), emitting `origin-changed` (`e.detail.origin: DietaryOrigin | null`). `e.stopPropagation()` on re-emit.

- [ ] **Step 4: Mount in `ingredient-form.ts`** — beside `<dashboard-allergen-picker>` (`:217-222`), add `<dashboard-dietary-origin-picker .value=${this.seedOrigin} @origin-changed=${...}>`; add `@state() seedOrigin`, reseed from `ingredient.dietaryOrigin`, include `dietaryOrigin` in the `#onSubmit` body (`:157`).

- [ ] **Step 5: Add the product diet-override editor in `product-form.ts`** — a small sub-form: three-state controls for vegan/vegetarian/halal/kosher (`auto`/`yes`/`no`, where `auto` = key absent), and add/remove toggles for the `CONTAINS_TAGS`. Assemble into a `DietOverride` in the submit detail (`allergens?` field neighbour, `:59`). An empty override submits as `null`.

- [ ] **Step 6: Run tests + a11y + coverage** — `pnpm --filter @waitron/dashboard test:coverage` (browser mode — serialise). PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/widgets
git commit -s -m "feat(dashboard): ingredient origin picker + product diet override editor"
```

---

## Task 9: Whole-workspace gate + backlog

- [ ] **Step 1: Full gate** — `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, then per-package `test:coverage` for every touched package (db, catalogue, recipes, server, till, dashboard), then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. Serialise the browser-package coverage runs (till/dashboard). Fix anything red.

- [ ] **Step 2: Update `docs/backlog.md`** — mark dietary classification landed under the Menu/recipes/allergens row (#18); record the downstream order-line-customisation dependency (doneness ← meat origin) and that the customer-facing menu remains parked. Commit `-s`.

- [ ] **Step 3: Finish the branch** — run the `finish-branch` flow (simplify + two-reviewer + rebase + PR + CI/Copilot), per CLAUDE.md §6. The whole-branch (base-to-tip) review is required — it is the pass that catches stale-claim/cross-file defects the per-task reviews miss.

---

## Self-review notes (author)

- **Spec coverage:** taxonomy (Task 1/2), derivation + cautious pending (Task 2), override + halal/kosher (Task 2/3/8), per-option as-served incl. inverted-safety (Task 2 CRUX tests, Task 5/6), all four in-scope surfaces (recipe authoring Task 8, till filter Task 6/7, basket/expo/KDS Task 5/6/7); customer-facing menu explicitly deferred (not a task). ✓
- **Type consistency:** `DietProfile`/`DietDerivation`/`DietOverride`/`OptionOriginOverlay` defined once (Task 2 Shared-types), consumed verbatim in 3–8; `deriveDietProfile`/`overlayDietProfile`/`deriveAsServedDiet`/`validateOrigin`/`assertDietOverrideDisjoint` names stable across tasks. ✓
- **No placeholders:** each logic task carries real test + implementation code; UI tasks (7/8) name exact files/line-anchors and the widget to mirror. ✓
- **Open executor decision:** Task 4 Step 6 — validate `addContains`/`removeContains` against `CONTAINS_TAGS` (a `validateContainsTag` helper) rather than the full origin set. Noted inline.
```
