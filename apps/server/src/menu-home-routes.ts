import { readMenuHome, saveMenuHome } from "@waitron/menu";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  requireEnum,
} from "@waitron/server-kit";
import { HOME_ORDERS, type MenuHomeSaveInput } from "@waitron/shared";
import type { Hono, Context } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run, runBodySection } from "./menu-api-errors.js";
import { requireUuidParam, bodyId, object, rows, tileRefOf } from "./menu-request-fields.js";

function draftOf(value: unknown): MenuHomeSaveInput {
  const { order, shortcuts } = object(value, "body");
  return {
    order: requireEnum(order, "order", HOME_ORDERS),
    shortcuts: rows(shortcuts, "shortcuts", (entry, path) => {
      const { memberId, ref } = object(entry, path);
      return { memberId: bodyId(memberId, path + ".memberId"), ref: tileRefOf(ref, path + ".ref") };
    }),
  };
}

/** A menu's Device Home Page. A shortcut is a member of the menu's home section, but shortcuts
 * are saved here because the generic member routes refuse writes into the home section. */
export function mountMenuHomeRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  const home = "/management-api/menus/:id/home";
  const menuId = (c: Context) => requireUuidParam(c.req.param("id")!, "MenuId");

  app.get(home, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      return c.json(await gated(c, session, (tx) => readMenuHome(tx, menu)));
    }),
  );
  app.put(home, (c) =>
    runBodySection(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const draft = draftOf(await readJsonBody<unknown>(c));
      return c.json(await gated(c, session, (tx) => saveMenuHome(tx, menu, draft)));
    }),
  );
}
