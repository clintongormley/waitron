# Recipes / BOM — slice 2: recipe-authoring UI (sub-project 18)

**Date:** 2026-08-16. **Status:** design; plan alongside. **Builds on:** #89 (recipes/BOM allergen-inheritance
BACKEND — `@waitron/recipes`, tables `ingredients`/`recipe_lines`, `products.manual_allergens` +
`products.recipe_derivation` overlays, computed `products.allergens`).

The #89 backend is headless (package API + a demo). This slice gives it a **management-dashboard authoring
surface**: create/edit ingredients (with their EU-1169 allergen declaration) and compose a product's recipe
from those ingredients. It also closes the one **#89-flagged deferred follow-up**: the dashboard's existing
product allergen picker must **reseed from `manual_allergens`, not the published `products.allergens`** —
otherwise, once a recipe contributes a derived floor, the picker would show (and re-save) the *computed union*,
double-counting the recipe-derived allergens into the manual overlay.

Prior art this mirrors verbatim:
- **#78 catalogue UI** — the dashboard `screens/` + `widgets/` + one `DashboardApi` client, and the existing
  `dashboard-product-form` / `dashboard-allergen-picker` this slice fixes.
- **#93 purchase-invoice UI** — the newest management-dashboard slice; its `purchases-screen` /
  `purchase-list` / `purchase-form` shapes and its `mountPurchasingApi` / `gated()` / `PURCHASE_WRITE_PERMISSION`
  server pattern are the exact templates for the recipe screen and `mountRecipeApi`.

---

## 1. Decisions

