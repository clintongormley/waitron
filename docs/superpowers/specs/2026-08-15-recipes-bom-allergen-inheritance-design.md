# Recipes / BOM — slice 1: allergen inheritance (sub-project 18)

**Date:** 2026-08-15. **Status:** design approved in brainstorm; plan next.

Recipes/BOM is sub-project 18's "linchpin" — the model that drives allergen derivation, plate
costing (*escandallo*), and stock depletion. It is a subsystem, so it is decomposed: every first
slice builds the shared **foundation** (an ingredient master + a product→ingredients composition),
and this slice proves that foundation against exactly one consumer — **allergen inheritance**. Costing
and stock are named-but-deferred consumers of the same foundation.

Prior art this builds on: [menu & allergens design](2026-08-07-menu-allergens-design.md) (#65) shipped
the direct-tag allergen declaration and stated the intent that *"when recipes arrive later they become
a source"*; [catalogue model design](2026-08-05-catalogue-model-design.md) (#59) built the
`catalogues → products` model. This slice realises that "source" relationship.

---

## 1. Decisions

| # | Decision |
| --- | --- |
| D1 | **First consumer = allergen inheritance.** Chosen over costing (needs cost prices) and stock (needs inventory #20, unbuilt) because it has no unbuilt upstream dependency and is the launch-day legal reason #18 exists. Costing/stock are deferred consumers of the *same* foundation. |
| D2 | **Separate ingredient master.** A distinct `ingredients` table (raw materials: name + its own allergen declaration), NOT a widened/unified `products` table. Keeps the sale-linked, legally-connected `products` table clean; matches the standard F&B split of *menu items* vs *inventory items*. A dual-role item (sold-by-weight jamón) is just a product whose recipe has one ingredient → its allergens derive from that ingredient, declared once, no drift. This dissolves the only real objection to a separate master. |
| D3 | **Packaged as an optional module — `@waitron/recipes`.** Depends on `@waitron/catalogue` + `@waitron/db`; nothing depends on it. With zero recipe rows, catalogue/products/sales behave exactly as today (the shipped #65 direct-tag path is untouched). The module only *augments* — it supplies a derived allergen floor that catalogue publishes. |
| D4 | **Allergen authority = derived floor + add-only, PENDING contagious.** The published declaration is the union of the recipe-derived floor and a manual overlay staff can only ADD to (never remove a derived allergen). If any ingredient in a recipe is unreviewed, the product publishes PENDING. Legally safest: the system can never declare *fewer* allergens than the ingredients imply, and never silently reads an unreviewed thing as safe. |
| D5 | **Flat composition (one level) this slice.** A product is made of ingredients; ingredients are leaves carrying their own allergen tags (alioli tagged "eggs" once). Nested sub-recipes (alioli auto-derived from egg+oil+garlic) — with the recursion, cycle-detection, and depth-wise PENDING propagation they require — are slice 2. Cheap to add later: pre-production, so a schema change is drop-and-recreate, not a migration. |
| D6 | **No quantity / unit / cost columns this slice.** Allergen presence is *qualitative* — a sandwich contains egg because alioli is *in* it, regardless of grams. Quantities/units arrive with the costing and stock consumers, which actually need them. Slice 1 stores only the ingredient *list* per product. |
| D7 | **`products.allergens` stays the published read surface.** ~15 shipped consumers (till counter/allergen screens, dashboard widgets, `/api/products`, i18n resolvers) read `products.allergens`; none change. It becomes a *computed* column (see §3). Staff authoring retargets to a new `manual_allergens` overlay — a ~2-op change in `catalogue/operations.ts`, versus ~15 consumer changes if we introduced a new published column instead. |
| D8 | **Own-`drizzle/` migration module.** New tables live in `packages/recipes/drizzle` (the identity/sync/workforce pattern, registered in `packages/migrations/migrations.manifest.json`), NOT in `packages/db`. Keeps the optional module self-contained and off the `packages/db/_journal.json` collision hot-spot. The two additive `products` columns are unavoidably a small `packages/db` migration (they sit on a db-owned table). |
| D9 | **Headless + demo this slice — no UI.** Authoring is the package API plus a runnable `recipes-demo.ts`, matching the #59/#65 "backend-first" precedent (catalogue design D12). The dashboard recipe editor and the derived-allergen locking in the allergen picker are a later UI slice. |
| D10 | **Grants follow catalogue's posture (D11 there).** `app_user` gets `SELECT, INSERT, UPDATE` on `ingredients` (deactivate via `active`, no `DELETE` — an ingredient may be referenced by `recipe_lines`) and `SELECT, INSERT, UPDATE, DELETE` on `recipe_lines` (setting a product's recipe replaces its lines). Both tables are tenant-scoped → **FORCE RLS + tenant-isolation policy + grants**, hand-written custom migration, verified by the fiscal-verifactu `inmutabilidad` guard. |

---

## 2. Data model

Two new tenant-scoped tables (`packages/recipes/drizzle`) and two additive columns on `products`
(`packages/db/drizzle`).

```text
ingredients                     recipe_lines                    products (2 columns added)
-----------                     ------------                    --------------------------
id            uuid PK           id            uuid PK           manual_allergens  jsonb NULL
tenant_id     uuid FK tenants   tenant_id     uuid FK tenants   recipe_derivation jsonb NULL
name          text              product_id    uuid FK products  allergens         jsonb NULL
allergens     jsonb NULL        ingredient_id uuid FK ingredients   (published; read surface, unchanged)
  NULL = PENDING ingredient     UNIQUE (product_id, ingredient_id)
active        bool default true created_at / updated_at
created_at / updated_at
```

- **`ingredients.allergens`** reuses catalogue's `ProductAllergens` shape exactly
  (`Record<string, {presence: "contains"|"may_contain", source?}>`), validated at runtime by a
  reused `validateAllergens`. `NULL` means the ingredient has not been reviewed — a PENDING ingredient
  — mirroring the products invariant. `{}` means reviewed, contains none of the 14.
- **`recipe_lines`** is the flat composition: which ingredients a product is made of. No quantity
  column (D6). `UNIQUE(product_id, ingredient_id)` — an ingredient appears at most once per product's
  recipe. FK `product_id → products` and `ingredient_id → ingredients`; both tenant-scoped, plain FKs
  under RLS (all writes are tenant-scoped, matching the catalogue design's composite-vs-plain call).
- **Cross-set FK.** `recipe_lines.product_id → products` crosses migration sets (recipes set →
  db/core set). This is the established pattern — `workforce` FKs `persons` (identity) and `locations`
  (db). The manifest orders `core` first, so `products` exists when `recipe_lines` is created.
- **`products.manual_allergens`** — the staff authoring overlay (what a human explicitly declared).
  `NULL` = not reviewed. Catalogue's authoring ops write here (retargeted from `allergens`).
- **`products.recipe_derivation`** — the recipe module's overlay, a blob `{allergens, pending} | NULL`.
  `NULL` = no recipe (or module absent). Written only via a catalogue op the recipe module calls.
- **`products.allergens`** — the published declaration, **computed** from the two overlays (§3).
  Still the single column every consumer reads; `NULL` still = PENDING.

**No backfill.** Pre-production (drop & recreate); there is no data whose old-shape `allergens` needs
moving into `manual_allergens`. Per the house rule, no data-migration code is written.

---

## 3. Allergen derivation and publication

`products.allergens` is published from the two overlays on the same row:

```text
  manual_allergens ──┐
                     ├──►  republish(manual, derivation)  ──►  products.allergens  ──►  consumers
  recipe_derivation ─┘              (pure)                     (published)
        ▲
        └── written by @waitron/recipes when a recipe exists (else NULL)
```

**`republish(manual, derivation)`** — pure, in `@waitron/catalogue` (it owns the column and the
allergen semantics):

- `derivation` is `{allergens, pending} | null` (`null` = no recipe present).
- If `derivation.pending` → **`null` (PENDING)** — an unreviewed ingredient in the recipe (contagion).
- Else `manual == null && derivation == null` → **`null` (PENDING)** — nothing reviewed at all
  (today's behavior for a product with no recipe and no manual review).
- Else → **`mergeAllergenMaps(derivation?.allergens ?? {}, manual ?? {})`** — the add-only union.

**`mergeAllergenMaps(a, b)`** — pure, in catalogue: union of keys; for a shared code,
`presence = "contains"` if *either* map says `contains`, else `"may_contain"` (contains dominates).
`source` stays a single `string` (catalogue's type; a locale map is deferred, per #65): the distinct
non-empty sources are comma-joined into one string, so two egg sources become `"egg, mayonnaise"`
rather than a set.

**Why both overlays are stored on the row.** A manual edit and a recipe edit each recompute
`allergens` from the same two inputs, so neither wipes the other. "Removing a derived allergen" is
*unrepresentable* — manual can only add keys; the floor's keys always appear — which is what makes
the add-only invariant structural rather than enforced by a check. If the derived floor lived in a
recipes-owned table instead, catalogue's republish would have to read across packages (a dependency
cycle) or a manual edit would publish manual-only and wipe the floor. The columns-on-`products`
choice is what keeps the read path independent of the optional module.

**Ownership / dependency direction.** `mergeAllergenMaps` and `republish` live in catalogue.
`@waitron/recipes` computes the floor (folding its ingredients' maps via `mergeAllergenMaps`) and
calls a catalogue op `applyRecipeDerivation(db, productId, derivation | null)` that writes
`recipe_derivation` and republishes. Recipes depends on catalogue; catalogue never depends on
recipes. Module-absent, catalogue's own authoring op republishes manual-only (floor empty), so the
read surface works with the module uninstalled.

**Publication cases** (proven by test):

| manual | recipe_derivation | published `allergens` |
| --- | --- | --- |
| `null` | `null` | `null` (PENDING) — nothing reviewed |
| `{}` | `null` | `{}` — reviewed, none |
| `{gluten}` | `null` | `{gluten}` |
| `null` | `{allergens:{eggs}, pending:false}` | `{eggs}` |
| `{nuts:may_contain}` | `{allergens:{eggs}, pending:false}` | `{eggs, nuts}` (add-only) |
| any | `{…, pending:true}` | `null` (PENDING) — unreviewed ingredient |

---

## 4. Public API (headless)

**`@waitron/recipes`:**

- `createIngredient(db, { name, allergens? })` → ingredient row (`allergens` optional; omitted = PENDING).
- `updateIngredient(db, id, { name?, allergens?, active? })` → updates, then **recomputes and
  republishes every product whose recipe includes this ingredient** (the fan-out that makes "tag
  alioli once" propagate to every sandwich using it).
- `listIngredients(db)` / `getIngredient(db, id)`.
- `setProductRecipe(db, productId, ingredientIds[])` → replaces the product's `recipe_lines`, then
  recomputes the floor and calls `applyRecipeDerivation`. `[]` clears the recipe (derivation → `null`).
- `getProductRecipe(db, productId)` → the ingredient list.
- (internal) `recomputeProductAllergens(db, productId)` → gather the product's ingredients' allergen
  maps, fold via `mergeAllergenMaps`, set `pending = true` if any ingredient's `allergens` is `null`,
  and call catalogue's `applyRecipeDerivation`.

**`@waitron/catalogue` (additions):**

- Columns `manual_allergens`, `recipe_derivation` (schema in `packages/db`).
- Pure `mergeAllergenMaps` and `republish` (in `allergens.ts`).
- `applyRecipeDerivation(db, productId, derivation | null)` — writes `recipe_derivation`, republishes.
- Existing authoring (`createProduct`/`updateProduct` allergen path) retargets to `manual_allergens`,
  then republishes. Reading `allergens` back returns the published value (= manual when no recipe).

**Demo:** `apps/server/scripts/recipes-demo.ts` — creates the alioli ingredient, a bocadillo product,
sets its recipe, and shows the sandwich inheriting "eggs"; adds a manual "may contain nuts"; leaves an
ingredient unreviewed and shows the product go PENDING.

---

## 5. Fiscal safety (H2)

Commercial/catalogue-lane only. **`products.allergens` feeds no fiscal path** — verified 2026-08-15:
`grep` for `allergens` across `packages/verifactu`, `packages/fiscal-verifactu`, and
`packages/core/src` finds no reference in any huella/registro/hash path; allergens is a display field
added in #65, long after the fiscal core, and is not an input to `computeHuella`. Nothing in this
slice touches `registros_facturacion`, the hash chain, invoice numbers, `envios`, or `acks`. A
whole-branch review confirms the boundary at merge, as every slice does.

The two new tables carry `tenant_id`, so the fiscal-verifactu `inmutabilidad` guard (which scans every
`tenant_id`-bearing table for FORCE RLS) will require FORCE RLS + a tenant-isolation policy on both —
this is a correctness gate for the slice, not merely a convention (`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`).

---

## 6. Testing

- **Pure** (unit): `mergeAllergenMaps` (contains dominates may_contain; source dedupe) and `republish`
  (every §3 case; PENDING contagion; add-only). Proven by deletion where a guard is load-bearing.
- **Ops** (PGlite): create/update/list ingredients; set/get/clear a product's recipe; the derivation
  writing the correct `recipe_derivation` and published `allergens`.
- **Propagation** (PGlite): changing an ingredient's allergens republishes every dependent product;
  proven by deletion of the fan-out step.
- **RLS/grants** (real Postgres, per §4 of CLAUDE.md — privileges/RLS need real PG):
  `ingredients.rls.test.ts` + `recipe_lines.rls.test.ts` — differential cross-tenant isolation under
  the non-superuser `app_user` with FORCE RLS, each proven by deletion of the tenant predicate.
- **Interaction with the shipped column**: a product with no recipe still publishes exactly today's
  value; a consumer reading `products.allergens` is unaffected.
- **Guard**: fiscal-verifactu `inmutabilidad` after adding the tenant tables.
- Coverage 98/98/98/95 (non-browser package).

---

## 7. Deferred (named, not built)

- **Quantities / units of measure** — needed by costing and stock, not by allergens (D6).
- **Plate costing (*escandallo*)** — the second consumer; needs an ingredient cost price (manual now,
  real purchase prices via procurement #20 later).
- **Stock depletion** — the third consumer; needs inventory (#20).
- **Nested sub-recipes** — slice 2 (D5): ingredients that are themselves recipes, recursive
  derivation, cycle detection, depth-wise PENDING.
- **Dietary flags** (vegetarian/vegan) — derivable from ingredients like allergens, but a separate
  feature; not this slice.
- **Authoring UI** — the dashboard recipe editor and locking derived allergens (non-removable) in the
  allergen picker; a later UI slice. Slice 1 is headless + demo (D9).
- **Customer-facing browse** — unrelated sub-project 18 surface.

---

## 8. Provenance

The legal basis for allergen declaration (EU 1169/2011 Art. 9(1)(c) / 4(1)(b); RD 126/2015 Art. 6.5)
was verified on primary/authoritative source in the [#65 menu & allergens design](2026-08-07-menu-allergens-design.md)
§Legal basis and §10, and is not re-derived here — this slice changes *how* the declaration is
produced (derived from ingredients), not *what* must be declared. The one new claim, that
`products.allergens` is not a fiscal-path input, is receipted in §5 (a `grep` over the three fiscal
packages, 2026-08-15).
