import { mountMenuStructureSaveRoute } from "./menu-structure-save-route.js";
import { mountContentTranslationsApi, type GatedWork } from "./content-translations-api.js";
import "./errors.js";
import type { Context, Hono } from "hono";
import { AppError, FALLBACK_LOCALE } from "@waitron/shared";
import { withTransaction, type Transaction } from "@waitron/db";
import {
  menusHolding,
  readMenuSettings,
  readVenueVatRates,
  dineInVatRateToday,
  saveMenuDefaultColor,
  type MenuDefaults,
  readMenuHome,
  menuPrices,
  previewMenu,
  readMenuStructure,
  listOptionLists,
  getOptionList,
  createOptionList,
  updateOptionList,
  deleteOptionList,
  optionListDependants,
  listExtraLists,
  getExtraList,
  createExtraList,
  updateExtraList,
  deleteExtraList,
  extraListDependants,
  setVenueDefaultMenu,
  readProductEditor,
  type ProductEditorValue,
  type ProductRouting,
} from "@waitron/menu";
import { authorizeManager, type Permission } from "@waitron/identity";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import { VENUE_SERVICE } from "./modules.js";
import { setProductCourse } from "./kitchen.js";

import type { Logger } from "./logger.js";
import { type MenuApiDeps, translationContextFor } from "./menu-api-deps.js";
import { run, runStructureSave, runBodyMenu } from "./menu-api-errors.js";
import { requireUuidParam, idList } from "./menu-request-fields.js";
import { mountListSurface } from "./menu-list-routes.js";
import { mountSectionRoutes } from "./menu-sections-routes.js";
import { mountMenuHomeRoutes } from "./menu-home-routes.js";
import { mountSetMenuRoutes } from "./menu-set-menu-routes.js";
import { mountMenuLanguageRoutes } from "./menu-languages-routes.js";
import { mountMenuCollectionRoutes } from "./menu-collection-routes.js";
import { readMenuStatus, mountMenuDetailRoutes } from "./menu-details-routes.js";
import { mountMenuPublishingRoutes } from "./menu-publishing-routes.js";
import { mountMenuCustomerPreviewRoute } from "./menu-customer-preview-route.js";
import { mountMenuItemPriceRoutes } from "./menu-item-prices-routes.js";
import { mountMenuCategoryRoutes } from "./menu-categories-routes.js";
import {
  mountMenuProductAvailabilityRoutes,
  mountMenuProductEditorRoutes,
} from "./menu-products-routes.js";

/** The menu's defaults, whether the venue's region gives takeaway its own VAT rate, the takeaway
 * rates a person may pick and today's dine-in rate: they travel here so anyone who may edit
 * products reads them. */
async function readMenuSettingsAnswer(
  tx: Transaction,
): Promise<MenuDefaults & { takeawayVat: boolean; vatRates: string[]; dineInVatRate: string }> {
  const rates = await readVenueVatRates(tx);
  return {
    ...(await readMenuSettings(tx, rates)),
    takeawayVat: await VENUE_SERVICE.venueChargesTakeawayVat(tx),
    vatRates: [...rates.pickable],
    dineInVatRate: await dineInVatRateToday(tx, rates),
  };
}

/** The one permission that gates every `/management-api` menu route. */
const MENU_WRITE_PERMISSION: Permission = "menu.manage";

/** A SHAPE screen only; the venue menu-list writes check that the id names a menu. */
async function requireMenuIdBody(c: Context): Promise<string> {
  const body = await readJsonBody<{ menuId?: unknown }>(c);
  if (typeof body.menuId !== "string") {
    throw new AppError("management.request_invalid", { field: "menuId" });
  }
  return requireUuidParam(body.menuId, "MenuId");
}

