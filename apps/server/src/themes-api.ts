import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import {
  createCustomTheme,
  deleteCustomTheme,
  listCustomThemes,
  prepareThemeSave,
  renameCustomTheme,
  saveCustomTheme,
  encodeLogoRaster,
  setThemeInUse,
  type ReceiptLogoRasters,
  type StoredTheme,
} from "@waitron/layouts";
import {
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
  requireNullableString,
  requireString,
} from "@waitron/server-kit";
import {
  imageExists,
  readCurrentImageMetadata,
  readImageBytes,
  renderRendition,
  renditionUrl,
} from "@waitron/media";
import { safeWidthDots } from "@waitron/printing";
import { AppError, MEDIA_FILENAME } from "@waitron/shared";
import { deriveThemeFrom, type ThemeChoices, type ThemeWarning } from "@waitron/ui-core/theme";
import type { Logger } from "./logger.js";
import { countBlackDots, createLogoCache, drawPreviewLogo } from "./receipt-logo.js";
import { SERVER_THEME_DEFAULTS } from "./theme-defaults.js";
import { printedLogoFor, recheckThemeLogo, snapshotThemeLogo } from "./theme-logo.js";
import { readVenueThemeSource, venueThemeAnswer } from "./venue-theme.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "theme.invalid": 400,
  "theme.name_taken": 409,
  "theme.not_found": 404,
  "image.changed": 409,
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

export interface ThemeLogoPrint {
  /** The paper's printable dots across: `safeWidthDots("80mm")`. */
  readonly paperDots: number;
  /** The 80 mm picture, stored form; `null` when the image is gone or will not decode. */
  readonly picture: {
    readonly widthDots: number;
    readonly heightDots: number;
    readonly data: string;
  } | null;
  /** Set dots in `picture`; 0 means the logo prints blank. */
  readonly blackDots: number;
}

function requireImageQuery(queries: Record<string, string[]>): string {
  const keys = Object.keys(queries);
  const values = queries.image;
  if (keys.length !== 1 || values?.length !== 1 || !MEDIA_FILENAME.test(values[0]!)) {
    throw new AppError("management.request_invalid", { field: "image" });
  }
  return values[0]!;
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

function namesLogo(theme: Record<string, unknown>): boolean {
  return theme.logo !== null && theme.logo !== undefined;
}

async function saveWithLogo<T>(
  db: Database,
  prepare: (
    tx: Transaction,
  ) => Promise<{ choices: ThemeChoices; keptPrintedLogo: ReceiptLogoRasters | null }>,
  write: (tx: Transaction, printedLogo: ReceiptLogoRasters) => Promise<T>,
): Promise<T> {
  const { logo, snapshot } = await withTransaction(db, async (tx) => {
    const { choices, keptPrintedLogo } = await prepare(tx);
    const { logo } = choices;
    if (logo === null) throw new Error("A theme document naming a logo was read with none");
    return { logo, snapshot: await snapshotThemeLogo(tx, logo, keptPrintedLogo) };
  });
  // Two transactions on purpose: sharp must not run holding the write lock, so the write checks the
  // image's id and revision again.
  const printedLogo = await printedLogoFor(snapshot);
  return withTransaction(db, async (tx) => {
    const stored = await write(tx, printedLogo);
    await recheckThemeLogo(tx, logo, snapshot);
    return stored;
  });
}

export function mountThemesApi(app: Hono, deps: { db: Database }, log: Logger): void {
  const logoCache = createLogoCache();

  // Deliberately unauthenticated: the answer is the theme in use's stylesheet, its hash and its
  // logo's public rendition addresses, and carries no secrets.
  app.get("/api/theme", (c) =>
    run(c, log, async () => {
      const source = await withTransaction(deps.db, (tx) => readVenueThemeSource(tx));
      return c.json(venueThemeAnswer(source), 200, { "Cache-Control": "no-store" });
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

  app.get("/management-api/theme-logo-print", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const image = requireImageQuery(c.req.queries());
      const current = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId, permission: "venue.view" });
        return readCurrentImageMetadata(tx, image);
      });
      // Drawn outside the transaction: sharp must not run holding the write lock.
      const raster =
        current === null
          ? null
          : await drawPreviewLogo(
              logoCache,
              renditionUrl(current.sourceFilename, "display", current.framing),
              "80mm",
              {
                exists: () => imageExists(deps.db, image),
                bytes: async () => {
                  const source = await readImageBytes(deps.db, current.sourceFilename);
                  return source ? renderRendition(source.bytes, "display", current.framing) : null;
                },
              },
            );
      const answer: ThemeLogoPrint = {
        paperDots: safeWidthDots("80mm"),
        picture: raster === null ? null : encodeLogoRaster(raster),
        blackDots: raster === null ? 0 : countBlackDots(raster),
      };
      return c.json(answer, 200);
    }),
  );

  app.post("/management-api/themes", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readBody(c);
      const name = requireString(body.name, "name");
      const theme = requireTheme(body);
      if (body.inUse !== undefined && typeof body.inUse !== "boolean") {
        throw new AppError("management.request_invalid", { field: "inUse" });
      }
      const inUse = body.inUse === true;
      const stored = namesLogo(theme)
        ? await saveWithLogo(
            deps.db,
            (tx) => prepareThemeSave(tx, { managementSessionId, id: null, name, theme }),
            (tx, printedLogo) =>
              createCustomTheme(tx, { managementSessionId, name, theme, inUse, printedLogo }),
          )
        : await withTransaction(deps.db, (tx) =>
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
      const stored = namesLogo(theme)
        ? await saveWithLogo(
            deps.db,
            (tx) => prepareThemeSave(tx, { managementSessionId, id, theme }),
            (tx, printedLogo) =>
              saveCustomTheme(tx, { managementSessionId, id, theme, printedLogo }),
          )
        : await withTransaction(deps.db, (tx) =>
            saveCustomTheme(tx, { managementSessionId, id, theme }),
          );
      return c.json(themeAnswerOf(stored), 200);
    }),
  );

  app.patch("/management-api/themes/:id", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const name = requireString((await readBody(c)).name, "name");
      const id = c.req.param("id");
      const stored = await withTransaction(deps.db, (tx) =>
        renameCustomTheme(tx, { managementSessionId, id, name }),
      );
      return c.json(themeAnswerOf(stored), 200);
    }),
  );

  app.delete("/management-api/themes/:id", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const id = c.req.param("id");
      const answer = await withTransaction(deps.db, (tx) =>
        deleteCustomTheme(tx, { managementSessionId, id }),
      );
      return c.json(answer, 200);
    }),
  );

  app.put("/management-api/theme-in-use", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readBody(c);
      const customThemeId = requireNullableString(body.customThemeId, "customThemeId");
      const inUse = await withTransaction(deps.db, (tx) =>
        setThemeInUse(tx, { managementSessionId, customThemeId }),
      );
      return c.json({ inUse }, 200);
    }),
  );
}
