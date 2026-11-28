import {
  checkedCustomerMenuAppearance,
  readCustomerMenuStyles,
  writeCustomerMenuStyle,
} from "@waitron/menu";
import { readRawJsonBody, requireManagementSession, type Logger } from "@waitron/server-kit";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run } from "./menu-api-errors.js";
import { bodyId, invalid, object, requireUuidParam } from "./menu-request-fields.js";

export function mountMenuCustomerStyleRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  const path = "/management-api/menus/:id/customer-style";
  app.get(path, (c) =>
    run(c, log, async () => {
      c.header("cache-control", "no-store");
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => readCustomerMenuStyles(tx, menuId)));
    }),
  );
  app.on(["PUT", "POST"], path, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const input = object(await readRawJsonBody<unknown>(c), "body");
      const styleId = bodyId(input.styleId, "styleId");
      const appearance = checkedCustomerMenuAppearance(input.appearance, invalid);
      const copy = c.req.method === "POST";
      const name = copy
        ? typeof input.name === "string"
          ? input.name
          : invalid("name")
        : undefined;
      const style = await gated(c, sessionId, (tx) =>
        writeCustomerMenuStyle(tx, menuId, styleId, appearance, name),
      );
      return c.json(style, copy ? 201 : 200);
    }),
  );
}
