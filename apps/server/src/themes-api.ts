import type { Hono } from "hono";
import { withTransaction, type Database } from "@waitron/db";
import { readThemeInUse } from "@waitron/layouts";
import { createErrorBoundary } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { venueThemeAnswer } from "./venue-theme.js";

const run = createErrorBoundary({}, "themes.failed");

export function mountThemesApi(app: Hono, deps: { db: Database }, log: Logger): void {
  app.get("/api/theme", (c) =>
    run(c, log, async () => {
      const inUse = await withTransaction(deps.db, (tx) => readThemeInUse(tx));
      return c.json(venueThemeAnswer(inUse), 200, { "Cache-Control": "no-store" });
    }),
  );
}
