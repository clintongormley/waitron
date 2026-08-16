# Recipe-authoring UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the #89 recipe/allergen BACKEND a management-dashboard authoring surface (ingredients + product recipes), and reseed the product allergen picker from `manual_allergens` (not the published union) so recipe-derived allergens are never double-counted.

**Architecture:** A new Hono `mountRecipeApi` (`apps/server/src/recipe-api.ts`, gated on a new `recipe.manage` permission) exposes the `@waitron/recipes` ops as `/management-api/…` routes. The dashboard gains a `recipe` screen (ingredient list/form + a product-recipe editor) built from Lit widgets calling the one `DashboardApi` client with browser-local types. The catalogue product read is enriched with `manualAllergens`, and `dashboard-product-form` seeds its allergen picker from it.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, PostgreSQL (real via Testcontainers) + PGlite, Lit 3, `@vitest/browser` (Chromium) + axe-core, Vitest 3, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-08-16-recipe-authoring-ui-design.md](../specs/2026-08-16-recipe-authoring-ui-design.md)

## Global Constraints

- **No backwards-compat / data-migration code** — pre-production; nothing is deployed. This slice adds no DB migration and no schema change.
- **Fiscal boundary (H2):** touch nothing in `packages/verifactu` / `packages/fiscal*` source, `registros_facturacion`, the hash chain, invoice numbers, `envios`, `acks`, or `computeHuella`. `products.allergens` / `manual_allergens` / the recipe tables feed no fiscal path (spec §5, grep-verified 2026-08-16). If execution drifts into any of these, leave the PR `needs-owner-review` and do NOT land.
- **Permissions are stable identifiers** — a new one is never renamed once shipped. `recipe.manage` is a pure code change in `packages/identity/src/permissions.ts` (add to `PERMISSIONS` + the `MANAGER` set), not a migration. Update the `permissions.test.ts` pin in the same change (hardcoded-list trap, CLAUDE.md §2).
- **Error codes name the DOMAIN CONCEPT, never the package.** This slice adds no new error code — it reuses `management.request_invalid`, `shared.invalid_id`, and the catalogue `allergen.*` codes. Any file that throws a code does `import "./errors.js"`.
- **Dashboard uses BROWSER-LOCAL types.** `apps/dashboard/src/api/client.ts` never imports `@waitron/*` at runtime except `@waitron/ui`. Add hand-written `Ingredient`/`RecipeLine`/etc. interfaces.
- **a11y (axe) in BOTH themes** for every new widget and the screen; exactly one `<h1>` in the composed tree.
- **Coverage thresholds:** `apps/dashboard` **95/95/90/88** (browser package); `apps/server`, `packages/catalogue`, `packages/identity` **98/98/98/95**.
- **Every commit `-s`** (`git commit -s`; CI's `dco` walks the range).
- **Gate before pushing:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus `pnpm --filter <pkg> test:coverage` for every touched package, plus a whole-workspace run before finish-branch.

---

## File structure

**`packages/identity`** — add the `recipe.manage` permission (Task 1).
**`packages/catalogue`** — expose `manualAllergens` on the product read (Task 2).
**`apps/dashboard`** — product-form reseed fix (Task 3), api-client methods (Task 6), widgets (Tasks 7–8), screen + shell wiring + i18n (Task 9).
**`apps/server`** — `recipe-api.ts` + boot wiring (Task 4), RLS test (Task 5).

---

## Task 1: `recipe.manage` permission (`@waitron/identity`)

**Files:**
- Modify: `packages/identity/src/permissions.ts`
- Test: `packages/identity/src/permissions.test.ts`

**Interfaces:**
- Produces: `"recipe.manage"` added to `PERMISSIONS` (→ `Permission` union) and to the `MANAGER` set.

- [ ] **Step 1: Write the failing test** — add to `permissions.test.ts` (after the `purchase.manage` block):

```ts
it("grants recipe.manage to manager and admin only (recipe authoring)", () => {
  // A domain-named authoring permission (ingredient + product-recipe authoring on the commercial lane),
  // granted to exactly the roles that hold person.manage — manager and admin — and NEVER to staff or
  // supervisor, so the recipe write gate matches the other management-dashboard write gates.
  expect(roleHasPermission("manager", "recipe.manage")).toBe(true);
  expect(roleHasPermission("admin", "recipe.manage")).toBe(true);
  expect(roleHasPermission("staff", "recipe.manage")).toBe(false);
  expect(roleHasPermission("supervisor", "recipe.manage")).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/identity test permissions`. Expected: FAIL — `"recipe.manage"` is not assignable to `Permission` (typecheck) / the `for (const p of PERMISSIONS)` manager+admin rows do not yet include it.

- [ ] **Step 3: Add the permission** — in `packages/identity/src/permissions.ts`, append to `PERMISSIONS` (after `"purchase.manage"`), with a doc comment mirroring the siblings:

```ts
  // Authoring ingredients + a product's recipe (allergen inheritance) from the management dashboard
  // (@waitron/recipes). A domain-named AUTHORING permission on the commercial lane, distinct from staff
  // admin (person.manage); granted to manager + admin, the same roles as the other write gates
  // (recipe-authoring UI, 2026-08-16).
  "recipe.manage",
```

and add `"recipe.manage"` to the `MANAGER` set (after `"purchase.manage"`). `ALL` already covers admin.

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/identity test permissions`. Expected: PASS (new block + the exhaustive `for (const p of PERMISSIONS)` manager/admin rows).

- [ ] **Step 5: Prove the pin by deletion** — temporarily remove `"recipe.manage"` from `MANAGER`; confirm BOTH the new block AND the `for (const p of PERMISSIONS) expect(roleHasPermission("manager", p)).toBe(true)` row FAIL; restore; confirm PASS.

- [ ] **Step 6: Coverage + commit**

```bash
pnpm --filter @waitron/identity test:coverage
git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts
git commit -s -m "feat(identity): recipe.manage permission for recipe authoring"
```

---

## Task 2: Expose `manual_allergens` on the product read (`@waitron/catalogue`)

**Files:**
- Modify: `packages/catalogue/src/operations.ts`
- Test: `packages/catalogue/src/operations.test.ts` (add a case)

**Interfaces:**
- Produces: `Product.manualAllergens: ProductAllergens | null` returned by `createProduct`/`updateProduct`/`listProducts`.

- [ ] **Step 1: Write the failing test** — add to `operations.test.ts` (imports `applyRecipeDerivation`, `listProducts`, `createProduct`, `createCatalogue`, `withTenant`, `asAppUser` already used in the file):

```ts
it("exposes manual_allergens distinctly from the published union", async () => {
  const seen = await withTenant(fx.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "C" });
    const p = await createProduct(tx, {
      catalogueId: cat.id, categoryId: null, descriptions: { en: "sandwich" },
      pricingUnit: "each", unitPrice: "3.00", vatClass: "general",
      allergens: { gluten: { presence: "contains" } }, // → manual_allergens
    });
    // A recipe contributes a derived floor of eggs; published becomes eggs ∪ gluten.
    await applyRecipeDerivation(tx, p.id, { allergens: { eggs: { presence: "contains" } }, pending: false });
    const [row] = await listProducts(tx, cat.id);
    return row!;
  });
  expect(seen.allergens).toEqual({ eggs: { presence: "contains" }, gluten: { presence: "contains" } });
  expect(seen.manualAllergens).toEqual({ gluten: { presence: "contains" } });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/catalogue test operations`. Expected: FAIL — `manualAllergens` is not on `Product` / is `undefined` in the row.

- [ ] **Step 3: Implement** — in `packages/catalogue/src/operations.ts`:
  1. Add to `PRODUCT_COLUMNS`: `manualAllergens: products.manualAllergens,`
  2. Add to the `Product` interface (beside `allergens`): `manualAllergens: ProductAllergens | null;`
  3. Add to `RawProduct` (beside `allergens`): `manualAllergens: ProductAllergens | null;`
  4. `toProduct` spreads `...row`, so `manualAllergens` passes through with no extra line — confirm the spread already carries it.

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/catalogue test operations`. Expected: PASS.

