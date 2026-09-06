// Side-effect only: loads this host's errors.ts augmentation for `management.request_invalid` — the
// code the body/id screens below throw directly (declared in `./errors.js`), under the "every file
// that throws one of these imports ./errors.js" convention. `shared.invalid_id` (thrown by
// `requireUuidParam`) is declared in `@waitron/shared` and loads via the `AppError` value import; the
// `allergen.*` codes these routes surface are declared in `@waitron/catalogue`'s own errors.ts and
// load transitively through `@waitron/recipes`'s CRUD ops below (which value-import `validateAllergens`)
// — the same transitive-reachability shape `catalogue-api.ts` relies on for its `allergen.*` codes. So
// this one line is all this file needs.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import {
  createIngredient,
  updateIngredient,
  listIngredients,
  getProductRecipe,
  setProductRecipe,
} from "@waitron/recipes";
import type { DietaryOrigin, ProductAllergens } from "@waitron/catalogue";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import { requireBodyUuid, requireUuidParam } from "./request-screens.js";
import type { Logger } from "./logger.js";

/**
 * Everything the dashboard's recipe-authoring routes need: `db` + this venue's own `cfg.tenantId`
 * scope every `withTenant` below, so RLS confines each read/write to this server's one tenant.
 * `cfg.nodeId` is this node's origin id, threaded into every write's `withTenant` exactly as
 * `CatalogueApiDeps` does. The `ingredients`/`recipe_lines` tables themselves carry no sync-capture
 * trigger, but a recipe write UPDATEs `products` — `setProductRecipe` → `recomputeProductDerivations`,
 * which drives BOTH `applyRecipeDerivation` (allergens) and `applyDietDerivation` (diet origins), two
 * separate `products` UPDATEs — and a PATCH's allergen change fans out the same recompute over every
 * product that uses the ingredient — and `products` IS sync-enrolled (`products_capture`,
 * packages/sync/drizzle/0000_sync_outbox.sql:196). Without `nodeId`, that capture would record the
 * all-zero sentinel instead of this node (guarded by `sync-origin.test.ts`). No card provider,
 * clock or media store either — these routes touch only the ingredient + recipe + product tables via
 * the headless `@waitron/recipes` ops.
 */
export interface RecipeApiDeps {
  db: Database;
  cfg: { tenantId: string; nodeId: string };
}

/**
 * The ONE permission that gates every recipe-authoring route — the catalogue §3 seam, one named
 * constant referenced at every route rather than an inline literal, so a future re-mapping is a
 * one-line swap here. Realised as the domain-named `recipe.manage`, which maps to `manager` + `admin`
 * — the dashboard's audience.
 */
const RECIPE_WRITE_PERMISSION: Permission = "recipe.manage";

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to — the recipe parallel of
 * `purchasing-api.ts`'s `STATUS`. CLIENT faults only: a genuine SERVER fault (a driver error) reaches
 * `run` as a NON-AppError and becomes an opaque 500. The `allergen.*` codes are raised by
 * `validateAllergens`, and `diet.invalid_origin` by `validateOrigin`, inside
 * `createIngredient`/`updateIngredient` when a supplied value is malformed.
 * A registered code absent from this table defaults to 400 via `run`.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "allergen.invalid_code": 400,
  "allergen.invalid_presence": 400,
  "allergen.invalid_source": 400,
  "diet.invalid_origin": 400,
};

// The one error boundary every recipe route wraps its handler in — the shared `createErrorBoundary`
// closed over this surface's `STATUS` map and its `recipe.failed` log tag.
const run = createErrorBoundary(STATUS, "recipe.failed");

/**
 * Mounts the dashboard's gated recipe-authoring group on an existing Hono app — `mountPurchasingApi`'s
 * sibling, attached to the SAME app (the `mountCatalogueApi`/`mountPurchasingApi` convention). Every
 * route wraps its handler in `run`, calls `requireManagementSession(c)` (→ 401 before any DB work) and
 * then, inside `withTenant` + `asAppUser`, `authorizeManager(...)` (→ 403) before the headless
 * `@waitron/recipes` op, so RLS scopes each read/write to this server's one tenant and the
 * `recipe.manage` gate runs on every route through one constant.
 */
