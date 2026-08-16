# Nested sub-recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recipe line reference another composed product (a sub-recipe), with allergen derivation propagating UP the tree (add-only, PENDING-contagious, same as #89) and cycle detection.

**Architecture:** `recipe_lines` gains a nullable `component_product_id` (XOR with `ingredient_id`); a component line contributes the sub-product's PUBLISHED `products.allergens` to the parent's floor (NULL = PENDING contagion). A recipe/ingredient change recomputes the changed node and every transitive ancestor in topological (Kahn) order. `setProductRecipe` rejects cycles with a new `recipe.cycle` error. A manual-overlay edit propagates to parents via a new `recipes.recomputeAncestors`, wired at the server layer (catalogue stays recipe-unaware).

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL (real via Testcontainers) + PGlite, Hono, Vitest 3, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-08-16-nested-sub-recipes-design.md](../specs/2026-08-16-nested-sub-recipes-design.md)

## Global Constraints

- **No backwards-compat / data-migration code** — pre-production; schema changes drop & recreate. `setProductRecipe` keeps its bare-`string[]` spelling only to preserve #89's behavioural assertions (CLAUDE.md), not for data compat.
- **Fiscal boundary (H2):** touch nothing in `packages/verifactu` / `packages/fiscal*` source, `registros_facturacion`, the hash chain, invoice numbers, `envios`, `acks`, or `computeHuella`. `component_product_id` / `products.allergens` feed no fiscal path (spec §6, grep-verified 2026-08-16). If execution drifts there, leave the PR `needs-owner-review` and do NOT land.
- **`recipe_lines` already has FORCE RLS + a tenant-isolation policy + grants** (0039). Adding a column needs NO new RLS migration: the row-level policy and table-level grant cover it (spec D1). Confirm with the `inmutabilidad` guard + RLS test after 0043 — do NOT add a `.enableRLS()`-only table.
- **Never build SQL by string concatenation.** The reachability + ancestor CTEs use parameterised Drizzle `sql` (recursive CTEs are ordinary statements → placeholders apply).
- **Never widen a grant to pass a test.** `recipe_lines` keeps `SELECT,INSERT,UPDATE,DELETE`; nothing new is granted.
- **Error codes name the DOMAIN CONCEPT.** New code `recipe.cycle` (a cyclic BOM), registered in a new `packages/recipes/src/errors.ts`; every file that throws it does `import "./errors.js"`. Never renamed once shipped.
- **Coverage thresholds:** 98/98/98/95 for `packages/db`, `packages/recipes`, `apps/server`; 95/95/90/88 for `apps/dashboard`.
- **Every commit `-s`** (CI's `dco` walks the range).
- **Gate before pushing:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus `pnpm --filter <pkg> test:coverage` for touched packages, plus a whole-workspace run before finish-branch (the `inmutabilidad` + `errors-reachable` guards live outside `packages/recipes`).

---

## File structure

**`packages/db`** — `src/schema/recipes.ts` (component column + XOR + unique + index), `drizzle/0043_recipe_lines_nesting.sql`, `src/schema/recipes.test.ts`.
**`packages/recipes`** — `src/recipes.ts` (fold + cycle + propagation), `src/errors.ts` (new), `src/index.ts` (export errors reachability), `src/ingredients.ts` (combined propagation walk), `src/recipes.test.ts` + `src/recipe-lines.rls.test.ts` (component cases), `apps/server/scripts/recipes-demo.ts`.
**`apps/server`** — `recipe-api.ts` (+ test), `catalogue-api.ts` (+ test), `boot.ts` unchanged.
**`apps/dashboard`** — `i18n/codes.ts` + `widgets/recipe-editor.ts` (component picker).

---

## Task 1: Schema — `component_product_id` + XOR check (`packages/db`)

**Files:**
- Modify: `packages/db/src/schema/recipes.ts`
- Create: `packages/db/drizzle/0043_recipe_lines_nesting.sql` (generate, then verify/augment)
- Test: `packages/db/src/schema/recipes.test.ts` (add cases)

**Interfaces:**
- Produces: `recipeLines.componentProductId` (uuid, nullable, FK products); `recipeLines.ingredientId` nullable; a CHECK + a UNIQUE + an INDEX.

- [ ] **Step 1: Change the schema** — in `packages/db/src/schema/recipes.ts`, import `check` from `drizzle-orm/pg-core` and `sql` from `drizzle-orm`; edit `recipeLines`:

```ts
    ingredientId: uuid("ingredient_id").references(() => ingredients.id), // was .notNull() — now nullable
    componentProductId: uuid("component_product_id").references(() => products.id), // NEW — a composed sub-product
```
and extend the table's extra-config array:
```ts
  (t) => [
    index("recipe_lines_product_id_idx").on(t.productId),
    index("recipe_lines_ingredient_id_idx").on(t.ingredientId),
    index("recipe_lines_component_product_id_idx").on(t.componentProductId), // NEW
    unique("recipe_lines_product_ingredient_key").on(t.productId, t.ingredientId),
    unique("recipe_lines_product_component_key").on(t.productId, t.componentProductId), // NEW
    check(
      "recipe_lines_ingredient_xor_component",
      sql`(${t.ingredientId} is not null) <> (${t.componentProductId} is not null)`,
    ), // NEW — a line is exactly one of ingredient / sub-product
  ],
```

- [ ] **Step 2: Generate the migration** — `pnpm --filter @waitron/db db:generate --name recipe_lines_nesting`. Expected: `0043_recipe_lines_nesting.sql` with `ALTER TABLE "recipe_lines" ALTER COLUMN "ingredient_id" DROP NOT NULL`, `ADD COLUMN "component_product_id" uuid` + its FK, the new UNIQUE, the new INDEX, and the CHECK. **Inspect it**: if the CHECK is absent (some drizzle-kit versions omit `check()`), hand-add it to the file with a `--> statement-breakpoint` and a one-line comment. Confirm no drift on other tables.

- [ ] **Step 3: Write the failing test** — add to `recipes.test.ts`:

```ts
it("adds component_product_id, makes ingredient_id nullable, and enforces the XOR check", async () => {
  const cols = await fx.db.execute<{ column_name: string; is_nullable: string }>(sql`
    select column_name, is_nullable from information_schema.columns
    where table_name = 'recipe_lines' and column_name in ('ingredient_id','component_product_id')
    order by column_name`);
  expect(cols.rows).toEqual([
    { column_name: "component_product_id", is_nullable: "YES" },
    { column_name: "ingredient_id", is_nullable: "YES" },
  ]);
});

it("the XOR check rejects a line with both FKs and a line with neither", async () => {
  const { tenantId } = await seedVenue(fx.db);
  const productId = await seedProduct(fx.db, tenantId);
  await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    // both set → reject
    await expect(
      tx.execute(sql`insert into recipe_lines (tenant_id, product_id, ingredient_id, component_product_id)
        values (current_tenant_id(), ${productId}, ${productId}, ${productId})`),
    ).rejects.toThrow();
    // neither set → reject
    await expect(
      tx.execute(sql`insert into recipe_lines (tenant_id, product_id) values (current_tenant_id(), ${productId})`),
    ).rejects.toThrow();
  });
});
```
(Add `seedVenue`/`seedProduct` imports if the file needs them; if `recipes.test.ts` in `packages/db` is schema-only, put the XOR insert test wherever the `packages/db` real-migration fixtures live, or in `packages/recipes` — keep it wherever a tenant + product can be seeded. The nullability query needs only the migration applied.)

- [ ] **Step 4: Run** — `pnpm --filter @waitron/db test recipes` and `pnpm --filter @waitron/db typecheck`. Expected: PASS.

- [ ] **Step 5: Prove the CHECK by deletion** — in a scratch run, remove the `check(...)` from the schema (or the CHECK line from 0043); confirm the "both/neither" test FAILS (the inserts now succeed); restore; confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/recipes.ts packages/db/drizzle/0043_recipe_lines_nesting.sql packages/db/drizzle/meta packages/db/src/schema/recipes.test.ts
git commit -s -m "feat(db): recipe_lines.component_product_id + ingredient/component XOR (nesting)"
```

---

## Task 2: Fold component allergens + set a component recipe (`@waitron/recipes`)

**Files:**
- Modify: `packages/recipes/src/recipes.ts`
- Test: `packages/recipes/src/recipes.test.ts` (add cases)

**Interfaces:**
- Produces: `setProductRecipe(tx, productId, spec: RecipeSpec)`, `getProductComponents(tx, productId): Promise<string[]>`; the fold now reads component published allergens.
- `type RecipeSpec = readonly string[] | { ingredientIds?: readonly string[]; componentProductIds?: readonly string[] }`.

- [ ] **Step 1: Write the failing tests** — add to `recipes.test.ts` (imports `products` from `@waitron/db`, already used; add a helper to create a second product to nest):

```ts
it("derives a parent's allergens from a component sub-product (nesting)", async () => {
  const published = await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = (await tx.select({ id: products.catalogueId }).from(products).where(eq(products.id, productId)))[0]!;
    // alioli = a composed product deriving eggs from an egg ingredient
    const alioli = await createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en: "alioli" },
      pricingUnit: "each", unitPrice: "1.00", vatClass: "general",
    });
    const egg = await createIngredient(tx, { name: "egg", allergens: { eggs: { presence: "contains" } } });
    const bread = await createIngredient(tx, { name: "bread", allergens: { gluten: { presence: "contains" } } });
    await setProductRecipe(tx, alioli.id, [egg.id]);
    // bocadillo = bread ingredient + the alioli PRODUCT
    await setProductRecipe(tx, productId, { ingredientIds: [bread.id], componentProductIds: [alioli.id] });
    const [row] = await tx.select({ a: products.allergens }).from(products).where(eq(products.id, productId));
    return row!.a;
  });
  expect(published).toEqual({ eggs: { presence: "contains" }, gluten: { presence: "contains" } });
});

