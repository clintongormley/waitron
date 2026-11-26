import { updateMenuItem } from "@waitron/menu";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run } from "./menu-api-errors.js";
import { requireUuidParam, refuseInvalidPrice } from "./menu-request-fields.js";

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
}
