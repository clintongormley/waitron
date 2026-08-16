# Recipes / BOM — slice 3: nested sub-recipes (sub-project 18)

**Date:** 2026-08-16. **Status:** design; plan alongside. **Builds on:** #89 (recipes/BOM allergen-inheritance
BACKEND) and the recipe-authoring UI slice (`2026-08-16-recipe-authoring-ui-design.md`).

#89 shipped **flat** composition: a product is made of *ingredients* (leaves carrying their own allergen
tags), and its allergen floor is the fold of those ingredients' declarations. Its D5 explicitly deferred
**nesting** — a recipe line that references another *composed product* — with the recursion, cycle detection
and depth-wise PENDING propagation it requires. This slice adds exactly that: a *bocadillo* whose recipe
lists the *bread* ingredient **and the *alioli* product** (itself composed of egg + oil + garlic ingredients),
with allergen derivation propagating **up** the tree, add-only and PENDING-contagious exactly as #89.

---

## 1. Decisions

| # | Decision |
| --- | --- |
| D1 | **A recipe line references an ingredient OR a composed product — one unified `recipe_lines` table.** `recipe_lines.ingredient_id` becomes **nullable**; a new nullable `recipe_lines.component_product_id uuid → products.id` is added; a CHECK enforces **exactly one** is non-null (`(ingredient_id IS NOT NULL) <> (component_product_id IS NOT NULL)`). This is the standard BOM "a component is a raw material OR a sub-assembly" model, keeps one "what is this product made of" table, and — crucially — needs **no new table, no new RLS migration**: the existing `recipe_lines_tenant_isolation` policy (row-level, on `tenant_id`) and the existing `GRANT SELECT,INSERT,UPDATE,DELETE ON recipe_lines TO app_user` (table-level) both already cover the added column. The `fiscal-verifactu` `inmutabilidad` FORCE-RLS guard already enumerates `recipe_lines` (it scans every `tenant_id`-bearing table), so it stays green with no change. Rejected: a separate `recipe_components` table — it would duplicate the tenant/RLS/grant machinery, split the recipe across two reads, and add a new FORCE-RLS table for no gain. |
| D2 | **A component product contributes its PUBLISHED `products.allergens` to the parent's floor; `NULL` (PENDING) contaminates the parent.** This is the SAFE fold: it captures the component's derived floor **and** its manual overlay **and** its PENDING state, so the parent can never declare *fewer* allergens than the component implies (#89 D4's legal-safety invariant). **Rejected: folding only the component's `recipe_derivation` floor** — self-contained (no cross-package propagation) but it **under-declares** whenever a component's allergen is known only via its *manual* overlay (a bought-in sauce declared `contains eggs` with no ingredient list would leak zero eggs to the parent), which is the unrecoverable, legally-unsafe direction. The cost of D2 is that a manual-overlay edit on a component must propagate to parents (D6). |
| D3 | **Cycle detection at write time keeps the graph a DAG.** `setProductRecipe` rejects any component set that would make the product reachable from itself, with a new error **`recipe.cycle` { productId }**. A single recursive-CTE reachability probe (is `productId` reachable **down** from any proposed component, following `component_product_id` edges under RLS) suffices, because the graph is a DAG **before** each write and only that product's outgoing edges are being replaced. A self-reference (`component_product_id = productId`) is the length-1 case, caught by the same probe. Because the invariant holds, all propagation (D4) terminates. `recipe.cycle` is the FIRST error code `@waitron/recipes` owns → new `packages/recipes/src/errors.ts` (declaration-merge into `@waitron/shared`), reachable from the barrel per the reachability rule; the root `errors-reachable` guard auto-covers it. |
| D4 | **Allergen derivation propagates UP the DAG, in topological order.** A change (a product's recipe, or an ingredient's allergens) recomputes the changed node(s) **and every transitive ancestor** (products that contain them, up the tree). Recompute runs children-before-parents (**Kahn's algorithm** over the affected sub-DAG), so each parent folds its components' already-fresh published values — correct even for **diamonds** (a grandparent reached via two paths is recomputed exactly once, after both children). Same add-only / PENDING-contagious semantics as #89: an unreviewed ingredient OR a PENDING component OR a component with no composition sets the parent PENDING. |
| D5 | **Complexity: nesting changes propagation from a single fan-out level to a transitive closure up the DAG.** #89's fan-out on an ingredient change was O(products using it), each an independent fold. With nesting, a change walks the whole ancestor closure — O(|ancestors| + edges among them) per change, one `recomputeProductDerivation` (a small SELECT-join + a republish) per affected node. At deli scale (dozens of products, nesting depth realistically ≤ 3) this is negligible; a set-based batched rewrite is the same **scale-gated deferral** #89 recorded for its fan-out (and #76/#87). The `recipe_lines_ingredient_id_idx` (0040) and a new `recipe_lines_component_product_id_idx` keep both fan-out directions index-backed. |
| D6 | **Cross-package propagation for a manual-overlay edit is wired at the SERVER layer, never in `@waitron/catalogue`.** A recipe/ingredient change propagates entirely within `@waitron/recipes` (recompute reads components' current published, updated bottom-up). But a pure **manual-allergen** edit goes through `catalogue.updateProduct` (which republishes only that product); to propagate it to parents, the server's `PATCH /management-api/products/:id` handler calls a new `recipes.recomputeAncestors(tx, productId)` **after** `updateProduct`, when the patch touched `allergens`. `@waitron/catalogue` stays recipe-unaware (it must not depend on `@waitron/recipes`); the composition lives in `apps/server`, which already depends on both. **Owner-review flagged** (§8): whether a manual/facility allergen on a sub-recipe should propagate to all parents is a food-safety judgment — the default is YES (the safe direction). |
| D7 | **`setProductRecipe` accepts components without breaking #89's ingredient-only callers.** New shape: `setProductRecipe(tx, productId, spec)` where `spec` is `readonly string[]` (the #89 ingredient-only spelling, kept as the primary ergonomic form and to preserve #89's suite's behavioural assertions verbatim) **or** `{ ingredientIds?: readonly string[]; componentProductIds?: readonly string[] }`. `getProductRecipe` is unchanged (still returns the ingredient lines); a new `getProductComponents(tx, productId): Promise<string[]>` returns the component product ids. This is not backwards-compat-with-data (there is none, pre-production) — it is keeping the existing spelling working so #89's landed tests keep asserting the same behaviour (CLAUDE.md "preserve behavioural assertions"). |

---

## 2. Data model

`packages/db/src/schema/recipes.ts` — `recipeLines` gains one column and loosens one:

```text
recipe_lines (nesting changes)
------------
id                   uuid PK                       (unchanged)
tenant_id            uuid FK tenants               (unchanged)
product_id           uuid FK products              (the parent — unchanged)
ingredient_id        uuid FK ingredients  NULL     (was NOT NULL → now nullable)
component_product_id uuid FK products     NULL     (NEW — a composed sub-product)
created_at                                         (unchanged)

CHECK  recipe_lines_ingredient_xor_component:  (ingredient_id IS NOT NULL) <> (component_product_id IS NOT NULL)
UNIQUE recipe_lines_product_ingredient_key   (product_id, ingredient_id)      (existing; NULLs distinct → OK)
UNIQUE recipe_lines_product_component_key    (product_id, component_product_id)   (NEW)
INDEX  recipe_lines_product_id_idx           (existing)
INDEX  recipe_lines_ingredient_id_idx        (0040, existing)
INDEX  recipe_lines_component_product_id_idx (NEW — the up-the-tree fan-out)
```

- **`component_product_id → products.id`** is a plain FK under RLS (all writes tenant-scoped), matching
  `product_id`/`ingredient_id`. Both point into the same `packages/db` core set (products already exist).
- The **CHECK** makes "a line is exactly one of ingredient/sub-product" a DB guarantee, not only an app
  invariant. The **new UNIQUE** stops a product listing the same sub-product twice; the **existing** UNIQUE
  on `(product_id, ingredient_id)` still works because Postgres treats NULLs as distinct, so the many
  component lines (each `ingredient_id = NULL`) never collide.
- **No quantity** (still qualitative allergen presence, #89 D6).

**Migration `0043_recipe_lines_nesting.sql`** — the next number (highest today is `0042`, verified
`ls packages/db/drizzle/*.sql`). Generated by `drizzle-kit generate` from the schema change: `ALTER COLUMN
ingredient_id DROP NOT NULL`, `ADD COLUMN component_product_id uuid` + its FK, `ADD CONSTRAINT … CHECK (…)`,
the new UNIQUE, and the new INDEX. If the running drizzle-kit version omits the CHECK from the generated SQL,
it is hand-added to the same file (editing a freshly-generated, undeployed migration is fine pre-production;
the repo hand-writes constraint DDL routinely). **No `0044` custom RLS migration is needed** (D1): the
existing policy and grants cover the added column. `drizzle-kit`'s meta snapshot is committed with it.

---

## 3. Allergen derivation with nesting

`recomputeProductDerivation(tx, productId)` (the #89 fold, extended) reads the product's lines, joining
`ingredients` (for ingredient lines) and `products` (for component lines, reading the **published**
`products.allergens`):

```text
floor = {}; pending = false
for each recipe_line of productId:
  a = (line is an ingredient line) ? ingredient.allergens : component_product.allergens   -- published
  if a IS NULL:  pending = true          -- unreviewed ingredient OR PENDING/uncomposed component (contagion)
  else:          floor = mergeAllergenMaps(floor, a)      -- add-only union (contains dominates may_contain)
applyRecipeDerivation(tx, productId, rows.length === 0 ? null : { allergens: floor, pending })
```

- A component whose published `allergens` is `NULL` (itself PENDING, or manually-declared-only with no
  reviewed composition) makes the parent PENDING — the safe direction, never an under-declaration.
- No recipe lines → `applyRecipeDerivation(…, null)` clears the derivation (falls back to the manual overlay),
  identical to #89.
- The fold, `mergeAllergenMaps`, `applyRecipeDerivation`, `RecipeDerivation` and the published-column
  contract are all **unchanged** — nesting only changes *where a line's allergen map comes from* and the
  *propagation order*, not the per-product derivation contract or the `republish` logic in `@waitron/catalogue`.

### Propagation (D4) — topological, diamond-correct

```text
recomputeProductAndAncestors(tx, seedIds):
  affected = seedIds ∪ transitive ancestors of seedIds        # recursive CTE up component_product_id edges
  kahnRecompute(tx, affected)

kahnRecompute(tx, affected):
  inDeg[n] = # of n's component-children that are in `affected`     # edges among affected only
  queue = affected nodes with inDeg 0                               # the seeds (their children aren't ancestors)
  while queue: n = queue.pop(); recomputeProductDerivation(tx, n)   # child before parent
               for each affected parent p of n: if --inDeg[p] == 0: queue.push(p)
```

- `recomputeProductAllergens(tx, productId)` (#89's public name, called by `setProductRecipe` and
  `updateIngredient`) becomes `recomputeProductAndAncestors(tx, [productId])` — signature unchanged, so
  #89's callers keep working while now propagating up.
- `updateIngredient` recomputes all products directly using the ingredient in **one** combined walk
  (`recomputeProductAndAncestors(tx, productsUsingIngredient(id))`), so a shared grandparent is recomputed
  once with both children fresh (no diamond transient).
- `recomputeAncestors(tx, productId)` (D6, for the manual-edit server wiring) = `kahnRecompute` over the
  **strict** ancestor set (the closure minus `productId` itself, which `updateProduct` already republished).
- Termination is guaranteed by the DAG invariant (D3). `affected` is the exact set that can change; every
  node in it is recomputed exactly once.

---

## 4. Cycle detection (D3)

```sql
-- wouldCreateCycle(productId, componentProductIds): is productId reachable DOWN from any proposed component?
WITH RECURSIVE reach(pid) AS (
  SELECT unnest($componentProductIds::uuid[])
  UNION
  SELECT rl.component_product_id FROM recipe_lines rl
    JOIN reach ON rl.product_id = reach.pid
    WHERE rl.component_product_id IS NOT NULL
)
SELECT EXISTS (SELECT 1 FROM reach WHERE pid = $productId) AS hit;
```

Plus the direct `componentProductIds.includes(productId)` self-reference guard (also caught by the CTE, since
`productId` would be a seed). Runs under RLS (tenant isolation), so it only follows this tenant's edges.
Sound because only `productId`'s outgoing (child) edges are being replaced; reaching `productId` requires a
`*→productId` (parent) edge, which this write does not touch. A hit → `throw new AppError("recipe.cycle",
{ productId })`, checked **before** the delete/insert.

Parameterised `sql` (Drizzle binds `$1`), never string concatenation — a recursive CTE is a regular
statement (not a utility statement), so placeholders apply (CLAUDE.md §3).

---

## 5. Server + dashboard wiring (minimal, to keep nesting reachable)

- **`apps/server/src/recipe-api.ts`** `PUT /management-api/products/:id/recipe` — the body gains an optional
  `componentProductIds?: string[]` (validated `typeof`/array like `ingredientIds`), forwarded as
  `setProductRecipe(tx, productId, { ingredientIds, componentProductIds })`. The `STATUS` map gains
  `"recipe.cycle": 409` (a conflict). `recipe-api.ts` adds `import "@waitron/recipes"`'s `recipe.cycle`
  reachability via the value import of `setProductRecipe`.
- **`apps/server/src/catalogue-api.ts`** `PATCH /management-api/products/:id` — after `updateProduct(tx, id,
  patch)`, when the patch touched `allergens`, call `await recomputeAncestors(tx, id)` (imported from
  `@waitron/recipes`) so a manual-overlay edit reaches parents (D6). Confined to the server; catalogue the
  package is untouched.
- **`apps/dashboard`** — add the `recipe.cycle` message to `codes.ts` (both locales) so a rejected cyclic
  save renders a sentence, not a raw code. Extending the `recipe-editor` to pick *products* as components is
  the user-facing completion; it reuses the slice-2 editor pattern and is included as the final task (a lean
  component `<select>`/toggle), but the backend value (schema, derivation, cycle, propagation, demo) stands
  without it.

---

## 6. Fiscal safety (H2)

**Commercial/catalogue-lane only; nothing here is a fiscal-path input.** Verified 2026-08-16:
`grep -rnil "allergen\|ingredient\|recipe\|manual_allergens\|component_product"
packages/verifactu/src packages/fiscal-verifactu/src packages/fiscal/src packages/core/src` (excluding tests)
returns **nothing**. `component_product_id` is a catalogue-lane FK between two `products` rows; the derivation
reads `products.allergens` (a #65 display field, never an input to `computeHuella`). This slice touches
`registros_facturacion`, the hash chain, invoice numbers, `envios`, `acks` and `computeHuella` **not at all**.
`recipe_lines` already carries `tenant_id` and is already under the fiscal-verifactu `inmutabilidad`
FORCE-RLS guard (#89); adding a column changes neither its RLS nor its guard membership — run
`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after 0043 to confirm `recipe_lines` still
reports `relforcerowsecurity = true`. A whole-branch review confirms the boundary at merge.

## 7. Testing

- **Schema (PGlite)** — `recipes.test.ts` in `packages/db`: 0043 creates `component_product_id`, makes
  `ingredient_id` nullable, and the CHECK rejects a row with **both** FKs set and a row with **neither**
  (two `expect(...).rejects`). Prove the CHECK by deletion (drop the constraint in a scratch run → both
  inserts succeed).
- **Derivation with nesting (PGlite)** — `@waitron/recipes`: the *bocadillo → [bread, alioli-product]*
  scenario derives `{gluten, eggs}` from bread's gluten + alioli's published eggs; a PENDING/uncomposed
  component makes the parent PENDING (prove by deletion of the `a === null → pending` branch); the add-only
  union across nested levels.
- **Propagation (PGlite)** — an ingredient change at the leaf (egg) propagates two levels up to the
  grandparent; a **diamond** (a *combo* containing two products that both contain *alioli*) recomputes the
  combo exactly once and correctly (prove by deletion of the Kahn in-degree gating → assert the diamond
  either regresses or the test detects a stale read).
- **Cycle detection (PGlite)** — `setProductRecipe(A, { componentProductIds: [A] })` throws `recipe.cycle`;
  a two-hop cycle (A contains B, then `setProductRecipe(B, { componentProductIds: [A] })`) throws; a valid
  deep chain does not. Prove by deletion of the `wouldCreateCycle` guard → the two-hop case now inserts and
  a later propagation would not terminate (assert the throw is what prevents it).
- **RLS (real PG)** — extend `recipe-lines.rls.test.ts`: a **component** line under tenant A is invisible to
  tenant B (direct `count(*)` under B's GUC = 0), proven by deletion of the tenant predicate — the same
  single-table differential #89 used, now with a component line present.
- **Server** — `recipe-api.test.ts`: `PUT …/recipe` with `componentProductIds` sets a component line; a
  self-cycle → 409 `recipe.cycle`. `catalogue-api.test.ts`: a manual-allergen PATCH on a component product
  updates its parent's published allergens (prove by deletion of the `recomputeAncestors` call → parent
  stays stale).
- **Guard** — `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` green after 0043.
- **errors-reachable** — the root guard (`scripts/errors-reachable.test.ts`) discovers `packages/recipes`
  now ships `src/errors.ts` reachable from `src/index.ts`; prove by deletion of `recipes.ts`'s
  `import "./errors.js"` → the recipes case fails, restore.
- Coverage 98/98/98/95 for `packages/db`, `packages/recipes`, `apps/server`; 95/95/90/88 for `apps/dashboard`.

## 8. Owner-review assumptions

Land the mechanical work; leave the PR `needs-owner-review` (do NOT land) if review contests any of these:

1. **Manual/facility-allergen propagation up the tree (D2/D6) is a food-safety judgment.** Default: a
   component's manual overlay (e.g. a facility-level `may_contain nuts`) **does** propagate to every parent
   (folding the component's published value, the safe direction). If the owner decides a facility annotation
   should stay product-local, that reverses D2 toward folding the derived floor — flag rather than guess.
2. **The `recipe.cycle` error name and its 409 status.** A new error code is a permanent identifier (never
   renamed once shipped). `recipe.cycle` names the domain concept (a cyclic BOM); if the owner prefers a
   different concept name, decide before it ships.
3. **`setProductRecipe`'s dual spelling (D7).** Keeping the bare-`string[]` ingredient-only form is a
   deliberate low-churn choice; if the owner wants a single object form, that is a call to make before
   rewriting #89's suite.
4. **Any drift into the fiscal core.** Per the campaign guardrail: editing `packages/verifactu` /
   `packages/fiscal*` source, `registros_facturacion`, the hash chain, or invoice numbering is out of bounds —
   STOP and flag.

## 9. Deferred (named, not built)

- **Nesting authoring UI polish** — beyond the lean component picker, e.g. showing the resolved allergen
  provenance ("eggs, via alioli") in the editor.
- **Depth / breadth limits** — a configurable max nesting depth is not imposed (cycle detection already
  guarantees termination; deli recipes are shallow).
- **Batched set-based propagation** — the scale-gated optimisation (D5), deferred as in #89/#76/#87.
- **Quantities / costing / stock** — the other recipes/BOM consumers (#89 §7), unchanged by nesting.

## 10. Provenance

The allergen legal basis (EU 1169/2011; RD 126/2015 Art. 6.5) is inherited from #65/#89, not re-derived —
nesting changes *how* the floor is computed (up a tree), not *what* must be declared. The data-model,
derivation, cycle and propagation choices were designed against the live tree on 2026-08-16
(`packages/recipes/src/recipes.ts`, `packages/db/src/schema/recipes.ts`,
`packages/db/drizzle/0039_recipes_rls.sql`, `packages/catalogue/src/derivation.ts`) — cited inline. The
"highest migration = 0042 → next is 0043" and the H2 grep are receipts run 2026-08-16. The claim that adding
a column needs no new RLS/grant is receipted by the existing table-level grant and row-level policy in
`0039_recipes_rls.sql` (read 2026-08-16) and confirmed at execution by the `inmutabilidad` + RLS tests (§7).
