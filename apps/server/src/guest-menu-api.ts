import type { Hono } from "hono";
import { readSettings, readVenue, saveSettings, withTransaction, type Database } from "@waitron/db";
import {
  GUEST_MENU_SETTINGS,
  readContentLanguages,
  readLiveMenu,
  readGuestMenu,
} from "@waitron/catalogue";
import { authorizeManager } from "@waitron/identity";
import {
  createErrorBoundary,
  requireManagementSession,
  requireUuidParam,
  readJsonBody,
} from "@waitron/server-kit";
import { AppError, FALLBACK_LOCALE, publicGuestMenu } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { renderGuestMenuPage } from "./guest-menu-page.js";
import { readVenueLocale } from "./venue-locale.js";
import "./errors.js";
const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "authorization.not_permitted": 403,
    "person.suspended": 403,
    "catalogue.not_found": 404,
    "settings.invalid": 500,
    "settings.out_of_date": 409,
    "management.request_invalid": 400,
  },
  "catalogue.failed",
);
export function mountGuestMenuApi(
  app: Hono,
  deps: { db: Database; venueLocale?: string },
  log: Logger,
): void {
  app.get("/management-api/guest-menu", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const answer = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "catalogue.manage",
        });
        const { doc, revision } = await readSettings(tx, GUEST_MENU_SETTINGS);
        return { ...doc, revision };
      });
      c.header("Cache-Control", "no-store");
      return c.json(answer);
    }),
  );
  app.put("/management-api/guest-menu", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (typeof body.enabled !== "boolean")
        throw new AppError("management.request_invalid", { field: "enabled" });
      if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0)
        throw new AppError("management.request_invalid", { field: "expectedRevision" });
      const { doc, revision } = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "catalogue.manage",
        });
        return saveSettings(tx, GUEST_MENU_SETTINGS, {
          doc: { enabled: body.enabled as boolean },
          expectedRevision: body.expectedRevision as number,
          personId: authorizedBy,
        });
      });
      return c.json({ ...doc, revision });
    }),
  );
  app.get("/management-api/catalogues/:id/guest-preview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const result = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "catalogue.manage",
        });
        const live = await readLiveMenu(tx, menuId);
        if (live === null) return null;
        const languages = await readContentLanguages(tx, deps.venueLocale ?? FALLBACK_LOCALE);
        const menu = publicGuestMenu(
          live.document,
          languages,
          c.req.query("language") ?? languages.defaultLanguage,
        );
        const venue = await readVenue(tx);
        return {
          html: renderGuestMenuPage(menu, venue.name, languages.defaultLanguage),
          language: menu.language,
          languages: menu.languages,
        };
      });
      c.header("Cache-Control", "no-store");
      return c.json(result);
    }),
  );
}

export function mountPublicGuestMenu(
  app: Hono,
  deps: { db: Database; serving: () => boolean },
  log: Logger,
): void {
  app.all("/public/menu", (c) =>
    run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.body(null, 405);
      if (!deps.serving()) return c.body(null, 503);
      const locale = await readVenueLocale(deps.db);
      const html = await withTransaction(deps.db, async (tx) => {
        const live = await readGuestMenu(tx);
        if (live === null) return null;
        const languages = await readContentLanguages(tx, locale);
        const menu = publicGuestMenu(
          live.document,
          languages,
          c.req.query("language") ?? languages.defaultLanguage,
        );
        return renderGuestMenuPage(
          menu,
          (await readVenue(tx)).name,
          languages.defaultLanguage,
          true,
        );
      });
      return html === null ? c.body(null, 404) : c.html(html);
    }),
  );
  app.all("/public/menu/*", (c) => c.body(null, 404));
}
