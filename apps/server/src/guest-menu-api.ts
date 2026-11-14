import type { Hono } from "hono";
import {
  readSettings,
  readVenue,
  saveSettings,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
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
import { renderGuestMenuPage, renderGuestMenuUnavailable } from "./guest-menu-page.js";
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
async function sharingStatus(tx: Transaction, serving: () => boolean) {
  const { doc, revision } = await readSettings(tx, GUEST_MENU_SETTINGS);
  return { ...doc, revision, available: serving() && (await readGuestMenu(tx)) !== null };
}
export function mountGuestMenuApi(
  app: Hono,
  deps: { db: Database; venueLocale?: string; serving: () => boolean },
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
        return sharingStatus(tx, deps.serving);
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
      const answer = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "catalogue.manage",
        });
        const current = await readSettings(tx, GUEST_MENU_SETTINGS);
        const parsed = GUEST_MENU_SETTINGS.parse({
          ...current.doc,
          enabled: body.enabled,
          ...(Object.hasOwn(body, "paper") ? { paper: body.paper } : {}),
        });
        if (!parsed.ok) throw new AppError("management.request_invalid", { field: parsed.field });
        await saveSettings(tx, GUEST_MENU_SETTINGS, {
          doc: parsed.doc,
          expectedRevision: body.expectedRevision as number,
          personId: authorizedBy,
        });
        return sharingStatus(tx, deps.serving);
      });
      return c.json(answer);
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
  deps: { db: Database; serving: () => boolean; venueLocale?: () => string },
  log: Logger,
): void {
  app.all("/public/menu", async (c) => {
    const serving = deps.serving();
    const locale = serving ? (deps.venueLocale?.() ?? FALLBACK_LOCALE) : FALLBACK_LOCALE;
    const response = await run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        c.header("Allow", "GET, HEAD");
        return c.body(null, 405);
      }
      if (!serving) return c.body(null, 503);
      // Anonymous reads use committed rows without reserving the sale write queue.
      const live = await readGuestMenu(deps.db);
      if (live === null) return c.body(null, 404);
      const languages = await readContentLanguages(deps.db, locale);
      const menu = publicGuestMenu(
        live.document,
        languages,
        c.req.query("language") ?? languages.defaultLanguage,
      );
      return c.html(
        renderGuestMenuPage(menu, (await readVenue(deps.db)).name, languages.defaultLanguage, true),
      );
    });
    if (response.ok) return response;
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "text/html; charset=UTF-8");
    return new Response(renderGuestMenuUnavailable(c.req.query("language") ?? locale, locale), {
      status: response.status,
      headers,
    });
  });
  app.all("/public/menu/*", (c) => c.body(null, 404));
}
