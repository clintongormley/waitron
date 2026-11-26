import "@waitron/menu/src/errors.js";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import {
  readDefaultMenuId,
  listMenus,
  readLiveDocuments,
  listDashboardMenus,
  readMenuStructures,
  menuStatus,
  createMenu,
  assertMenuWritable,
  menusDependingOnDelete,
  countOwnedMenuProducts,
  setVenueDefaultMenu,
  deleteMenu,
  duplicateMenu,
  updateMenuDetails,
} from "@waitron/menu";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  requireString,
  requireEnum,
} from "@waitron/server-kit";
import { AppError, type MenuDeleteImpact, isUuid, FALLBACK_LOCALE } from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import type { MenuApiDeps } from "./menu-api-deps.js";
import { run } from "./menu-api-errors.js";
import { sectionInput, requireUuidParam, isPlainObject } from "./menu-request-fields.js";
import { setMenuTerms } from "./menu-set-menu-routes.js";
import { VENUE_SERVICE } from "./modules.js";

async function deleteDefaultChoices(tx: Transaction, menuId: string) {
  if ((await readDefaultMenuId(tx)) !== menuId) return null;
  const alternatives = (await listMenus(tx)).filter(
    (menu) => menu.id !== menuId && menu.active && menu.kind === "menu",
  );
  const live = await readLiveDocuments(
    tx,
    alternatives.map(({ id }) => id),
  );
  return alternatives.filter(({ id }) => live.has(id)).map(({ id, name }) => ({ id, name }));
}

export function mountMenuCollectionRoutes(
  app: Hono,
  deps: MenuApiDeps,
  gated: GatedWork,
  log: Logger,
): void {
  app.get("/management-api/menus", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(c, sessionId, listDashboardMenus);
      return c.json(rows);
    }),
  );

  app.get("/management-api/menus/structures", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(await gated(c, sessionId, (tx) => readMenuStructures(tx)));
    }),
  );

  app.get("/management-api/menus/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const status = await gated(c, sessionId, (tx) => menuStatus(tx));
      return c.json(Object.fromEntries(status));
    }),
  );

  app.post("/management-api/menus", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const name = requireString(body.name, "name");
      if (name.trim() === "") throw new AppError("management.request_invalid", { field: "name" });
      const presentation = sectionInput({ ...body, internalName: name }, true);
      const kind =
        body.kind === undefined ? undefined : requireEnum(body.kind, "kind", ["menu", "set_menu"]);
      if (kind !== "set_menu" && body.setPrice !== undefined)
        throw new AppError("management.request_invalid", { field: "kind" });
      const terms = setMenuTerms(body);
      const created = await gated(c, sessionId, (tx) =>
        createMenu(tx, {
          name,
          names: presentation.names,
          image: presentation.image,
          color: presentation.color,
          kind,
          ...terms,
        }),
      );
      return c.json(created, 201);
    }),
  );

  const deletePeriods = async (tx: Transaction, menuId: string, sessionId: string) => {
    await assertMenuWritable(tx, menuId);
    const periods = await VENUE_SERVICE.readMenuDeletePeriods(tx, menuId);
    if (periods.length > 0)
      await authorizeManager(tx, { managementSessionId: sessionId, permission: "venue.view" });
    return periods;
  };

  app.get("/management-api/menus/:id/delete-impact", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const impact = await gated(c, sessionId, async (tx): Promise<MenuDeleteImpact> => ({
        periods: await deletePeriods(tx, menuId, sessionId),
        defaultChoices: await deleteDefaultChoices(tx, menuId),
        dependants: await menusDependingOnDelete(tx, menuId),
        productCount: await countOwnedMenuProducts(tx, menuId),
      }));
      return c.json(impact);
    }),
  );

  app.post("/management-api/menus/:id/delete", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<{ replacements?: unknown; defaultMenuId?: unknown }>(c);
      if (!isPlainObject(body.replacements))
        throw new AppError("management.request_invalid", { field: "replacements" });
      const replacements = Object.fromEntries(
        Object.entries(body.replacements).map(([periodId, id]) => {
          if (!isUuid(periodId) || typeof id !== "string" || !isUuid(id))
            throw new AppError("management.request_invalid", { field: "replacements" });
          return [periodId, id];
        }),
      );
      const defaultMenuId = body.defaultMenuId;
      if (
        defaultMenuId !== undefined &&
        (typeof defaultMenuId !== "string" || !isUuid(defaultMenuId))
      )
        throw new AppError("management.request_invalid", { field: "defaultMenuId" });
      await gated(c, sessionId, async (tx, personId) => {
        const periods = await deletePeriods(tx, menuId, sessionId);
        if (periods.length > 0)
          await authorizeManager(tx, {
            managementSessionId: sessionId,
            permission: "venue.configure",
          });
        await VENUE_SERVICE.replaceDeletedPeriodMenus(tx, menuId, replacements);
        const choices = await deleteDefaultChoices(tx, menuId);
        if (
          (choices !== null && !choices.some(({ id }) => id === defaultMenuId)) ||
          (choices === null && defaultMenuId !== undefined)
        )
          throw new AppError("menu.delete_default", { menuId });
        if (defaultMenuId !== undefined) await setVenueDefaultMenu(tx, defaultMenuId);
        await deleteMenu(tx, menuId, personId);
      });
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/menus/:id/duplicate", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const name = requireString(body.name, "name");
      if (name.trim() === "") throw new AppError("management.request_invalid", { field: "name" });
      const copy = await gated(c, sessionId, (tx) => duplicateMenu(tx, menuId, name));
      return c.json(copy, 201);
    }),
  );

  app.patch("/management-api/menus/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const presentation = sectionInput({ ...body, internalName: body.name }, false);
      if (presentation.internalName !== undefined && presentation.internalName.trim() === "")
        throw new AppError("management.request_invalid", { field: "name" });
      const terms = setMenuTerms(body);
      await gated(c, sessionId, (tx) =>
        updateMenuDetails(
          tx,
          menuId,
          {
            name: presentation.internalName,
            names: presentation.names,
            image: presentation.image,
            color: presentation.color,
            ...terms,
          },
          deps.venueLocale ?? FALLBACK_LOCALE,
        ),
      );
      return c.body(null, 204);
    }),
  );
}