- [ ] **Step 5: Prove by deletion** — remove the `manualAllergens: products.manualAllergens` line from `PRODUCT_COLUMNS`; confirm the new test FAILS (`manualAllergens` reads `undefined`); restore; confirm PASS.

- [ ] **Step 6: Coverage + commit**

```bash
pnpm --filter @waitron/catalogue test:coverage
git add packages/catalogue/src/operations.ts packages/catalogue/src/operations.test.ts
git commit -s -m "feat(catalogue): expose manual_allergens on the product read (recipe UI)"
```

---

## Task 3: Reseed the product allergen picker from `manual_allergens` (the critical fix)

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (add `manualAllergens` to the wire `Product`)
- Modify: `apps/dashboard/src/widgets/product-form.ts` (seed from `manualAllergens`)
- Test: `apps/dashboard/src/widgets/product-form.test.ts` (add a case)

**Interfaces:**
- Consumes: `Product.manualAllergens` (now on the wire shape).
- Produces: the picker seeds from the manual overlay; a save writes the manual overlay back (no double-count).

- [ ] **Step 1: Add `manualAllergens` to the wire `Product`** — in `apps/dashboard/src/api/client.ts`, in the local `Product` interface add (beside `allergens: AllergenDeclaration`):

```ts
  /** The staff-authored allergen overlay — what a human explicitly declared, SEPARATE from the published
   * `allergens` (which is the computed union of this overlay and any recipe-derived floor). The product
   * editor seeds its allergen picker from THIS, so recipe-derived allergens are never re-saved as manual. */
  manualAllergens: AllergenDeclaration;
```

