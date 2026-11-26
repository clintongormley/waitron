import {
  updateMenuItem,
  listMenuVariants,
  setMenuVariants,
  setMenuVariantPrice,
} from "@waitron/menu";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import { type MenuVariant, AppError } from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run, runVariant } from "./menu-api-errors.js";
import { isPlainObject, requireUuidParam, refuseInvalidPrice } from "./menu-request-fields.js";

function parseMenuVariants(value: unknown): MenuVariant[] {
  if (!Array.isArray(value)) {
    throw new AppError("management.request_invalid", { field: "variants" });
  }
  return value.map((entry, index) => {
    if (
      !isPlainObject(entry) ||
      typeof entry.variantId !== "string" ||
      (entry.price !== null && typeof entry.price !== "string") ||
      Object.hasOwn(entry, "offered")
    ) {
      throw new AppError("management.request_invalid", { field: `variants.${index}` });
    }
    return {
      variantId: requireUuidParam(entry.variantId, "ProductVariantId"),
      price: entry.price,
    };
  });
}

export function mountMenuItemPriceRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  app.patch("/management-api/menus/:id/items/:itemId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (body.grossPrice !== undefined && body.grossPrice !== null) {
        if (typeof body.grossPrice !== "string") {
          throw new AppError("management.request_invalid", { field: "grossPrice" });
        }
        refuseInvalidPrice(body.grossPrice, "grossPrice");
      }
      for (const retired of ["active", "offered"]) {
        if (Object.hasOwn(body, retired)) {
          throw new AppError("management.request_invalid", { field: retired });
        }
      }
      await gated(c, sessionId, (tx) =>
        updateMenuItem(tx, menuId, menuItemId, {
          ...(body.grossPrice === undefined
            ? {}
            : { grossPrice: body.grossPrice as string | null }),
        }),
      );
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/menus/:id/items/:itemId/variants", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      return c.json(await gated(c, sessionId, (tx) => listMenuVariants(tx, menuItemId, menuId)));
    }),
  );

  app.put("/management-api/menus/:id/items/:itemId/variants", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const variants = parseMenuVariants(body.variants);
      return c.json(
        await gated(c, sessionId, (tx) => setMenuVariants(tx, menuItemId, variants, menuId)),
      );
    }),
  );

  app.patch("/management-api/menus/:id/items/:itemId/variants/:variantId", (c) =>
    runVariant(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      const variantId = requireUuidParam(c.req.param("variantId"), "ProductVariantId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const extra = Object.keys(body).find((key) => key !== "price");
      if (extra !== undefined) throw new AppError("management.request_invalid", { field: extra });
      if (!Object.hasOwn(body, "price") || (body.price !== null && typeof body.price !== "string"))
        throw new AppError("management.request_invalid", { field: "price" });
      const price = body.price as string | null;
      await gated(c, sessionId, (tx) =>
        setMenuVariantPrice(tx, menuItemId, variantId, price, menuId),
      );
      return c.body(null, 204);
    }),
  );
}
