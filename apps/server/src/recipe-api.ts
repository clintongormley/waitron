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
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import {
  createIngredient,
  updateIngredient,
  listIngredients,
  getProductRecipe,
  setProductRecipe,
} from "@waitron/recipes";
import type { ProductAllergens } from "@waitron/catalogue";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { requireManagementSession } from "./management-session.js";
import { requireUuidParam } from "./request-screens.js";
import type { Logger } from "./logger.js";

/**
 * Everything the dashboard's recipe-authoring routes need: `db` + this venue's own `cfg.tenantId`
 * scope every `withTenant` below, so RLS confines each read/write to this server's one tenant. No
 * `nodeId` (unlike `CatalogueApiDeps`): the ingredient/recipe tables carry no sync-capture trigger
 * wiring in this surface, so there is no `sync_log.origin_id` to attribute here. No card provider,
 * clock or media store either — these routes touch only the ingredient + recipe tables via the
 * headless `@waitron/recipes` ops.
 */
export interface RecipeApiDeps {
  db: Database;
  cfg: { tenantId: string };
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
 * `validateAllergens` inside `createIngredient`/`updateIngredient` when a supplied map is malformed.
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
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: RECIPE_WRITE_PERMISSION,
      });
      return fn(tx);
    });

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
      // Coerced to `{}` (`?? {}`) so a `null`/non-object body reaches the `name` screen as a 400 rather
      // than TypeErroring into an opaque 500 — the catalogue null-body convention.
      const body = (await c.req.json<{ name?: unknown; allergens?: unknown }>()) ?? {};
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      // `allergens` is left to `createIngredient`'s `validateAllergens`, which throws the authoritative
      // `allergen.*` codes for a wrong shape or unknown code — the same posture `catalogue-api.ts`'s
      // product create takes (it never screens `allergens` in the route either).
      const input = {
        name: body.name,
        ...(body.allergens === undefined ? {} : { allergens: body.allergens as ProductAllergens }),
      };
      const created = await gated(sessionId, (tx) => createIngredient(tx, input));
      return c.json(created, 201);
    }),
  );

  // ── Update ingredient ──────────────────────────────────────────────────────────────────────────
  app.patch("/management-api/ingredients/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "IngredientId");
      const body =
        (await c.req.json<{ name?: unknown; allergens?: unknown; active?: unknown }>()) ?? {};
      const patch: { name?: string; allergens?: ProductAllergens | null; active?: boolean } = {};
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
      const body = (await c.req.json<{ ingredientIds?: unknown }>()) ?? {};
      if (
        !Array.isArray(body.ingredientIds) ||
        !body.ingredientIds.every((x) => typeof x === "string")
      ) {
        throw new AppError("management.request_invalid", { field: "ingredientIds" });
      }
      const ingredientIds = body.ingredientIds as string[];
      await gated(sessionId, (tx) => setProductRecipe(tx, productId, ingredientIds));
      return c.body(null, 204);
    }),
  );
}