export function mountRecipeApi(app: Hono, deps: RecipeApiDeps, log: Logger): void {
  // Open a tenant-scoped transaction as the app role, confirm the caller's management session carries
  // RECIPE_WRITE_PERMISSION, then run `fn`. Every route funnels its DB work through here so the gate is
  // applied identically and in exactly one place — the catalogue §3 seam.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(
      deps.db,
      deps.cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: RECIPE_WRITE_PERMISSION,
        });
        return fn(tx);
      },
      { nodeId: deps.cfg.nodeId },
    );

  // ── List ingredients ───────────────────────────────────────────────────────────────────────────
  app.get("/management-api/ingredients", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listIngredients(tx));
      return c.json(rows);
    }),
  );

  // ── Create ingredient ──────────────────────────────────────────────────────────────────────────
  app.post("/management-api/ingredients", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Read via `readJsonBody` so an empty/malformed/`null`/non-object body reaches the `name` screen
      // as a 400 rather than becoming an opaque 500 — the catalogue null-body convention.
      const body = await readJsonBody<{
        name?: unknown;
        allergens?: unknown;
        dietaryOrigin?: unknown;
      }>(c);
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      // `allergens` / `dietaryOrigin` are left to `createIngredient`'s `validateAllergens` /
      // `validateOrigin`, which throw the authoritative `allergen.*` / `diet.invalid_origin` codes for a
      // wrong shape or unknown value — the same posture `catalogue-api.ts`'s product create takes (it
      // never screens these in the route either).
      const input = {
        name: body.name,
        ...(body.allergens === undefined ? {} : { allergens: body.allergens as ProductAllergens }),
        ...(body.dietaryOrigin === undefined
          ? {}
          : { dietaryOrigin: body.dietaryOrigin as DietaryOrigin | null }),
      };
      const created = await gated(sessionId, (tx) =>
        createIngredient(tx, brandTenantId(deps.cfg.tenantId), input),
      );
      return c.json(created, 201);
    }),
  );

  // ── Update ingredient ──────────────────────────────────────────────────────────────────────────
  app.patch("/management-api/ingredients/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "IngredientId");
      const body = await readJsonBody<{
        name?: unknown;
        allergens?: unknown;
        dietaryOrigin?: unknown;
        active?: unknown;
      }>(c);
      const patch: {
        name?: string;
        allergens?: ProductAllergens | null;
        dietaryOrigin?: DietaryOrigin | null;
        active?: boolean;
      } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string") {
          throw new AppError("management.request_invalid", { field: "name" });
        }
        patch.name = body.name;
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") {
          throw new AppError("management.request_invalid", { field: "active" });
        }
        patch.active = body.active;
      }
      // `allergens` present (a map, or a literal `null` → clear to PENDING) is passed straight to
      // `updateIngredient`, which validates a non-null map via `validateAllergens` (the allergen.*
      // authority) — the same posture `catalogue-api.ts`'s product PATCH takes (it never screens
      // `allergens` in the route either).
      if (body.allergens !== undefined) {
        patch.allergens = body.allergens as ProductAllergens | null;
      }
      // `dietaryOrigin` present (a value, or a literal `null` → uncategorise) is passed straight to
      // `updateIngredient`, which validates a non-null value via `validateOrigin` (the
      // `diet.invalid_origin` authority) — the same route posture used for `allergens`.
      if (body.dietaryOrigin !== undefined) {
        patch.dietaryOrigin = body.dietaryOrigin as DietaryOrigin | null;
      }
      await gated(sessionId, (tx) => updateIngredient(tx, id, patch));
      return c.body(null, 204);
    }),
  );

  // ── Get a product's recipe ─────────────────────────────────────────────────────────────────────
  app.get("/management-api/products/:id/recipe", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      const rows = await gated(sessionId, (tx) => getProductRecipe(tx, productId));
      return c.json(rows);
    }),
  );

  // ── Replace a product's recipe ─────────────────────────────────────────────────────────────────
  app.put("/management-api/products/:id/recipe", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      const body = await readJsonBody<{ ingredientIds?: unknown }>(c);
      if (!Array.isArray(body.ingredientIds)) {
        throw new AppError("management.request_invalid", { field: "ingredientIds" });
      }
      // Screen each element as a UUID up front: a well-formed array of arbitrary strings would otherwise
      // reach `recipe_lines.ingredient_id` (a uuid column) as a bound param → 22P02 → an opaque 500.
      // `requireBodyUuid` maps a malformed element to `management.request_invalid { field }` (a valid but
      // nonexistent id is the separate FK case — `recipe.*_not_found` is deferred by the spec §8).
      const ingredientIds = body.ingredientIds.map((x) => requireBodyUuid(x, "ingredientIds"));
      await gated(sessionId, (tx) =>
        setProductRecipe(tx, brandTenantId(deps.cfg.tenantId), productId, ingredientIds),
      );
      return c.body(null, 204);
    }),
  );
}
