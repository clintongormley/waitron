import type { Hono } from "hono";
import { readVenue, withTransaction, type Database } from "@waitron/db";
import { readContentLanguages, readLiveMenu } from "@waitron/catalogue";
import { authorizeManager } from "@waitron/identity";
import {
  createErrorBoundary,
  requireManagementSession,
  requireUuidParam,
} from "@waitron/server-kit";
import { FALLBACK_LOCALE, publicGuestMenu } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { renderGuestMenuPage } from "./guest-menu-page.js";
const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "authorization.not_permitted": 403,
    "person.suspended": 403,
    "catalogue.not_found": 404,
  },
  "catalogue.failed",
);
export function mountGuestMenuApi(
  app: Hono,
  deps: { db: Database; venueLocale?: string },
  log: Logger,
): void {
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
