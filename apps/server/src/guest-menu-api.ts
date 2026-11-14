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
  readRecordedDocuments,
  menusOfVersions,
} from "@waitron/catalogue";
import { readCurrentImage, renderRendition } from "@waitron/media";
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
          versionId: live.versionId,
          members: menu.members.map((member) => ({
            name: member.name,
            section: member.kind === "section",
          })),
          language: menu.language,
          languages: menu.languages,
        };
      });
      c.header("Cache-Control", "no-store");
      return c.json(result);
    }),
  );
  app.post("/management-api/catalogues/:id/guest-paper", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const captured = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "catalogue.manage",
        });
        const parsed = GUEST_MENU_SETTINGS.parse({ enabled: false, paper: body.paper });
        if (!parsed.ok || !parsed.doc.paper)
          throw new AppError("management.request_invalid", {
            field: parsed.ok ? "paper" : parsed.field,
          });
        if (
          typeof body.versionId !== "string" ||
          (await menusOfVersions(tx, [body.versionId])).get(body.versionId) !== menuId
        )
          throw new AppError("management.request_invalid", { field: "versionId" });
        const document = (await readRecordedDocuments(tx, [body.versionId])).get(body.versionId)!;
        if (body.logo !== null && typeof body.logo !== "string")
          throw new AppError("management.request_invalid", { field: "logo" });
        const languages = await readContentLanguages(tx, deps.venueLocale ?? FALLBACK_LOCALE);
        const menu = publicGuestMenu(
          document,
          languages,
          typeof body.language === "string" ? body.language : languages.defaultLanguage,
        );
        for (const key of ["order", "breaks"]) {
          const indices = body[key];
          if (
            !Array.isArray(indices) ||
            indices.some((n) => !Number.isInteger(n) || n < 0 || n >= menu.members.length)
          )
            throw new AppError("management.request_invalid", { field: key });
        }
        return {
          menu,
          defaultLanguage: languages.defaultLanguage,
          venue: (await readVenue(tx)).name,
          paper: {
            ...parsed.doc.paper,
            order: body.order as number[],
            breaks: body.breaks as number[],
          },
          logo: typeof body.logo === "string" ? await readCurrentImage(tx, body.logo) : null,
        };
      });
      const logo = captured.logo
        ? `data:image/webp;base64,${Buffer.from(await renderRendition(captured.logo.bytes, "display", captured.logo.framing)).toString("base64")}`
        : undefined;
      c.header("Cache-Control", "no-store");
      return c.json({
        html: renderGuestMenuPage(captured.menu, captured.venue, captured.defaultLanguage, false, {
          ...captured.paper,
          logo,
        }),
      });
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