- [ ] **Step 2: Write the failing test** — add to `product-form.test.ts` (uses the file's `baseProps`, `mountWidget`, `openedDialog`, `data-test` query helpers):

```ts
it("seeds the allergen picker from manualAllergens, not the published union", async () => {
  // Published `allergens` carries the computed union (manual gluten ∪ derived eggs); the manual overlay is
  // gluten only. The picker MUST show the manual overlay — seeding from the published union would double-count
  // the derived eggs into the manual overlay on the next save.
  const product = {
    id: "11111111-1111-1111-1111-111111111111",
    catalogueId: "c", categoryId: null, descriptions: { es: "bocadillo" },
    pricingUnit: "each" as const, unitPrice: "3.00", vatClass: "general" as const, active: true,
    image: null,
    allergens: { eggs: { presence: "contains" as const }, gluten: { presence: "contains" as const } },
    manualAllergens: { gluten: { presence: "contains" as const } },
  };
  const { el } = await mountWidget("dashboard-product-form", { ...baseProps(), product, open: true });
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector("[data-test=allergens]") as HTMLElement & {
    declaration: unknown;
  };
  expect(picker.declaration).toEqual({ gluten: { presence: "contains" } });
});
```

- [ ] **Step 2b: Run to verify failure** — `pnpm --filter @waitron/dashboard test product-form`. Expected: FAIL — the picker's `declaration` is the published `{eggs,gluten}` (seeded from `p.allergens`).

- [ ] **Step 3: Implement the reseed** — in `apps/dashboard/src/widgets/product-form.ts` `willUpdate`, change the two allergen seed lines:

```ts
    this.allergens = p?.manualAllergens ?? null;
    this.seedAllergens = p?.manualAllergens ?? null;
```

(both — the live emitted value and the picker seed; leaving `allergens` on the published union would re-save the union as manual on an untouched form). Update the doc comment on `willUpdate` to say "seeded from the MANUAL overlay (`manualAllergens`), not the published union".

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/dashboard test product-form`. Expected: PASS.

- [ ] **Step 5: Prove the double-count guard by deletion** — revert the seed to `p?.allergens ?? null`; confirm the new test FAILS (declaration is `{eggs,gluten}`); restore; confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/widgets/product-form.ts apps/dashboard/src/widgets/product-form.test.ts
git commit -s -m "fix(dashboard): seed product allergen picker from manual_allergens (no double-count)"
```

---

## Task 4: `mountRecipeApi` + boot wiring (`apps/server`)

**Files:**
- Create: `apps/server/src/recipe-api.ts`
- Modify: `apps/server/src/boot.ts` (mount it)
- Test: `apps/server/src/recipe-api.test.ts` (PGlite mechanics)

**Interfaces:**
- Consumes: `createIngredient`/`updateIngredient`/`listIngredients`/`getProductRecipe`/`setProductRecipe` (`@waitron/recipes`), `authorizeManager`, `Permission` (`@waitron/identity`), `withTenant`/`asAppUser`/`Database`/`Transaction` (`@waitron/db`), `createErrorBoundary` + `requireManagementSession` + `requireUuidParam` (server), `AppError` (`@waitron/shared`).
- Produces: `mountRecipeApi(app: Hono, deps: { db: Database; cfg: { tenantId: string } }, log: Logger): void`.

- [ ] **Step 1: Write the failing test** — `apps/server/src/recipe-api.test.ts`, modelled on `catalogue-api.test.ts` (reuse its `send`/`mountApp` helpers, `usePgliteDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS], setup })`, and `setup` seeding a `manager` + `staff` session with cookies). Cover:

```ts
// happy path: create + list an ingredient, then set + get a product's recipe
it("creates and lists an ingredient under a manager session", async () => {
  const app = mountApp();
  const created = await send(app, "POST", "/management-api/ingredients", {
    body: { name: "alioli", allergens: { eggs: { presence: "contains" } } }, cookie: managerCookie,
  });
  expect(created.status).toBe(201);
  const list = await send(app, "GET", "/management-api/ingredients", { cookie: managerCookie });
  expect(list.status).toBe(200);
  expect((await list.json()).map((i: { name: string }) => i.name)).toEqual(["alioli"]);
});

it("sets and gets a product's recipe", async () => {
  const app = mountApp();
  const ing = await (await send(app, "POST", "/management-api/ingredients",
    { body: { name: "bread", allergens: { gluten: { presence: "contains" } } }, cookie: managerCookie })).json();
  const put = await send(app, "PUT", `/management-api/products/${productId}/recipe`,
    { body: { ingredientIds: [ing.id] }, cookie: managerCookie });
  expect(put.status).toBe(204);
  const got = await send(app, "GET", `/management-api/products/${productId}/recipe`, { cookie: managerCookie });
  expect((await got.json()).map((i: { name: string }) => i.name)).toEqual(["bread"]);
});

it("rejects a missing ingredient name with 400 management.request_invalid { field }", async () => {
  const res = await send(mountApp(), "POST", "/management-api/ingredients", { body: {}, cookie: managerCookie });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: { code: "management.request_invalid", params: { field: "name" } } });
});

it("rejects an absent session with 401 and a staff session with 403", async () => {
  const app = mountApp();
  const noCookie = await send(app, "GET", "/management-api/ingredients", {});
  expect(noCookie.status).toBe(401);
  const staff = await send(app, "GET", "/management-api/ingredients", { cookie: staffCookie });
  expect(staff.status).toBe(403);
  expect((await staff.json()).error.code).toBe("authorization.not_permitted");
});
```

(`mountApp()` = `const app = new Hono(); mountRecipeApi(app, { db: fx.db, cfg: { tenantId } }, noopLog); return app;`. `productId` seeded in `setup` via catalogue `createProduct`.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/server test recipe-api`. Expected: FAIL — `recipe-api.js` / `mountRecipeApi` missing.

- [ ] **Step 3: Implement `recipe-api.ts`** (model on `purchasing-api.ts`):

```ts
import type { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import {
  createIngredient, updateIngredient, listIngredients,
  getProductRecipe, setProductRecipe,
} from "@waitron/recipes";
import { authorizeManager, type Permission } from "@waitron/identity";
import type { ProductAllergens } from "@waitron/catalogue";
import { createErrorBoundary } from "./error-boundary.js";
import { requireManagementSession } from "./management-session.js";
import { requireUuidParam } from "./request-screens.js";
import type { Logger } from "./log.js"; // match the type purchasing-api.ts imports
import "./errors.js"; // management.request_invalid / server.internal registry

const RECIPE_WRITE_PERMISSION: Permission = "recipe.manage";

const STATUS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "allergen.invalid_code": 400,
  "allergen.invalid_presence": 400,
  "allergen.invalid_source": 400,
} as const;

export interface RecipeApiDeps {
  db: Database;
  cfg: { tenantId: string };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function mountRecipeApi(app: Hono, deps: RecipeApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "recipe.failed");
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission: RECIPE_WRITE_PERMISSION });
      return fn(tx);
    });

  app.get("/management-api/ingredients", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listIngredients(tx));
      return c.json(rows);
    }),
  );

  app.post("/management-api/ingredients", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = (await c.req.json<{ name?: unknown; allergens?: unknown }>()) ?? {};
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const input = {
        name: body.name,
        ...(body.allergens === undefined ? {} : { allergens: body.allergens as ProductAllergens }),
      };
      const created = await gated(sessionId, (tx) => createIngredient(tx, input));
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/ingredients/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "IngredientId");
      const body = (await c.req.json<{ name?: unknown; allergens?: unknown; active?: unknown }>()) ?? {};
      const patch: { name?: string; allergens?: ProductAllergens | null; active?: boolean } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string") throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      // `allergens` present (including literal null → clear to PENDING) is passed straight to updateIngredient,
      // which validates a non-null map via validateAllergens (the allergen.* authority).
      if (body.allergens !== undefined) {
        if (body.allergens !== null && !isPlainObject(body.allergens)) {
          throw new AppError("management.request_invalid", { field: "allergens" });
        }
        patch.allergens = body.allergens as ProductAllergens | null;
      }
      await gated(sessionId, (tx) => updateIngredient(tx, id, patch));
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/products/:id/recipe", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      const rows = await gated(sessionId, (tx) => getProductRecipe(tx, productId));
      return c.json(rows);
    }),
  );

  app.put("/management-api/products/:id/recipe", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      const body = (await c.req.json<{ ingredientIds?: unknown }>()) ?? {};
      if (!Array.isArray(body.ingredientIds) || !body.ingredientIds.every((x) => typeof x === "string")) {
        throw new AppError("management.request_invalid", { field: "ingredientIds" });
      }
      const ingredientIds = body.ingredientIds as string[];
      await gated(sessionId, (tx) => setProductRecipe(tx, productId, ingredientIds));
      return c.body(null, 204);
    }),
  );
}
```

(Confirm the exact `Logger`/`log` import path and `requireUuidParam` signature against `purchasing-api.ts`; match them verbatim.)

- [ ] **Step 4: Wire into `boot.ts`** — beside `mountPurchasingApi(app, { db, cfg: { tenantId: till.tenantId } }, log);` add:

```ts
mountRecipeApi(app, { db, cfg: { tenantId: till.tenantId } }, log);
```

and the import `import { mountRecipeApi } from "./recipe-api.js";`.

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @waitron/server test recipe-api`. Expected: PASS. Then `pnpm --filter @waitron/server typecheck`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/recipe-api.ts apps/server/src/boot.ts apps/server/src/recipe-api.test.ts
git commit -s -m "feat(server): management-api for ingredient + product-recipe authoring (recipe.manage)"
```

---

## Task 5: recipe-api real-Postgres RLS + gate-by-deletion

**Files:**
- Test: `apps/server/src/recipe-api.rls.test.ts`

- [ ] **Step 1: Write the test** — model on `apps/server/src/purchasing-api.rls.test.ts` (`useRealPostgres({ start: startRealPostgres })`, provision a full venue per tenant via `@waitron/provisioning`'s `applyVenue(planVenue(...))`, one Hono `mountRecipeApi` app per tenant, sessions minted per tenant). Assert:
  1. **Cross-tenant isolation** — tenant A creates an ingredient; tenant B's manager session `GET /management-api/ingredients` returns `[]`.
  2. **Gate by deletion** — a `staff` session on tenant A gets 403 `authorization.not_permitted`; a `manager` gets 200. Record in the commit message that removing `authorizeManager` from `gated` turns the staff assertion green→red (the by-deletion proof).

- [ ] **Step 2: Run (Docker required)** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test recipe-api.rls`. Expected: PASS. (Ryuk disabled per CLAUDE.md §4.)

