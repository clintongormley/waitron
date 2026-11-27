import { checkedCustomerMenuAppearance, defaultCustomerMenuStyle } from "@waitron/menu";
import { readRawJsonBody, requireManagementSession, type Logger } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run } from "./menu-api-errors.js";
import { requireUuidParam } from "./menu-request-fields.js";

export function mountMenuCustomerStyleRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  const path = "/management-api/menus/:id/customer-style";
  app.get(path, (c) =>
    run(c, log, async () => {
      c.header("cache-control", "no-store");
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => defaultCustomerMenuStyle(tx, menuId)));
    }),
  );
  app.put(path, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const input = await readRawJsonBody<unknown>(c);
      const appearance = checkedCustomerMenuAppearance(input, (field) => {
        throw new AppError("management.request_invalid", { field });
      });
      return c.json(
        await gated(c, sessionId, (tx) => defaultCustomerMenuStyle(tx, menuId, appearance)),
      );
    }),
  );
}