it("a PENDING component makes the parent PENDING (contagion up the tree)", async () => {
  await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = (await tx.select({ id: products.catalogueId }).from(products).where(eq(products.id, productId)))[0]!;
    const sub = await createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en: "mystery sauce" },
      pricingUnit: "each", unitPrice: "1.00", vatClass: "general",
    }); // no recipe, no manual → published null → PENDING
    await setProductRecipe(tx, productId, { componentProductIds: [sub.id] });
  });
  expect(await publishedAllergens(tenantId, productId)).toBeNull();
});
```
(`createProduct` imported from `@waitron/catalogue`; `cat.id` uses the seeded product's own `catalogueId`.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/recipes test recipes`. Expected: FAIL — `setProductRecipe` does not accept the object spec / does not fold components.

- [ ] **Step 3: Implement** — in `packages/recipes/src/recipes.ts`:
  1. Add `products` to the `@waitron/db` import; add `and` if needed.
  2. Extend the fold (currently `recomputeProductAllergens`; keep the name this task) to left-join both tables and discriminate the line kind:

```ts
export async function recomputeProductAllergens(tx: Transaction, productId: string): Promise<void> {
  const rows = await tx
    .select({
      ingredientId: recipeLines.ingredientId,
      ingredientAllergens: ingredients.allergens,
      componentAllergens: products.allergens, // the sub-product's PUBLISHED declaration
    })
    .from(recipeLines)
    .leftJoin(ingredients, eq(ingredients.id, recipeLines.ingredientId))
    .leftJoin(products, eq(products.id, recipeLines.componentProductId))
    .where(eq(recipeLines.productId, productId));

  if (rows.length === 0) {
    await applyRecipeDerivation(tx, productId, null);
    return;
  }
  let pending = false;
  let floor: ProductAllergens = {};
  for (const row of rows) {
    // An ingredient line has ingredient_id set; a component line has it null (the XOR check guarantees it).
    const a = row.ingredientId !== null ? row.ingredientAllergens : row.componentAllergens;
    if (a === null) pending = true; // unreviewed ingredient OR PENDING/uncomposed component
    else floor = mergeAllergenMaps(floor, a);
  }
  await applyRecipeDerivation(tx, productId, { allergens: floor, pending });
}
```
  3. Extend `setProductRecipe` to accept the spec and insert both line kinds (cycle check comes in Task 3):

