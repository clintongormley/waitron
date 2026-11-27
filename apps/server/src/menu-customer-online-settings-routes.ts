import { readCustomerMenuOnlineSettings, saveCustomerMenuOnlineSettings } from "@waitron/menu";
import {
  readRawJsonBody,
  requireEnum,
  requireManagementSession,
  type Logger,
} from "@waitron/server-kit";
import {
  AppError,
  CUSTOMER_MENU_PHOTO_SIZES,
  type CustomerMenuOnlineSettings,
} from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run } from "./menu-api-errors.js";
import { object, requireUuidParam } from "./menu-request-fields.js";

function settingsOf(value: unknown): CustomerMenuOnlineSettings {
  const { enabled, address, photos } = object(value, "body");
  if (typeof enabled !== "boolean")
    throw new AppError("management.request_invalid", { field: "enabled" });
  if (address !== null && typeof address !== "string")
    throw new AppError("management.request_invalid", { field: "address" });
  return { enabled, address, photos: requireEnum(photos, "photos", CUSTOMER_MENU_PHOTO_SIZES) };
}

export function mountMenuCustomerOnlineSettingsRoutes(
  app: Hono,
  gated: GatedWork,
  log: Logger,
): void {
  const path = "/management-api/menus/:id/customer-online-settings";
  app.get(path, (c) =>
    run(c, log, async () => {
      c.header("cache-control", "no-store");
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      return c.json(await gated(c, sessionId, (tx) => readCustomerMenuOnlineSettings(tx, menuId)));
    }),
  );
  app.put(path, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const settings = settingsOf(await readRawJsonBody<unknown>(c));
      return c.json(
        await gated(c, sessionId, (tx) => saveCustomerMenuOnlineSettings(tx, menuId, settings)),
      );
    }),
  );
}
