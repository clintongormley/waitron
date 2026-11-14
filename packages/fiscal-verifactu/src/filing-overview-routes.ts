import "./errors.js";
import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { createErrorBoundary, requireManagementSession, type Logger } from "@waitron/server-kit";
import { readFilingOverview } from "./filing-overview.js";
import { readFilingWarnings } from "./filing-warnings.js";

const CASE_LIMIT = 200;

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
  },
  "fiscal-filing.failed",
);

export function mountFilingOverview(
  app: Hono,
  ctx: Pick<ModuleRouteContext, "db" | "recordGeneration" | "fiscalDrain">,
  log: Logger,
): void {
  app.get("/management-api/fiscal-filing", (c) =>
    run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      const managementSessionId = requireManagementSession(c);
      const limit = c.req.query("cases") === "all" ? null : CASE_LIMIT;
      const overview = await withTransaction(ctx.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId, permission: "report.export" });
        const read = await readFilingOverview(tx, {
          nodeId: ctx.recordGeneration?.nodeId ?? null,
          limit,
        });
        return { ...read, warnings: await readFilingWarnings(tx, { limit }) };
      });
      return c.json(
        {
          ...overview,
          filing: ctx.fiscalDrain?.filing() ?? false,
          awaitingCertificate: ctx.fiscalDrain?.awaitingCertificate() ?? false,
        },
        200,
      );
    }),
  );
}