```ts
export type RecipeSpec =
  | readonly string[]
  | { ingredientIds?: readonly string[]; componentProductIds?: readonly string[] };

export async function setProductRecipe(
  tx: Transaction,
  productId: string,
  spec: RecipeSpec,
): Promise<void> {
  const ingredientIds = Array.isArray(spec) ? spec : (spec.ingredientIds ?? []);
  const componentProductIds = Array.isArray(spec) ? [] : (spec.componentProductIds ?? []);
  await tx.delete(recipeLines).where(eq(recipeLines.productId, productId));
  const values = [
    ...ingredientIds.map((ingredientId) => ({ tenantId: CURRENT_TENANT, productId, ingredientId })),
    ...componentProductIds.map((componentProductId) => ({
      tenantId: CURRENT_TENANT,
      productId,
      componentProductId,
    })),
  ];
  if (values.length > 0) await tx.insert(recipeLines).values(values);
  await recomputeProductAllergens(tx, productId);
}
```
  4. Add `getProductComponents`:

```ts
/** The component product ids that make up a product (the sub-recipe lines). */
export async function getProductComponents(tx: Transaction, productId: string): Promise<string[]> {
  const rows = await tx
    .select({ componentProductId: recipeLines.componentProductId })
    .from(recipeLines)
    .where(and(eq(recipeLines.productId, productId), isNotNull(recipeLines.componentProductId)));
  return rows.map((r) => r.componentProductId!);
}
```
(import `isNotNull` from `drizzle-orm`.)

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/recipes test recipes`. Expected: PASS (including #89's existing ingredient-only cases — the bare-`string[]` spelling still works).

- [ ] **Step 5: Prove the component-PENDING branch by deletion** — remove `if (a === null) pending = true;`; confirm the "PENDING component" test FAILS; restore; confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/recipes/src/recipes.ts packages/recipes/src/recipes.test.ts
git commit -s -m "feat(recipes): fold a component sub-product's allergens into the parent floor (nesting)"
```