- [ ] **Step 3: Prove the gate by deletion** — temporarily delete the `await authorizeManager(...)` line in `recipe-api.ts`'s `gated`; confirm the staff-403 assertion FAILS (staff now gets 200); restore; confirm PASS. Note the result in the commit body.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/recipe-api.rls.test.ts
git commit -s -m "test(server): recipe-api cross-tenant isolation + recipe.manage gate by deletion"
```

---

## Task 6: Dashboard API client — recipe methods + local types

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`
- Test: `apps/dashboard/src/api/client.test.ts` (add cases)

**Interfaces:**
- Produces (browser-local, hand-written — NO `@waitron/recipes` import):

```ts
export interface Ingredient {
  id: string;
  name: string;
  allergens: AllergenDeclaration; // reuse the existing local type; null = PENDING
  active: boolean;
}
export interface IngredientInput { name: string; allergens?: Record<string, AllergenEntry>; }
export interface IngredientPatch { name?: string; allergens?: AllergenDeclaration; active?: boolean; }
export interface RecipeLine { id: string; name: string; allergens: AllergenDeclaration; active: boolean; }
```

and methods:
```ts
listIngredients(): Promise<Ingredient[]>
createIngredient(input: IngredientInput): Promise<Ingredient>
updateIngredient(id: string, patch: IngredientPatch): Promise<void>
getProductRecipe(productId: string): Promise<RecipeLine[]>
setProductRecipe(productId: string, ingredientIds: string[]): Promise<void>
```

