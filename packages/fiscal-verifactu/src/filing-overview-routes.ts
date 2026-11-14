import "./errors.js";
import type { Hono } from "hono";
import { withTransaction, type Transaction } from "@waitron/db";
import { prepareIssueClock } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { createErrorBoundary, requireManagementSession, type Logger } from "@waitron/server-kit";
import { AppError, localCalendarDate, type ErrorCode } from "@waitron/shared";
import type { BoxToday } from "./filing-overview-types.js";
import { readFilingOverview } from "./filing-overview.js";
import { readFilingWarnings } from "./filing-warnings.js";

const CASE_LIMIT = 200;

/** What `prepareIssueClock` raises when the venue row, its settings or its time zone cannot
 * date a record here. Any other error fails the read, as it would any other route. */
const DAY_UNREAD_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "venue.time_zone_invalid",
  "venue.time_zone_target_invalid",
  "venue.time_zone_conversion_failed",
  "venue.not_found",
  "settings.invalid",
]);

/**
 * The day a replacement corrective issued now would carry, and the venue's offset that gives it:
 * the same clock and venue zone the remedy route dates it with. Null where that route would refuse
 * anyway, so the page still answers.
 */
async function boxToday(
  tx: Transaction,
  generation: ModuleRouteContext["recordGeneration"],
  log: Logger,
): Promise<BoxToday | null> {
  if (generation === undefined) return null;
  try {
    const clock = await prepareIssueClock(tx, { nodeId: generation.nodeId }, generation.clock);
    const { instant, offsetMinutes } = clock.now();
    return { day: localCalendarDate(instant, offsetMinutes), offsetMinutes };
  } catch (error) {
    if (!(error instanceof AppError) || !DAY_UNREAD_CODES.has(error.code)) throw error;
    log("warn", "fiscal.filing_day_unread", {
      errorCode: error.code,
      ...error.params,
      ...(error.reason === undefined ? {} : { logReason: error.reason }),
    });
    return null;
  }
}

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
        const warnings = await readFilingWarnings(tx, { limit });
        return { ...read, warnings, today: await boxToday(tx, ctx.recordGeneration, log) };
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