---

## Task 3: Cycle detection + `recipe.cycle` error

**Files:**
- Create: `packages/recipes/src/errors.ts`
- Modify: `packages/recipes/src/recipes.ts` (cycle guard + `import "./errors.js"`)
- Modify: `packages/recipes/src/index.ts` (ensure `errors.ts` is reachable from the barrel)
- Test: `packages/recipes/src/recipes.test.ts` (add cases)

**Interfaces:**
- Produces: `recipe.cycle` error; `setProductRecipe` throws it on a self/transitive cycle.

- [ ] **Step 1: Write the failing tests** — add to `recipes.test.ts`:

```ts
it("rejects a self-referential component with recipe.cycle", async () => {
  await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    await expect(setProductRecipe(tx, productId, { componentProductIds: [productId] })).rejects.toMatchObject({
      code: "recipe.cycle",
    });
  });
});

it("rejects a two-hop cycle (A contains B, then B contains A)", async () => {
  await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = (await tx.select({ id: products.catalogueId }).from(products).where(eq(products.id, productId)))[0]!;
    const b = await createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en: "B" },
      pricingUnit: "each", unitPrice: "1.00", vatClass: "general",
    });
    await setProductRecipe(tx, productId, { componentProductIds: [b.id] }); // A contains B
    await expect(setProductRecipe(tx, b.id, { componentProductIds: [productId] })).rejects.toMatchObject({
      code: "recipe.cycle",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/recipes test recipes`. Expected: FAIL — the cyclic sets currently insert successfully.

- [ ] **Step 3: Create `errors.ts`**:

```ts
// packages/recipes/src/errors.ts
// A bare side-effect import so TypeScript augments the real "@waitron/shared" module.
import "@waitron/shared";

/** @waitron/recipes' contribution to the shared error registry — DOMAIN-CONCEPT prefixes. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /**
     * A product's recipe would reference itself, directly or transitively, as a component — a cyclic
     * bill of materials. Thrown by setProductRecipe before any line is written.
     */
    "recipe.cycle": { productId: string };
  }
}
```

- [ ] **Step 4: Add the cycle guard** — in `recipes.ts`, add `import { AppError } from "@waitron/shared";`, `import "./errors.js";`, and `import { sql } from "drizzle-orm";` (if not present). Add the helper and call it first in `setProductRecipe`. **Probe each proposed component with a SCALAR-seeded recursive CTE** — never bind a JS array into raw `sql` (Drizzle expands a JS array into comma-separated params, so `unnest(${arr}::uuid[])` would emit `unnest($1,$2,…)`, not a single array; only scalar `${componentId}`/`${productId}` interpolations are unambiguous here). `componentProductIds` is a handful of ids, so N scalar probes is cheap:

```ts
/** Would adding productId → any proposed component create a cycle? True iff productId is reachable DOWN from
 * a component (following component_product_id edges, under RLS), or a component IS productId (self-reference).
 * The graph is a DAG before each write and only productId's outgoing edges are being replaced, so reaching
 * productId requires a *→productId (parent) edge this write does not touch — one probe per component is sound. */
async function wouldCreateCycle(
  tx: Transaction,
  productId: string,
  componentProductIds: readonly string[],
): Promise<boolean> {
  for (const componentId of componentProductIds) {
    if (componentId === productId) return true; // length-1 cycle (also caught by the CTE seed below)
    const res = await tx.execute<{ hit: boolean }>(sql`
      with recursive reach(pid) as (
        select ${componentId}::uuid
        union
        select rl.component_product_id from recipe_lines rl
          join reach on rl.product_id = reach.pid
          where rl.component_product_id is not null
      )
      select exists(select 1 from reach where pid = ${productId}) as hit`);
    if (res.rows[0]!.hit) return true;
  }
  return false;
}
```
and at the top of `setProductRecipe`, after computing `componentProductIds`:
```ts
  if (await wouldCreateCycle(tx, productId, componentProductIds)) {
    throw new AppError("recipe.cycle", { productId });
  }
```
(Only scalar `${componentId}`/`${productId}` are interpolated — each reaches Postgres as a bound `$1`, never text. A recursive CTE is an ordinary statement, so placeholders apply, CLAUDE.md §3.)

- [ ] **Step 5: Ensure barrel reachability** — `packages/recipes/src/index.ts` already `export * from "./recipes.js";`, and `recipes.ts` now `import "./errors.js";`, so `errors.ts` is transitively reachable from `index.ts`. Confirm; no separate export line needed. (The root `errors-reachable` guard reads the import graph as text — the side-effect import is the reachable edge.)

- [ ] **Step 6: Run to verify pass** — `pnpm --filter @waitron/recipes test recipes` and `pnpm --filter @waitron/recipes typecheck`. Expected: PASS.