| # | Decision |
| --- | --- |
| D1 | **Write permission = a NEW domain-named `recipe.manage`, granted to `manager` + `admin`.** Follows the **purchasing precedent** (`purchase.manage`, realised domain name) over the catalogue **placeholder** (`CATALOGUE_WRITE_PERMISSION: Permission = "person.manage"`, still deferred). Permissions are stable identifiers checked in `roleHasPermission` and — like error codes — are **never renamed once shipped**, so introducing the correct domain name now avoids a later rename. Recipe/ingredient authoring is a distinct management domain (a food-safety authoring surface), not staff admin. **Owner-review flagged** (§9): a permission-naming choice is a product decision. Pure code change in `packages/identity/src/permissions.ts` (add to `PERMISSIONS` + the `MANAGER` set) — **not** a schema migration; the role→permission map is code (`permissions.ts` design decision 3). |
| D2 | **New server route file `apps/server/src/recipe-api.ts`, `mountRecipeApi(app, deps, log)`, deps `{ db, cfg: { tenantId } }` — the minimal purchasing shape, NO `nodeId`.** Verified 2026-08-16: no sync-capture trigger references `ingredients`/`recipe_lines` (grep of `packages/db/drizzle/*.sql` for a trigger on either table returns nothing; migrations 0038–0040 add the tables + an index, no capture trigger), and the `@waitron/recipes` ops take no `nodeId`. So the API needs no sync origin, exactly like `mountPurchasingApi`. Mounted once in `apps/server/src/boot.ts` beside `mountPurchasingApi`. `@waitron/recipes` is already a server dependency (`apps/server/package.json`). |
| D3 | **Routes (all `gated(sessionId, …)` on `recipe.manage`):** `GET /management-api/ingredients` (list), `POST /management-api/ingredients` (create), `PATCH /management-api/ingredients/:id` (update name/allergens/active), `GET /management-api/products/:id/recipe` (the product's ingredient list), `PUT /management-api/products/:id/recipe` (replace the recipe — body `{ ingredientIds: string[] }`). No DELETE on ingredients (deactivate via `active`, matching the `@waitron/recipes` D10 grant posture); `PUT …/recipe` with `[]` clears the recipe. |
| D4 | **Expose `manual_allergens` on the product read** so the dashboard can seed the picker from the overlay a human authored. Add `manualAllergens` to catalogue's `PRODUCT_COLUMNS`, the `Product`/`RawProduct` types, and `toProduct` (`packages/catalogue/src/operations.ts`) — a read-only addition; `createProduct`/`updateProduct` already WRITE `manual_allergens` (#89). `listProducts` (which projects `PRODUCT_COLUMNS`) then carries it, and the catalogue-api `GET …/products` route returns it unchanged. The till read path (`listAvailableProducts`, its own projection) is **not** touched — the till shows the published union. |
| D5 | **The critical reseed fix.** In `apps/dashboard/src/widgets/product-form.ts`, seed BOTH the picker's `declaration` seed (`seedAllergens`) AND the live emitted value (`allergens`) from `product.manualAllergens`, not `product.allergens`. Reseeding from the published `allergens` would show the operator the **computed union** (manual ∪ recipe-derived) and — because a save writes the picker's value straight to `manual_allergens` — would **fold the derived floor back into the manual overlay** (double-counting; the floor would then survive even after its ingredient is removed). The product LIST widget keeps reading the published `allergens` (its allergen-state badge is correctly the published state). This is the exact `#89` deferred item. |
| D6 | **Dashboard surface = one `recipe` screen with two sections**, mirroring the #78/#93 list+form widget split: (a) **Ingredients** — `ingredient-list` (display, emits `edit-ingredient`) + `ingredient-form` (`wt-dialog`, create/edit, reusing `dashboard-allergen-picker` for the ingredient's own declaration + an `active` switch); (b) **Product recipes** — a catalogue `<select>` → product `<select>` → `recipe-editor` widget that toggles which ingredients compose the chosen product and saves via `PUT …/recipe`. New tags `dashboard-recipe-screen`, `dashboard-ingredient-list`, `dashboard-ingredient-form`, `dashboard-recipe-editor`. |
| D7 | **Browser-local types only.** The dashboard `DashboardApi` client gains hand-written `Ingredient` / `IngredientInput` / `IngredientPatch` / `RecipeLine` interfaces and `listIngredients`/`createIngredient`/`updateIngredient`/`getProductRecipe`/`setProductRecipe` methods hitting `/management-api/…`. It **never** imports `@waitron/recipes` (or any `@waitron/*` except `@waitron/ui`) at runtime — the house rule that keeps `@waitron/db`/Node builtins out of the browser bundle (see the `client.ts` header). Enum-free here; the `allergens` shape reuses the existing local `AllergenDeclaration`. |
| D8 | **No new DB migration, no schema change, no english-only / vocabulary-scope churn.** This slice uses #89's landed tables and the already-computed `products.allergens`. `recipes` is already in `GENERIC_PACKAGES` and `vocabulary-scope.test.ts`'s pin (from #89); `apps/*` is out of the english-only guard's scope by recorded decision. The only package-source change is catalogue's read-projection (D4) and the identity permission (D1). |

---

## 2. Server: the recipe management-api

`mountRecipeApi` mirrors `mountPurchasingApi` (`apps/server/src/purchasing-api.ts`) exactly:

```ts
export interface RecipeApiDeps {
  db: Database;
  cfg: { tenantId: string };
}

export function mountRecipeApi(app: Hono, deps: RecipeApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "recipe.failed");
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission: RECIPE_WRITE_PERMISSION });
      return fn(tx);
    });
  // …routes…
}
```

- `RECIPE_WRITE_PERMISSION: Permission = "recipe.manage"` (a file constant, referenced at every route — the
  purchasing/catalogue seam).
- The `STATUS` map carries the shared session/authz/request-shape codes every gated surface reuses
  (`management_session.required` → 401, `management_session.expired` → 401, `person.suspended` → 403,
  `authorization.not_permitted` → 403, `management.request_invalid` → 400, `shared.invalid_id` → 400) plus
  the allergen-validation codes `@waitron/catalogue` throws through `createIngredient`/`updateIngredient`
  (`allergen.invalid_code` / `allergen.invalid_presence` / `allergen.invalid_source` → 400). **No new
  domain error code is introduced this slice** — the recipe ops rely on FK constraints for referential
  integrity (a bad `ingredientId` in `PUT …/recipe` surfaces as the DB's FK violation, an opaque 500 the
  same way catalogue tolerates today; a `recipe.*` `not_found` seam is deferred and named in §11).
- Body validation is hand-rolled `typeof`, throwing `management.request_invalid { field }` — the
  management-api convention (no zod). `:id` params screened via `requireUuidParam(…, "ProductId")` →
  `shared.invalid_id` (400). Path bodies coerced with `?? {}`.

Each route body follows the purchasing handler anatomy: `run(c, log, async () => { const sessionId =
requireManagementSession(c); …validate…; const out = await gated(sessionId, (tx) => op(tx, …)); return
c.json(out, <code>); })`. Reads → `c.json(rows)`; `PUT …/recipe` → `c.body(null, 204)`.

## 3. Server: exposing the manual overlay (D4)

`packages/catalogue/src/operations.ts`:
- `PRODUCT_COLUMNS` gains `manualAllergens: products.manualAllergens`.
- `Product` and `RawProduct` gain `manualAllergens: ProductAllergens | null`.
- `toProduct` passes it through (it is already a `jsonb` of the same shape, no cast needed).

`products.allergens` (published, the computed union) is unchanged and still returned. `manual_allergens`
is `NULL` when a product was never reviewed and, today (no recipes yet), equals the published value — so
the round-trip is behaviour-preserving until a recipe adds a floor. The catalogue-api `GET
/management-api/catalogues/:id/products` route returns the enriched shape with no route change (it serialises
whatever `listProducts` returns).

## 4. Dashboard: screens, widgets, the reseed fix

**Shell wiring** (`dashboard-app.ts`): add `"recipe"` to the `Screen` union, `import
"./screens/recipe-screen.js";`, a nav `wt-button` (`data-test="nav-recipe"`, key `nav.recipe`), a `case
"recipe":` in `#renderScreen()` passing `.api`, and a matching block + `stubApi` stubs in
`dashboard-app.a11y.test.ts` (one nav-click + the single-`<h1>` assertion + an axe scan).

**`recipe-screen.ts`** (`dashboard-recipe-screen`) — owns all data as `@state()`, fetches on
`connectedCallback` via `this.api`, single-flight `busy`, error surfaced as `role="alert"` + `codeMessage`.
Two sections:
- *Ingredients*: `<dashboard-ingredient-list .ingredients=${…} @edit-ingredient=…>` + a "new" button →
  `<dashboard-ingredient-form .open .ingredient .busy @create-ingredient @update-ingredient @wt-close>`.
- *Product recipes*: a catalogue `<select>` (loads catalogues, then that catalogue's products) → a product
  `<select>` → `<dashboard-recipe-editor .product .ingredients .recipe .busy @save-recipe @wt-close>`.

**`ingredient-list.ts`** (`dashboard-ingredient-list`) — pure display: one `wt-card` per ingredient, its
allergen state localised at the render edge (`allergenStateName` — reuse the catalogue helper); emits
`edit-ingredient { id }` (bubbling+composed, handler `stopPropagation`). Raw state token kept in a `data-*`.

**`ingredient-form.ts`** (`dashboard-ingredient-form`) — a `wt-dialog` create/edit, `willUpdate` reseed on
`ingredient` change or open. Fields: `name` (`wt-input`), the `active` switch, and
`<dashboard-allergen-picker .declaration=${this.seed}>` seeded from `ingredient.allergens` (ingredients have a
single allergen field — no manual/published split, so seeding from `allergens` is correct here). On confirm:
CREATE **omits** `allergens` when the picker is PENDING (`value === null`) and sends the map otherwise
(`createIngredient` treats omitted as `null`); UPDATE always carries `allergens` (null clears to PENDING) plus
`name`/`active`. Emits `create-ingredient` / `update-ingredient { id, patch }`; does not close itself.

**`recipe-editor.ts`** (`dashboard-recipe-editor`) — for the chosen product, shows a checkbox/`wt-switch` per
available ingredient, pre-checked when in `this.recipe`. `willUpdate` reseeds the checked set from `recipe` on
`product`/`recipe` change. Emits `save-recipe { productId, ingredientIds }` on confirm (single-flight `busy`);
the screen calls `setProductRecipe` then reloads. Clearing all → `ingredientIds: []`.

**The reseed fix** (`product-form.ts`, D5) — in `willUpdate`:
```ts
this.allergens = p?.manualAllergens ?? null;      // live value (emitted on save → written to manual_allergens)
this.seedAllergens = p?.manualAllergens ?? null;  // picker seed
```
(was `p?.allergens`). Both change together: seeding only the picker but leaving the live value on the published
union would re-save the union as manual on an untouched form. The wire `Product` type gains
`manualAllergens: AllergenDeclaration`.

**i18n** — add `recipe.*` / `ingredient.*` keys to BOTH `en` and `es` in `strings.ts` (the compiler enforces
the pairing via `es: Record<StringKey, string>`); add any new client-validation / error codes to `codes.ts`
(both locale columns); reuse `allergenStateName`/`allergenName` from `domain.ts` for the ingredient rows.

**a11y** — every new widget and the screen gets a `*.a11y.test.ts` scanning **both light and dark** themes via
`describe.each(["light","dark"] as const)`, `mountWidget`, `expectNoA11yViolations` (the `test-helpers.ts`
axe-core-in-Chromium harness). Drive each widget into its richest state before the scan (form open, picker
"Revisado" on). Exactly one `<h1>` in the composed tree (the screen owns it via `t("recipe.title")`).

---

## 5. Fiscal safety (H2)

**Commercial/catalogue-lane only; `products.allergens` feeds no fiscal path.** Verified 2026-08-16:
`grep -rnil "allergen\|ingredient\|recipe\|manual_allergens\|component_product"
packages/verifactu/src packages/fiscal-verifactu/src packages/fiscal/src packages/core/src` (excluding tests)
returns **nothing** — no huella/registro/hash path references any of them. The only matches in those trees are
in fiscal-verifactu **test** files: `inmutabilidad.test.ts` (the word "recipe" as the immutability *recipe*
pattern) and `vocabulary-scope.test.ts` (which pins `"recipes"` in `GENERIC_PACKAGES`). This slice touches
`registros_facturacion`, the hash chain, invoice numbers, `envios`, `acks`, and `computeHuella` **not at all**:
it adds a management-api route file, a read-only column projection, dashboard UI, and a permission constant.
`manual_allergens` and the recipe tables carry `tenant_id` and are already covered by the fiscal-verifactu
`inmutabilidad` FORCE-RLS guard (#89); this slice adds **no** table, so that guard is unaffected. A
whole-branch review confirms the boundary at merge.

## 6. Owner-review assumptions

A fresh unattended executor should land the mechanical work but leave the PR `needs-owner-review` (do NOT land)
if any of these is contested by review or by a repo change discovered mid-flight:

1. **`recipe.manage` permission name (D1).** A new permission string is a permanent identifier (never renamed).
   The default (`recipe.manage`, granted to manager+admin, following purchasing) is recorded; if the owner
   prefers reusing `person.manage` (the catalogue placeholder) or a shared `catalogue.manage`, flag rather
   than guess. This is a product decision.
2. **Which roles may author recipes.** Default: manager + admin only (the same set as every other write gate).
   If the owner wants supervisors to author recipes, that is an owner call.
3. **The allergen-state vocabulary shown for an ingredient.** The list badge reuses the product allergen-state
   naming; whether an ingredient's PENDING/reviewed states need distinct wording is a food-safety-copy call
   (the allergen *list* itself remains a food-safety-advisor decision, per the backlog).
4. **Any drift into the fiscal core.** Per the campaign guardrail: if execution finds itself editing
   `packages/verifactu` / `packages/fiscal*` source, `registros_facturacion`, the hash chain, or invoice
   numbering, STOP and flag — this slice must not touch them.

## 7. Testing

- **Catalogue read (D4)** — a `packages/catalogue` op test that `createProduct`/`listProducts` round-trips
  `manualAllergens` distinctly from published `allergens` once a `recipe_derivation` is present (via
  `applyRecipeDerivation`): manual `{gluten}`, derived `{eggs}` → published `{eggs,gluten}` but
  `manualAllergens === {gluten}`. Proven by deletion of the new `PRODUCT_COLUMNS` entry (the test reads
  `undefined`).
- **Permission (D1)** — extend `packages/identity/src/permissions.test.ts`: a `recipe.manage` block
  (manager+admin true, staff+supervisor false) AND the existing exhaustive `for (const p of PERMISSIONS)
  expect(roleHasPermission("manager"/"admin", p)).toBe(true)` rows still pass with the new member. This is a
  hardcoded-list pin (CLAUDE.md §2): adding to `PERMISSIONS`/`MANAGER` without updating the block leaves it red.
- **recipe-api (PGlite mechanics)** — `apps/server/src/recipe-api.test.ts` (Hono `app.request`, PGlite,
  `[CORE_MIGRATIONS, IDENTITY_MIGRATIONS]`, a `manager` + a `staff` session, the `catalogue-api.test.ts`
  `send`/`mountApp` helpers): happy create/list/update ingredient; get/set a product's recipe; missing/wrong
  field → 400 `management.request_invalid { field }`; no cookie → 401; staff cookie → 403
  `authorization.not_permitted`.
- **recipe-api (real-PG RLS + gate-by-deletion)** — `apps/server/src/recipe-api.rls.test.ts`
  (`useRealPostgres`, one Hono app per tenant, a full venue via `@waitron/provisioning`): cross-tenant
  isolation (tenant B's session never lists tenant A's ingredients) and the gate proven by deletion (a `staff`
  session 403s; removing `authorizeManager` turns it green→red).
- **Dashboard widgets** — `*.test.ts` (Vitest browser/Chromium, `mountWidget`, `data-test` queries,
  `vi.fn()` api stubs): ingredient-form emits the right create/update events with the create-vs-patch allergen
  asymmetry; recipe-editor emits `save-recipe` with the toggled ingredient set; **product-form reseeds the
  picker from `manualAllergens`** — a product with `allergens: {eggs,gluten}` (published) but
  `manualAllergens: {gluten}` opens the picker showing only `gluten` (proven by deletion: reverting the seed to
  `p?.allergens` makes the assertion fail — the double-count regression).
- **a11y** — `*.a11y.test.ts` per widget + screen, both themes, zero axe violations.
- Coverage: **95/95/90/88** for `apps/dashboard` (browser package); **98/98/98/95** for `apps/server`,
  `packages/catalogue`, `packages/identity`.

## 8. Deferred (named, not built)

- **Nested sub-recipes UI** — selecting a *product* as a recipe component; the backend is slice 3
  (`2026-08-16-nested-sub-recipes-design.md`), and the recipe-editor gains a component picker there.
- **Ingredient quantities / units / cost** — the costing (*escandallo*) and stock consumers (#20), not
  allergens (#89 D6).
- **A `recipe.not_found` / `ingredient.not_found` seam** — the recipe ops rely on FK constraints today
  (catalogue's precedent); a domain `*.not_found` pre-check is a later refinement.
- **Ingredient deactivation UX** beyond the `active` toggle (e.g. hiding inactive ingredients from the
  recipe-editor picker) — a convenience, deferred.
- **Browser-safe shared allergen-code constant** — the dashboard still redefines the EU-14 order locally
  (backlog *Debt*); out of scope here.

## 9. Provenance

The legal basis for allergen declaration (EU 1169/2011 Art. 9(1)(c) / 4(1)(b); RD 126/2015 Art. 6.5) was
verified on primary source in the #65 menu-&-allergens design and is not re-derived; this slice changes only
*where the operator authors* the declaration, not *what* must be declared. The dashboard/server patterns
(Lit + one `DashboardApi`, Hono `mount*Api` + `gated()`, the `#93` purchasing precedent, the `#78`
`product-form`/`allergen-picker`) and the double-count risk (D5) were established by reading the live tree on
2026-08-16 (`apps/dashboard/src/widgets/product-form.ts`, `apps/server/src/purchasing-api.ts`,
`packages/identity/src/permissions.ts`) — cited inline. The sync-capture-absence receipt for the no-`nodeId`
deps (D2) is the migration grep in D2.
