import {
  readContentLanguages,
  listTranslationGapCounts,
  writeContentLanguages,
} from "@waitron/menu";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import { type ContentLanguageRules, FALLBACK_LOCALE, AppError } from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import type { MenuApiDeps } from "./menu-api-deps.js";
import { run } from "./menu-api-errors.js";

const NO_CONTENT_LANGUAGE_RULES: ContentLanguageRules = { required: [], official: [] };

export function mountMenuLanguageRoutes(
  app: Hono,
  deps: MenuApiDeps,
  gated: GatedWork,
  log: Logger,
): void {
  app.get("/management-api/content-languages", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(c, sessionId, (tx) =>
          readContentLanguages(tx, deps.venueLocale ?? FALLBACK_LOCALE),
        ),
      );
    }),
  );

  app.get("/management-api/content-language-rules", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(
          c,
          sessionId,
          async () => deps.contentLanguageRules ?? NO_CONTENT_LANGUAGE_RULES,
        ),
      );
    }),
  );

  app.get("/management-api/content-translation-gaps", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(c, sessionId, async (tx) =>
          listTranslationGapCounts(
            tx,
            await readContentLanguages(tx, deps.venueLocale ?? FALLBACK_LOCALE),
          ),
        ),
      );
    }),
  );

  // Language choices are public content metadata; this read neither requires nor touches a session.
  app.get("/api/content-languages", (c) =>
    run(c, log, async () => {
      const config = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        return readContentLanguages(tx, deps.venueLocale ?? FALLBACK_LOCALE);
      });
      return c.json(config);
    }),
  );

  app.put("/management-api/content-languages", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ defaultLanguage?: unknown; languages?: unknown }>(c);
      if (
        typeof body.defaultLanguage !== "string" ||
        !Array.isArray(body.languages) ||
        !body.languages.every((language): language is string => typeof language === "string")
      ) {
        throw new AppError("management.request_invalid", { field: "languages" });
      }
      const config = {
        defaultLanguage: body.defaultLanguage,
        languages: body.languages as string[],
      };
      await gated(c, sessionId, (tx, personId) =>
        writeContentLanguages(tx, config, deps.contentLanguageRules?.required, personId),
      );
      return c.body(null, 204);
    }),
  );
}
