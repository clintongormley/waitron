import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  createIngredient,
  updateIngredient,
  listIngredients,
  getProductRecipe,
  setProductRecipe,
} from "@waitron/recipes";
import type { DietaryOrigin, ProductAllergens } from "@waitron/catalogue";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { requireBodyUuid, requireUuidParam } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

/**
 * `cfg.nodeId` is read by NO route in this file. It survives only because the two suites that mount
 * these routes pass it; remove the field and those arguments together.
 */
export interface RecipeApiDeps {
  db: Database;
  cfg: { nodeId: string };
}

/** The one permission that gates every recipe-authoring route. */
const RECIPE_WRITE_PERMISSION: Permission = "recipe.manage";

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
  "product.not_found": 404,
};

const run = createErrorBoundary(STATUS, "recipe.failed");

export function mountRecipeApi(app: Hono, deps: RecipeApiDeps, log: Logger): void {
  // Every route's DB work goes through here, so the gate is applied in exactly one place.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: RECIPE_WRITE_PERMISSION,
      });
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
      const body = await readJsonBody<{
        name?: unknown;
        allergens?: unknown;
        dietaryOrigin?: unknown;
      }>(c);
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      // `allergens` / `dietaryOrigin` are left to `createIngredient`, which throws the authoritative
      // `allergen.*` / `diet.invalid_origin` codes.
      const input = {
        name: body.name,
        ...(body.allergens === undefined ? {} : { allergens: body.allergens as ProductAllergens }),
        ...(body.dietaryOrigin === undefined
          ? {}
          : { dietaryOrigin: body.dietaryOrigin as DietaryOrigin | null }),
      };
      const created = await gated(sessionId, (tx) => createIngredient(tx, input));
      return c.json(created, 201);
    }),
  );

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
      // `allergens` and `dietaryOrigin` go straight to `updateIngredient`, which validates a
      // non-null value; a literal `null` clears it.
      if (body.allergens !== undefined) {
        patch.allergens = body.allergens as ProductAllergens | null;
      }
      if (body.dietaryOrigin !== undefined) {
        patch.dietaryOrigin = body.dietaryOrigin as DietaryOrigin | null;
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
      const body = await readJsonBody<{ ingredientIds?: unknown }>(c);
      if (!Array.isArray(body.ingredientIds)) {
        throw new AppError("management.request_invalid", { field: "ingredientIds" });
      }
      const ingredientIds = body.ingredientIds.map((x) => requireBodyUuid(x, "ingredientIds"));
      await gated(sessionId, (tx) => setProductRecipe(tx, productId, ingredientIds));
      return c.body(null, 204);
    }),
  );
}