- [ ] **Step 7: Prove the guard by deletion** — remove the `if (await wouldCreateCycle(...)) throw ...` block; confirm the two-hop cycle test FAILS (the insert now succeeds); restore; confirm PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/recipes/src/errors.ts packages/recipes/src/recipes.ts packages/recipes/src/index.ts packages/recipes/src/recipes.test.ts
git commit -s -m "feat(recipes): reject cyclic sub-recipes with recipe.cycle"
```

---

## Task 4: Propagate derivation UP the DAG (topological)

**Files:**
- Modify: `packages/recipes/src/recipes.ts`
- Modify: `packages/recipes/src/ingredients.ts` (combined propagation walk)
- Test: `packages/recipes/src/recipes.test.ts` (add propagation + diamond cases)

**Interfaces:**
- Produces: `recomputeProductDerivation(tx, productId)` (single node), `recomputeProductAndAncestors(tx, seedIds)`, `recomputeAncestors(tx, productId)` (strict ancestors); `recomputeProductAllergens(tx, productId)` becomes `recomputeProductAndAncestors(tx, [productId])`.

- [ ] **Step 1: Write the failing tests** — add to `recipes.test.ts`:

```ts
it("propagates an ingredient change two levels up the tree", async () => {
  const [top, mid, leaf] = await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = (await tx.select({ id: products.catalogueId }).from(products).where(eq(products.id, productId)))[0]!;
    const mk = (en: string) => createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en },
      pricingUnit: "each", unitPrice: "1.00", vatClass: "general",
    });
    const alioli = await mk("alioli");
    const egg = await createIngredient(tx, { name: "egg" }); // unreviewed → PENDING
    await setProductRecipe(tx, alioli.id, [egg.id]);                          // alioli PENDING
    await setProductRecipe(tx, productId, { componentProductIds: [alioli.id] }); // bocadillo PENDING
    await updateIngredient(tx, egg.id, { allergens: { eggs: { presence: "contains" } } }); // tag the leaf
    return [productId, alioli.id, egg.id];
  });
  expect(await publishedAllergens(tenantId, top)).toEqual({ eggs: { presence: "contains" } });
  expect(await publishedAllergens(tenantId, mid)).toEqual({ eggs: { presence: "contains" } });
});