export function mountMenuApi(app: Hono, deps: MenuApiDeps, log: Logger): void {
  const epoch = crypto.randomUUID();
  let sequence = 0;
  const gated: GatedWork = (c, sessionId, fn) =>
    withTransaction(deps.db, async (tx) => {
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: MENU_WRITE_PERMISSION,
      });
      const result = await fn(tx, authorizedBy);
      if (c.req.method !== "GET") sequence++;
      c.header("x-waitron-menu-revision", JSON.stringify({ epoch, sequence }));
      return result;
    });

  app.get("/management-api/menu-settings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(await gated(c, sessionId, readMenuSettingsAnswer));
    }),
  );
  app.put("/management-api/menu-settings/default-color", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ color?: unknown }>(c);
      if (body.color !== null && typeof body.color !== "string")
        throw new AppError("management.request_invalid", { field: "color" });
      return c.json(
        await gated(c, sessionId, (tx, personId) => saveMenuDefaultColor(tx, body.color, personId)),
      );
    }),
  );

  /** Screen the editor body's optional course; null clears it. */
  const screenRouting = (body: Record<string, unknown>): ProductRouting => {
    const value = body.courseId;
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new AppError("management.request_invalid", { field: "courseId" });
    }
    if (typeof value === "string" && !isUuid(value)) {
      throw new AppError("course.not_found", { courseId: value });
    }
    return { courseId: value as string | null | undefined };
  };

  /** Save the course on the same transaction as the product. */
  const applyRouting = async (
    tx: Transaction,
    saved: ProductEditorValue,
    routing: ProductRouting,
  ): Promise<ProductEditorValue> => {
    if (routing.courseId === undefined) return saved;
    await setProductCourse(tx, saved.id, routing.courseId, "any");
    return readProductEditor(tx, saved.id);
  };

  mountListSurface(app, gated, log, {
    segment: "options",
    idKind: "OptionListId",
    collectionKey: "optionLists",
    itemKey: "optionList",
    list: listOptionLists,
    read: getOptionList,
    create: (tx, body) => createOptionList(tx, body, deps.venueLocale ?? FALLBACK_LOCALE),
    update: (tx, id, body) => updateOptionList(tx, id, body, deps.venueLocale ?? FALLBACK_LOCALE),
    remove: deleteOptionList,
    dependants: optionListDependants,
  });

  mountListSurface(app, gated, log, {
    segment: "extras",
    idKind: "ExtraListId",
    collectionKey: "extraLists",
    itemKey: "extraList",
    list: listExtraLists,
    read: getExtraList,
    create: (tx, body) => createExtraList(tx, body, deps.venueLocale ?? FALLBACK_LOCALE),
    update: (tx, id, body) => updateExtraList(tx, id, body, deps.venueLocale ?? FALLBACK_LOCALE),
    remove: deleteExtraList,
    // The products carrying the list and the menu offers publishing it. Both are detached by the
    // delete rather than blocking it, so this is information, never a refusal.
    dependants: extraListDependants,
  });

  mountSectionRoutes(app, gated, log, deps.venueLocale ?? FALLBACK_LOCALE);
  mountMenuStructureSaveRoute(
    app,
    gated,
    log,
    deps.venueLocale ?? FALLBACK_LOCALE,
    runStructureSave,
  );
  mountMenuHomeRoutes(app, gated, log);
  mountSetMenuRoutes(app, gated, log);
  mountContentTranslationsApi(app, gated, log, translationContextFor(deps), deps.managementOrigin);

  mountMenuLanguageRoutes(app, deps, gated, log);

  mountMenuCollectionRoutes(app, deps, gated, log);
  mountMenuCustomerPreviewRoute(app, gated, log, deps.venueLocale ?? FALLBACK_LOCALE);

  app.get("/management-api/menus/:id/read", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const parts = c.req.queries("part") ?? [];
      if (
        parts.length === 0 ||
        new Set(parts).size !== parts.length ||
        parts.some((part) => !["structure", "prices", "home", "status", "preview"].includes(part))
      )
        throw new AppError("management.request_invalid", { field: "part" });
      const result = await gated(c, sessionId, async (tx) => {
        const responses: Record<string, { status: number; body: unknown }> = {};
        for (const part of parts) {
          const response = await run(c, log, async () => {
            if (part === "structure") return c.json(await readMenuStructure(tx, menuId));
            if (part === "prices") return c.json(await menuPrices(tx, menuId));
            if (part === "home") return c.json(await readMenuHome(tx, menuId));
            if (part === "preview") return c.json(await previewMenu(tx, menuId));
            return c.json(await readMenuStatus(tx, menuId));
          });
          responses[part] = { status: response.status, body: await response.json() };
        }
        return { ...responses, revision: { epoch, sequence } };
      });
      return c.json(result);
    }),
  );

  mountMenuDetailRoutes(app, gated, log);

  mountMenuPublishingRoutes(app, deps, gated, log);

  mountMenuItemPriceRoutes(app, gated, log);

  app.put("/management-api/venue-default-menu", (c) =>
    runBodyMenu(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = await requireMenuIdBody(c);
      await gated(c, sessionId, (tx) => setVenueDefaultMenu(tx, menuId));
      return c.body(null, 204);
    }),
  );

  mountMenuCategoryRoutes(app, gated, log);
  mountMenuProductAvailabilityRoutes(app, gated, log);
  app.post("/management-api/products/menus", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<{ productIds?: unknown }>(c);
      const ids = idList(body.productIds, "productIds", "ProductId");
      return withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId,
          permission: MENU_WRITE_PERMISSION,
          touch: false,
        });
        const menus = await menusHolding(tx, ids);
        c.header("x-waitron-menu-revision", JSON.stringify({ epoch, sequence }));
        return c.json({ menus });
      });
    }),
  );
  mountMenuProductEditorRoutes(app, deps, gated, log, screenRouting, applyRouting);
}
