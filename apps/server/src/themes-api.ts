import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import {
  createCustomTheme,
  listCustomThemes,
  readThemeInUse,
  saveCustomTheme,
  setThemeInUse,
  type StoredTheme,
} from "@waitron/layouts";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { deriveThemeFrom, type ThemeChoices, type ThemeWarning } from "@waitron/ui-core/theme";
import type { Logger } from "./logger.js";
import { SERVER_THEME_DEFAULTS } from "./theme-defaults.js";
import { venueThemeAnswer } from "./venue-theme.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "theme.invalid": 400,
  "theme.name_taken": 409,
  "theme.not_found": 404,
};

const run = createErrorBoundary(STATUS, "themes.failed");

export interface ThemeAnswer {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly choices: ThemeChoices | null;
  readonly light: Readonly<Record<string, string>> | null;
  readonly dark: Readonly<Record<string, string>> | null;
  readonly warnings: readonly ThemeWarning[];
}

/** Takes no transaction: colours are worked out after the request's transaction, which holds the write lock. */
export function themeAnswerOf(stored: StoredTheme): ThemeAnswer {
  const { id, name, updatedAt, choices } = stored;
  if (choices === null) {
    return { id, name, updatedAt, choices, light: null, dark: null, warnings: [] };
  }
  const { light, dark, warnings } = deriveThemeFrom(SERVER_THEME_DEFAULTS, choices);
  return { id, name, updatedAt, choices, light, dark, warnings };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(c: Parameters<typeof readJsonBody>[0]): Promise<Record<string, unknown>> {
  const body = await readJsonBody<unknown>(c);
  if (!isPlainObject(body)) throw new AppError("management.request_invalid", { field: "body" });
  return body;
}

function requireTheme(body: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(body.theme)) {
    throw new AppError("management.request_invalid", { field: "theme" });
  }
  return body.theme;
}

export function mountThemesApi(app: Hono, deps: { db: Database }, log: Logger): void {
  // Deliberately unauthenticated: the answer is the stylesheet and hash of the theme in use, and
  // carries no secrets.
  app.get("/api/theme", (c) =>
    run(c, log, async () => {
      const inUse = await withTransaction(deps.db, (tx) => readThemeInUse(tx));
      return c.json(venueThemeAnswer(inUse), 200, { "Cache-Control": "no-store" });
    }),
  );

  app.get("/management-api/themes", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const list = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId, permission: "venue.view" });
        return listCustomThemes(tx);
      });
      return c.json({ themes: list.themes.map(themeAnswerOf), inUse: list.inUse }, 200);
    }),
  );

  app.post("/management-api/themes", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readBody(c);
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const name = body.name;
      const theme = requireTheme(body);
      if (body.inUse !== undefined && typeof body.inUse !== "boolean") {
        throw new AppError("management.request_invalid", { field: "inUse" });
      }
      const inUse = body.inUse === true;
      const stored = await withTransaction(deps.db, (tx) =>
        createCustomTheme(tx, { managementSessionId, name, theme, inUse }),
      );
      return c.json(themeAnswerOf(stored), 201);
    }),
  );

  app.put("/management-api/themes/:id", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const theme = requireTheme(await readBody(c));
      const id = c.req.param("id");
      const stored = await withTransaction(deps.db, (tx) =>
        saveCustomTheme(tx, { managementSessionId, id, theme }),
      );
      return c.json(themeAnswerOf(stored), 200);
    }),
  );

  app.put("/management-api/theme-in-use", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readBody(c);
      const customThemeId = body.customThemeId;
      if (customThemeId !== null && typeof customThemeId !== "string") {
        throw new AppError("management.request_invalid", { field: "customThemeId" });
      }
      const inUse = await withTransaction(deps.db, (tx) =>
        setThemeInUse(tx, { managementSessionId, customThemeId }),
      );
      return c.json({ inUse }, 200);
    }),
  );
}