it("recomputes a shared grandparent exactly once and correctly (diamond)", async () => {
  const combo = await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = (await tx.select({ id: products.catalogueId }).from(products).where(eq(products.id, productId)))[0]!;
    const mk = (en: string) => createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en },
      pricingUnit: "each", unitPrice: "1.00", vatClass: "general",
    });
    const alioli = await mk("alioli");
    const egg = await createIngredient(tx, { name: "egg", allergens: { eggs: { presence: "contains" } } });
    await setProductRecipe(tx, alioli.id, [egg.id]);
    const left = await mk("left"); const right = await mk("right"); const comboP = await mk("combo");
    await setProductRecipe(tx, left.id, { componentProductIds: [alioli.id] });
    await setProductRecipe(tx, right.id, { componentProductIds: [alioli.id] });
    await setProductRecipe(tx, comboP.id, { componentProductIds: [left.id, right.id] }); // diamond top
    // change the leaf and confirm the top reflects it (both paths fresh):
    await updateIngredient(tx, egg.id, { allergens: { eggs: { presence: "contains" }, nuts: { presence: "may_contain" } } });
    return comboP.id;
  });
  expect(await publishedAllergens(tenantId, combo)).toEqual({
    eggs: { presence: "contains" }, nuts: { presence: "may_contain" },
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/recipes test recipes`. Expected: FAIL — the current single-node recompute does not update ancestors, so `top`/`combo` stay stale.

- [ ] **Step 3: Implement the topological walk** — in `recipes.ts`, rename the current fold to `recomputeProductDerivation` (single node, unchanged body from Task 2) and add. **Use the Drizzle query builder + `inArray` for the multi-id reads** (never a JS array in raw `sql`, per Task 3's note); build the ancestor closure with an iterative BFS up (a `visited` set + the DAG invariant guarantee termination), which sidesteps a recursive CTE that would need array binding:

```ts
import { and, eq, inArray, isNotNull } from "drizzle-orm";

/** All products reachable UP from `seedIds` (products that transitively contain a seed), plus the seeds.
 * Iterative BFS over component_product_id edges; `visited` + the DAG invariant (cycle detection) terminate it. */
async function ancestorClosure(tx: Transaction, seedIds: readonly string[]): Promise<string[]> {
  const affected = new Set<string>(seedIds);
  let frontier = [...new Set(seedIds)];
  while (frontier.length > 0) {
    const rows = await tx
      .select({ parent: recipeLines.productId })
      .from(recipeLines)
      .where(and(isNotNull(recipeLines.componentProductId), inArray(recipeLines.componentProductId, frontier)));
    const next: string[] = [];
    for (const r of rows) {
      if (!affected.has(r.parent)) {
        affected.add(r.parent);
        next.push(r.parent);
      }
    }
    frontier = next;
  }
  return [...affected];
}

/** Recompute every node in `affected` in child-before-parent (Kahn) order, so each parent folds its
 * components' already-fresh published values — correct for diamonds. Terminates because the graph is a DAG. */
async function kahnRecompute(tx: Transaction, affected: string[]): Promise<void> {
  if (affected.length === 0) return;
  const inDeg = new Map<string, number>(affected.map((p) => [p, 0]));
  const parentsOf = new Map<string, string[]>();
  const edges = await tx
    .select({ parent: recipeLines.productId, child: recipeLines.componentProductId })
    .from(recipeLines)
    .where(
      and(
        isNotNull(recipeLines.componentProductId),
        inArray(recipeLines.productId, affected),
        inArray(recipeLines.componentProductId, affected),
      ),
    );
  for (const e of edges) {
    const child = e.child!; // isNotNull filtered above
    inDeg.set(e.parent, (inDeg.get(e.parent) ?? 0) + 1);
    if (!parentsOf.has(child)) parentsOf.set(child, []);
    parentsOf.get(child)!.push(e.parent);
  }
  const queue = affected.filter((p) => (inDeg.get(p) ?? 0) === 0);
  while (queue.length > 0) {
    const n = queue.shift()!;
    await recomputeProductDerivation(tx, n);
    for (const parent of parentsOf.get(n) ?? []) {
      inDeg.set(parent, (inDeg.get(parent) ?? 0) - 1);
      if (inDeg.get(parent) === 0) queue.push(parent);
    }
  }
}

/** Recompute the seed products and every transitive ancestor, topologically. */
export async function recomputeProductAndAncestors(tx: Transaction, seedIds: readonly string[]): Promise<void> {
  await kahnRecompute(tx, await ancestorClosure(tx, seedIds));
}

/** Recompute only a product's STRICT ancestors (it is excluded — its own publish was already done). Used by
 * the server after a manual-overlay edit (catalogue.updateProduct) to reach parents. */
export async function recomputeAncestors(tx: Transaction, productId: string): Promise<void> {
  const affected = (await ancestorClosure(tx, [productId])).filter((p) => p !== productId);
  await kahnRecompute(tx, affected);
}

/** #89's public entry: recompute a product and propagate up. Keeps the name/signature setProductRecipe and
 * updateIngredient call. */
export async function recomputeProductAllergens(tx: Transaction, productId: string): Promise<void> {
  await recomputeProductAndAncestors(tx, [productId]);
}
```
(The `parentsOf.get(...) ?? parentsOf.set(...).get(...)!` idiom is dense — a plain `if (!parentsOf.has(child)) parentsOf.set(child, []); parentsOf.get(child)!.push(parent);` is clearer; use whichever passes lint. `setProductRecipe` still calls `recomputeProductAllergens(tx, productId)`, now propagating.)

- [ ] **Step 4: One combined walk in `updateIngredient`** — in `ingredients.ts`, replace the per-product loop:
```ts
  if (patch.allergens !== undefined) {
    const { recomputeProductAndAncestors, productsUsingIngredient } = await import("./recipes.js");
    await recomputeProductAndAncestors(tx, await productsUsingIngredient(tx, id));
  }
```
(Keep the existing dynamic-import-or-static choice the file already uses; `productsUsingIngredient` and `recomputeProductAndAncestors` both live in `recipes.js`.)

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @waitron/recipes test recipes`. Expected: PASS (propagation + diamond).

- [ ] **Step 6: Prove the topological gating by deletion** — in `kahnRecompute`, seed the queue with ALL affected nodes at once (`const queue = [...affected];`) instead of the in-degree-0 filter, and drop the decrement loop; confirm the **diamond** test FAILS (the top is recomputed before both children are fresh → stale `nuts`); restore; confirm PASS. (This proves the Kahn ordering, not just that recompute runs.)

- [ ] **Step 7: Coverage + commit**

```bash
pnpm --filter @waitron/recipes test:coverage
git add packages/recipes/src/recipes.ts packages/recipes/src/ingredients.ts packages/recipes/src/recipes.test.ts
git commit -s -m "feat(recipes): propagate allergen derivation up the recipe DAG (topological)"
```

---

## Task 5: Server wiring — component API + cycle status + manual-edit propagation

**Files:**
- Modify: `apps/server/src/recipe-api.ts` (accept `componentProductIds`, map `recipe.cycle` → 409)
- Modify: `apps/server/src/catalogue-api.ts` (`recomputeAncestors` after a manual-allergen PATCH)
- Test: `apps/server/src/recipe-api.test.ts`, `apps/server/src/catalogue-api.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**:
  - `recipe-api.test.ts`: `PUT …/recipe` with `{ componentProductIds: [subId] }` sets a component line (a following `GET …/recipe`-components read, or a derivation assertion, shows it); a `PUT …/recipe` with `{ componentProductIds: [sameProductId] }` → **409** with `error.code === "recipe.cycle"`.
  - `catalogue-api.test.ts`: seed product `P` with a component `C`; PATCH `C`'s allergens to `{ nuts: { presence: "contains" } }`; assert `P`'s published `allergens` now includes `nuts` (read back via `GET …/products`). This is the manual-overlay propagation.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/server test recipe-api catalogue-api`. Expected: FAIL.

- [ ] **Step 3: Implement `recipe-api.ts`**:
  - In `PUT /management-api/products/:id/recipe`, read `componentProductIds` too and validate it (array of strings, like `ingredientIds`); call `setProductRecipe(tx, productId, { ingredientIds, componentProductIds })`.
  - Add `"recipe.cycle": 409,` to the `STATUS` map. (`recipe.cycle`'s registry loads via the value import of `setProductRecipe`; the `import "./errors.js"` at the top of `recipe-api.ts` already loads the host codes.)

- [ ] **Step 4: Implement `catalogue-api.ts`** — in `PATCH /management-api/products/:id`, after the `updateProduct` call inside `gated`, propagate when allergens moved:
```ts
      await gated(sessionId, async (tx) => {
        await updateProduct(tx, productId, patch);
        if (patch.allergens !== undefined) {
          const { recomputeAncestors } = await import("@waitron/recipes");
          await recomputeAncestors(tx, productId);
        }
      });
```
(A dynamic `import("@waitron/recipes")` keeps the recipes barrel off catalogue-api's static graph and matches the "compose at the app layer" intent; a static import is equally fine since `apps/server` already deps `@waitron/recipes`. Match the file's existing import style.)

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @waitron/server test recipe-api catalogue-api` and `pnpm --filter @waitron/server typecheck`. Expected: PASS.

- [ ] **Step 6: Prove the manual propagation by deletion** — remove the `recomputeAncestors` call; confirm the catalogue-api manual-propagation test FAILS (parent `P` stays without `nuts`); restore; confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/recipe-api.ts apps/server/src/catalogue-api.ts apps/server/src/recipe-api.test.ts apps/server/src/catalogue-api.test.ts
git commit -s -m "feat(server): component recipes + recipe.cycle 409 + manual-overlay propagation to parents"
```

---

## Task 6: RLS + guards (component line isolation, immutability, reachability)

**Files:**
- Modify: `packages/recipes/src/recipe-lines.rls.test.ts` (a component line under real RLS)

- [ ] **Step 1: Add a component-line isolation case** — in `recipe-lines.rls.test.ts`, seed (as the probe, tenant A) a second product `C` and a recipe on the seeded product with `{ componentProductIds: [C.id] }`; assert tenant B's direct `countRecipeLines` is still `0` (the component line is isolated too). Reuse the existing single-table `count(*)` differential.

- [ ] **Step 2: Run (Docker required)** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/recipes test rls`. Expected: PASS.

- [ ] **Step 3: Prove isolation by deletion** — temporarily weaken `recipe_lines_tenant_isolation`'s USING to `true` (0039); confirm the cross-tenant count assertion FAILS with the component line present; restore; confirm PASS. (Same proof #89 recorded, now covering a component line.)

- [ ] **Step 4: Immutability guard** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. Expected: PASS — `recipe_lines` still reports `relforcerowsecurity = true` (adding a column did not change its RLS; spec D1/§6).

- [ ] **Step 5: Errors-reachable guard** — `pnpm vitest run scripts/errors-reachable.test.ts` (root project). Expected: PASS — `packages/recipes` now ships `src/errors.ts` reachable from `src/index.ts`. Prove by deletion: remove `import "./errors.js";` from `recipes.ts`; confirm the recipes case FAILS; restore; confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/recipes/src/recipe-lines.rls.test.ts
git commit -s -m "test(recipes): component-line RLS isolation + immutability/reachability guards (nesting)"
```

---

## Task 7: Demo + dashboard cycle message + component picker

**Files:**
- Modify: `apps/server/scripts/recipes-demo.ts` (nested scenario)
- Modify: `apps/dashboard/src/i18n/codes.ts` (`recipe.cycle` message, both locales)
- Modify: `apps/dashboard/src/widgets/recipe-editor.ts` (+ `.test.ts`) — pick products as components

- [ ] **Step 1: Extend the demo** — in `recipes-demo.ts`, add a nested scenario: build `alioli` as a composed product (egg + oil + garlic ingredients) deriving `{eggs}`; build `bocadillo` = bread ingredient + the alioli PRODUCT; print `bocadillo` inheriting `{eggs, gluten}`; leave an alioli ingredient unreviewed and print `bocadillo` going PENDING; attempt `setProductRecipe(alioli, { componentProductIds: [bocadillo.id] })` and print the caught `recipe.cycle`. Run it: `pnpm --filter @waitron/server exec tsx scripts/recipes-demo.ts` (match the existing invocation).

- [ ] **Step 2: Dashboard cycle message** — add `"recipe.cycle"` to `apps/dashboard/src/i18n/codes.ts` with an en + es sentence (e.g. en: "A recipe cannot contain itself.", es: "Una receta no puede contenerse a sí misma."). A test in `codes.test.ts` asserts `codeMessage("recipe.cycle")` is not the generic fallback.

- [ ] **Step 3: Component picker in `recipe-editor`** — extend the slice-2 `recipe-editor` widget: alongside the ingredient toggles, render a toggle list of **other products** (passed in as `@property components: Product[]` = candidate sub-products, excluding the edited product) reflecting the current component set (`@property componentProductIds: string[]`). On confirm, include `componentProductIds` in `save-recipe`. Update `SaveRecipeDetail` to `{ productId; ingredientIds; componentProductIds }`, the screen's `save-recipe` handler to call `api.setProductRecipe(productId, { ingredientIds, componentProductIds })`, and the `DashboardApi.setProductRecipe` signature to accept the object spec (mirror the server body). Add a widget test: toggling a component product emits `componentProductIds` in `save-recipe`.

- [ ] **Step 4: a11y** — extend `recipe-editor.a11y.test.ts` to mount with candidate components; scan both themes.

- [ ] **Step 5: Run** — `pnpm --filter @waitron/dashboard test recipe-editor codes` (fail → implement → pass); `pnpm --filter @waitron/dashboard test:coverage`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/scripts/recipes-demo.ts apps/dashboard/src/i18n/codes.ts apps/dashboard/src/i18n/codes.test.ts apps/dashboard/src/widgets/recipe-editor.ts apps/dashboard/src/widgets/recipe-editor.test.ts apps/dashboard/src/widgets/recipe-editor.a11y.test.ts apps/dashboard/src/api/client.ts apps/dashboard/src/screens/recipe-screen.ts
git commit -s -m "feat(recipes): nested sub-recipe demo + dashboard component picker + cycle message"
```

---

## Final gate (before finish-branch)

- [ ] `pnpm install` (no new dep expected) then `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] `pnpm --filter @waitron/recipes test:coverage`, `pnpm --filter @waitron/db test:coverage`, `pnpm --filter @waitron/server test:coverage` (98/98/98/95), `pnpm --filter @waitron/dashboard test:coverage` (95/95/90/88) — all green.
- [ ] Whole-workspace run once (the `inmutabilidad`, `errors-reachable` and cross-package guards are invisible to a `packages/recipes` scoped run): `TESTCONTAINERS_RYUK_DISABLED=true pnpm test`.
- [ ] Confirm no `packages/verifactu` / `packages/fiscal*` source changed and no fiscal table/hash/invoice path touched (only `fiscal-verifactu`'s `inmutabilidad` guard RAN, unchanged) — the H2 boundary. If any was, leave the PR `needs-owner-review` and do NOT land.
- [ ] Owner-review check (spec §8): if review contests the manual-overlay propagation (food-safety judgment), the `recipe.cycle` name/status, or the `setProductRecipe` dual spelling, leave `needs-owner-review` rather than landing on a guess.
- [ ] Hand off to the `finish-branch` skill (simplify → whole-branch review → fix wave → Copilot).

## Self-review notes (spec coverage)

- Spec D1 (unified table, no new RLS) → Task 1 + Task 6 (guard); D2 (fold published) → Task 2; D3 (cycle + recipe.cycle) → Task 3; D4/D5 (topological propagation + complexity) → Task 4; D6 (manual-edit server wiring) → Task 5; D7 (setProductRecipe spelling) → Task 2.
- Spec §3 derivation → Task 2 (fold) + Task 4 (order). §4 cycle CTE → Task 3. §5 server/dashboard → Tasks 5, 7.
- Spec §6 H2 → Final gate + Task 6 `inmutabilidad`. §7 testing → Tasks 1–6 (schema/CHECK, nesting fold, propagation+diamond, cycle, RLS, server, guards). §8 owner-review → Final gate + the deletion proofs (Tasks 3, 4, 5, 6).
- Spec §9 deferred → not built (UI polish, depth limits, batched propagation, costing/stock).
- Every new guard/branch proven by deletion: CHECK (T1.5), component-PENDING (T2.5), cycle (T3.7), Kahn order (T4.6), manual propagation (T5.6), RLS isolation (T6.3), errors-reachable (T6.5).
```
