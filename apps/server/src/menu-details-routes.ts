import "@waitron/menu/src/errors.js";
import type { Transaction } from "@waitron/db";
import {
  refuseSetMenu,
  menuStatus,
  readMenuStructure,
  menuPrices,
  previewMenu,
} from "@waitron/menu";
import { type Logger, requireManagementSession } from "@waitron/server-kit";
import { AppError, normaliseUuid } from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run } from "./menu-api-errors.js";
import { requireUuidParam } from "./menu-request-fields.js";

export async function readMenuStatus(tx: Transaction, menuId: string) {
  await refuseSetMenu(tx, menuId);
  const status = (await menuStatus(tx, [menuId])).get(menuId);
  if (status === undefined) throw new AppError("menu.not_found", { menuId });
  return status;
}

export function mountMenuDetailRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  app.get("/management-api/menus/:id/structure", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = normaliseUuid(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => readMenuStructure(tx, menuId)));
    }),
  );

  app.get("/management-api/menus/:id/prices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => menuPrices(tx, menuId)));
    }),
  );

  app.get("/management-api/menus/:id/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => readMenuStatus(tx, menuId)));
    }),
  );

  app.get("/management-api/menus/:id/preview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => previewMenu(tx, menuId)));
    }),
  );
}