- [ ] **Step 1: Write the failing test** — add to `client.test.ts` (uses its `stubFetch`/`new DashboardApi(baseUrl, stubFetch)` pattern). Assert method → path/verb/body, e.g.:

```ts
it("createIngredient POSTs /management-api/ingredients", async () => {
  const { api, calls } = stub({ json: { id: "i1", name: "alioli", allergens: null, active: true } });
  const out = await api.createIngredient({ name: "alioli" });
  expect(calls[0]).toMatchObject({ path: "/management-api/ingredients", method: "POST" });
  expect(out.name).toBe("alioli");
});

it("setProductRecipe PUTs /management-api/products/:id/recipe with ingredientIds", async () => {
  const { api, calls } = stub({ status: 204 });
  await api.setProductRecipe("p1", ["i1", "i2"]);
  expect(calls[0]).toMatchObject({ path: "/management-api/products/p1/recipe", method: "PUT" });
  expect(JSON.parse(calls[0].body)).toEqual({ ingredientIds: ["i1", "i2"] });
});
```
(Match the file's existing stub/assertion helper shape — read `client.test.ts` first and mirror it.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/dashboard test client`. Expected: FAIL — methods missing.

- [ ] **Step 3: Implement** — add the interfaces (in the catalogue/recipe local-types block, with the "LOCAL copies … NOT imported from @waitron/recipes" comment) and the five thin methods on `DashboardApi`, each a one-line `#request<T>(path, method, body?)` mirroring `createProduct`/`updateProduct`/`listProducts`.

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/dashboard test client`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/api/client.test.ts
git commit -s -m "feat(dashboard): DashboardApi ingredient + product-recipe methods"
```

---

## Task 7: Ingredient widgets (`ingredient-list`, `ingredient-form`)

**Files:**
- Create: `apps/dashboard/src/widgets/ingredient-list.ts` + `.test.ts` + `.a11y.test.ts`
- Create: `apps/dashboard/src/widgets/ingredient-form.ts` + `.test.ts` + `.a11y.test.ts`

**Interfaces:**
- `ingredient-list`: `@property ingredients: Ingredient[] = []`; emits `edit-ingredient { id }` (bubbling+composed).
- `ingredient-form`: `@property open/busy/ingredient`; emits `create-ingredient` (`IngredientInput`) / `update-ingredient { id, patch }` (`IngredientPatch`) / `wt-close`; exports `CreateIngredientDetail`/`UpdateIngredientDetail`.

- [ ] **Step 1: `ingredient-list.ts`** — model on `product-list.ts` (pure display). One `wt-card` per ingredient (`data-test="row"`), name + `allergenStateName(...)` badge (reuse `domain.ts`), raw state in a `data-state`, an "edit" `wt-button` emitting `edit-ingredient { id }`. Close with the `declare global { HTMLElementTagNameMap }` block.

- [ ] **Step 2: `ingredient-list.test.ts`** — mount with two ingredients (one PENDING `allergens: null`, one `{eggs}`); assert two `[data-test=row]`; click edit on row 1 → `nextEvent(el, "edit-ingredient")` carries `{ id }`. Run `pnpm --filter @waitron/dashboard test ingredient-list` (fail → implement → pass).

- [ ] **Step 3: `ingredient-form.ts`** — model on `product-form.ts` minus catalogue/price fields. `willUpdate` reseeds `name`/`active`/`seedAllergens`+`allergens` from `ingredient` on change/open; `seedAllergens = ing?.allergens ?? null` (ingredients have a single allergen field — seed from `allergens` directly, no manual/published split). Reuse `<dashboard-allergen-picker>`. `#confirm`: single-flight `busy` guard; require a non-empty `name` (client-side, `role="alert"` + `codeMessage("ingredient.name_required")`); on CREATE **omit** `allergens` when the picker value is `null` (PENDING), send the map otherwise; on UPDATE emit `{ id, patch: { name, active, allergens } }` (allergens null included, legal to clear). Exports `CreateIngredientDetail` (`= IngredientInput`) and `UpdateIngredientDetail` (`{ id; patch: IngredientPatch }`).

- [ ] **Step 4: `ingredient-form.test.ts`** — model on `product-form.test.ts` (`baseProps`, `openedDialog`, `setInput`, `click`, `nextEvent`). Cases:
  - create with a name + a reviewed picker → `create-ingredient` carries `{ name, allergens }`.
  - create with PENDING picker → `create-ingredient` OMITS `allergens`.
  - empty name → no event, `[data-test=error]` shown.
  - edit → `update-ingredient { id, patch }` carrying name+active+allergens (null when PENDING).
  Run `pnpm --filter @waitron/dashboard test ingredient-form` (fail → implement → pass). Prove the omit-on-PENDING by deletion: force `allergens` always sent, confirm the PENDING case FAILS, restore.

- [ ] **Step 5: a11y tests** — `ingredient-list.a11y.test.ts` + `ingredient-form.a11y.test.ts`, `describe.each(["light","dark"])`, `mountWidget` into the richest state (form open, picker "Revisado" on), `expectNoA11yViolations(host)`. Run `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/dashboard test ingredient` (browser tests need no Docker; the env var is harmless).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/widgets/ingredient-list.ts apps/dashboard/src/widgets/ingredient-list.test.ts apps/dashboard/src/widgets/ingredient-list.a11y.test.ts apps/dashboard/src/widgets/ingredient-form.ts apps/dashboard/src/widgets/ingredient-form.test.ts apps/dashboard/src/widgets/ingredient-form.a11y.test.ts
git commit -s -m "feat(dashboard): ingredient list + form widgets"
```

---

## Task 8: `recipe-editor` widget (product-recipe composition)

**Files:**
- Create: `apps/dashboard/src/widgets/recipe-editor.ts` + `.test.ts` + `.a11y.test.ts`

**Interfaces:**
- `@property product: Product | null`, `@property ingredients: Ingredient[] = []` (all available), `@property recipe: RecipeLine[] = []` (the product's current lines), `@property busy`.
- Emits `save-recipe { productId, ingredientIds }` (bubbling+composed) on confirm; `wt-close` on cancel. Exports `SaveRecipeDetail`.

- [ ] **Step 1: Write the failing test** — `recipe-editor.test.ts`: mount with 3 ingredients and a `recipe` containing ingredient #1; assert #1's toggle is checked; toggle #2 on; click confirm → `save-recipe` carries `{ productId, ingredientIds: ["<id1>","<id2>"] }`. A second case: uncheck all → confirm emits `ingredientIds: []`.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/dashboard test recipe-editor`. Expected: FAIL.

- [ ] **Step 3: Implement** — a `LitElement` (a `wt-card` or `wt-dialog`; a card section on the screen is simplest). `@state() private checked = new Set<string>()`. `willUpdate` reseeds `checked` from `recipe` on `product`/`recipe` change: `this.checked = new Set(this.recipe.map((l) => l.id))`. Render one `<wt-switch data-test="ing-${i.id}" .checked=${this.checked.has(i.id)}>` per ingredient with a handler that mutates a copy of the set (immutable update → reassign so Lit re-renders). `#confirm(e)`: `stopPropagation`; single-flight `busy`; `dispatchEvent(new CustomEvent<SaveRecipeDetail>("save-recipe", { detail: { productId: this.product!.id, ingredientIds: [...this.checked] }, bubbles: true, composed: true }))`. Guard `product === null` (render nothing / a prompt). Close with the tag-map block.

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @waitron/dashboard test recipe-editor`. Expected: PASS.

- [ ] **Step 5: a11y** — `recipe-editor.a11y.test.ts`, both themes, mounted with a product + ingredients + a partial recipe, `expectNoA11yViolations`.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/widgets/recipe-editor.ts apps/dashboard/src/widgets/recipe-editor.test.ts apps/dashboard/src/widgets/recipe-editor.a11y.test.ts
git commit -s -m "feat(dashboard): product-recipe composition editor widget"
```

---

## Task 9: `recipe-screen` + shell wiring + i18n

**Files:**
- Create: `apps/dashboard/src/screens/recipe-screen.ts` + `.test.ts` + `.a11y.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` (Screen union, side-effect import, nav button, switch case)
- Modify: `apps/dashboard/src/dashboard-app.a11y.test.ts` (recipe nav block + `stubApi` stubs)
- Modify: `apps/dashboard/src/i18n/strings.ts` (recipe/ingredient keys, en + es), `apps/dashboard/src/i18n/codes.ts` (any client-validation codes)

**Interfaces:**
- Consumes: `DashboardApi` (`listIngredients`/`createIngredient`/`updateIngredient`/`listCatalogues`/`listProducts`(catalogue)/`getProductRecipe`/`setProductRecipe`).

- [ ] **Step 1: i18n keys** — add to `strings.ts` (BOTH `en` and `es`; the compiler enforces pairing): `recipe.title`, `recipe.ingredients_heading`, `recipe.products_heading`, `recipe.new_ingredient`, `ingredient.name`, `ingredient.name_required`, `ingredient.active`, `recipe.save`, `recipe.select_catalogue`, `recipe.select_product`, `nav.recipe`, plus any error/validation strings. Add `ingredient.name_required` to `codes.ts` (both locale columns) if surfaced via `codeMessage`.

- [ ] **Step 2: Write the failing screen test** — `recipe-screen.test.ts`: mount `<dashboard-recipe-screen .api=${stub}>` with a `vi.fn()` stub returning a couple of ingredients + a catalogue + products; assert on-connect calls fire; opening the ingredient form + confirming calls `api.createIngredient` then reloads; choosing a product + saving the editor calls `api.setProductRecipe`. Model on `catalogue-screen.test.ts` / `purchases-screen.test.ts`.

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @waitron/dashboard test recipe-screen`. Expected: FAIL — screen missing.

- [ ] **Step 4: Implement `recipe-screen.ts`** — model on `purchases-screen.ts`. `@customElement("dashboard-recipe-screen")`, one `<h1>` = `t("recipe.title")`, `@property api`, `@state()` for `ingredients`, `catalogues`, `selectedCatalogueId`, `products`, `selectedProductId`, `recipe`, `formOpen`, `editingIngredient`, `busy`, `errorKey`. `connectedCallback` → `#load()` (`listIngredients` + `listCatalogues`). Side-effect-import the three widgets. Wire: `ingredient-list @edit-ingredient` → open form with the target; `ingredient-form @create-ingredient/@update-ingredient` → single-flight call + reload + close; catalogue `<select>` → load that catalogue's products; product `<select>` → `getProductRecipe`; `recipe-editor @save-recipe` → `setProductRecipe` + reload the recipe. Error at the render edge (`role="alert"` + `codeMessage`). Close with the tag-map block.

- [ ] **Step 5: Wire the shell** — in `dashboard-app.ts`: add `"recipe"` to the `Screen` union; `import "./screens/recipe-screen.js";`; a nav `wt-button` (`data-test="nav-recipe"`, `variant=${this.screen === "recipe" ? "primary" : "secondary"}`, label `t("nav.recipe")`, `@click=${() => (this.screen = "recipe")}`) beside the catalogue/purchases buttons; a `case "recipe": return html\`<dashboard-recipe-screen .api=${this.api}></dashboard-recipe-screen>\`;` in `#renderScreen()`.

- [ ] **Step 6: Shell a11y** — in `dashboard-app.a11y.test.ts`, add recipe stubs to `stubApi` (`listIngredients: async () => []`, `listCatalogues: async () => []`) and a block: click `[data-test=nav-recipe]`, assert exactly one `<h1>` across the composed tree, axe-scan. `recipe-screen.a11y.test.ts`: mount the screen with a populated stub, both themes, scan.

- [ ] **Step 7: Run to verify pass** — `pnpm --filter @waitron/dashboard test recipe` and `pnpm --filter @waitron/dashboard test dashboard-app`. Expected: PASS.

- [ ] **Step 8: Coverage + commit**

```bash
pnpm --filter @waitron/dashboard test:coverage   # 95/95/90/88
git add apps/dashboard/src/screens/recipe-screen.ts apps/dashboard/src/screens/recipe-screen.test.ts apps/dashboard/src/screens/recipe-screen.a11y.test.ts apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.a11y.test.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/codes.ts
git commit -s -m "feat(dashboard): recipe screen (ingredients + product recipes) + shell wiring"
```

---

## Final gate (before finish-branch)

- [ ] `pnpm install` (no new dep expected; lockfile unchanged) then `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] `pnpm --filter @waitron/dashboard test:coverage` (95/95/90/88), `pnpm --filter @waitron/server test:coverage`, `pnpm --filter @waitron/catalogue test:coverage`, `pnpm --filter @waitron/identity test:coverage` (98/98/98/95) — all green.
- [ ] Whole-workspace run once (the permission pin lives in `@waitron/identity`, invisible to a dashboard-scoped run): `TESTCONTAINERS_RYUK_DISABLED=true pnpm test`.
- [ ] Confirm no `packages/verifactu` / `packages/fiscal*` source changed and no fiscal table/hash/invoice path touched — the H2 boundary. If any was, leave the PR `needs-owner-review` and do NOT land.
- [ ] Owner-review check: if review contests the `recipe.manage` name or the manager-only gate (spec §6), leave `needs-owner-review` rather than landing on a guess.
- [ ] Hand off to the `finish-branch` skill (simplify → whole-branch review → fix wave → Copilot).

## Self-review notes (spec coverage)

- Spec D1 (permission) → Task 1; D2/D3 (recipe-api) → Tasks 4–5; D4 (manual read) → Task 2; D5 (reseed fix) → Task 3; D6 (screen/widgets) → Tasks 7–9; D7 (local types) → Task 6; D8 (no migration/no english-only churn) → nothing to do (confirmed in spec).
- Spec §5 H2 → Final gate boundary check.
- Spec §6 owner-review → Final gate + the `recipe.manage` deletion-proof (Task 1 Step 5) and gate-by-deletion (Task 5 Step 3).
- Spec §7 testing → Tasks 1–9 (permission pin, catalogue read, api mechanics + RLS, widget behaviour + reseed proof, a11y both themes).
- Spec §8 deferred → not built (nesting UI, quantities, `*.not_found`, shared allergen const).
