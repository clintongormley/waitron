import {
  readMenuHome,
  setHomeDisplay,
  addShortcut,
  replaceShortcut,
  removeShortcut,
  moveShortcut,
} from "@waitron/menu";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  requireEnum,
} from "@waitron/server-kit";
import { HOME_ORDERS } from "@waitron/shared";
import type { Hono, Context } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run, runBodySection, runBodyRole } from "./menu-api-errors.js";
import { requireUuidParam, memberRef, numberField } from "./menu-request-fields.js";

/** A menu's Device Home Page. A shortcut is a member of the menu's home section, but shortcuts
 * have their own routes: the generic member routes refuse every write into that section. */
export function mountMenuHomeRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  const home = "/management-api/menus/:id/home";
  const shortcuts = `${home}/shortcuts` as const;
  const shortcut = `${shortcuts}/:memberId` as const;
  const menuId = (c: Context) => requireUuidParam(c.req.param("id")!, "MenuId");
  const memberId = (c: Context) => requireUuidParam(c.req.param("memberId")!, "SectionMemberId");

  app.get(home, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      return c.json(await gated(c, session, (tx) => readMenuHome(tx, menu)));
    }),
  );
  app.patch("/management-api/menus/:id/home-display", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const body = await readJsonBody<{ order?: unknown }>(c);
      const order = requireEnum(body.order, "order", HOME_ORDERS);
      await gated(c, session, (tx) => setHomeDisplay(tx, menu, order));
      return c.body(null, 204);
    }),
  );
  app.post(shortcuts, (c) =>
    runBodySection(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const body = await readJsonBody<{ ref?: unknown; position?: unknown }>(c);
      const ref = memberRef(body.ref);
      const position =
        body.position === undefined ? undefined : numberField(body.position, "position");
      return c.json(await gated(c, session, (tx) => addShortcut(tx, menu, ref, position)), 201);
    }),
  );
  app.post(`${shortcut}/replace`, (c) =>
    runBodyRole(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const held = memberId(c);
      const ref = memberRef((await readJsonBody<{ ref?: unknown }>(c)).ref);
      return c.json(await gated(c, session, (tx) => replaceShortcut(tx, menu, held, ref)));
    }),
  );
  app.delete(shortcut, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const held = memberId(c);
      await gated(c, session, (tx) => removeShortcut(tx, menu, held));
      return c.body(null, 204);
    }),
  );
  app.put(`${shortcut}/position`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menu = menuId(c);
      const held = memberId(c);
      const to = numberField((await readJsonBody<{ to?: unknown }>(c)).to, "to");
      return c.json(await gated(c, session, (tx) => moveShortcut(tx, menu, held, to)));
    }),
  );
}
