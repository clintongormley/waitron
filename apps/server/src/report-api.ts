// Registers `management.request_invalid`, which the query screens below throw.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { sql } from "drizzle-orm";
import { AppError, nodeId as brandNodeId, type NodeId } from "@waitron/shared";
import { readTenant, withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  computeDailyClose,
  computeOverdueOrders,
  computeTopSellers,
  computeVatReturn,
  computeVatSummaryForPeriod,
  currentBusinessDay,
  mapModelo303,
  parsePeriodToken,
  toDr303Record,
  type LiquidationPeriod,
} from "@waitron/reporting";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { requirePeriod } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

/**
 * On a mirror the data node is the ORIGIN recorded in `mirror_config`, not the mirror's own id.
 * Per-node reports use it; the overview and modelo 303 aggregate every node.
 */
export interface ReportApiDeps {
  db: Database;
  cfg: { nodeId: string };
}

/** Two distinct seams: viewing the takings dashboard is not exporting the fiscal file (a supervisor
 * holds `report.view` but not `report.export`). */
const REPORT_EXPORT_PERMISSION: Permission = "report.export";
const REPORT_VIEW_PERMISSION: Permission = "report.view";

/** Client faults only; anything else reaches `run` as a server fault. */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
};

const run = createErrorBoundary(STATUS, "report.failed");

/**
 * 1000..9999, the bound `validatePeriod` enforces, so a screened year never reaches its
 * plain-`Error` throw; `/^\d{4}$/` would admit "0999".
 */
function requireYear(raw: string | undefined): number {
  if (raw === undefined || !/^[1-9]\d{3}$/.test(raw)) {
    throw new AppError("management.request_invalid", { field: "year" });
  }
  return Number(raw);
}

/**
 * Monthly "01".."12" or quarterly "1T".."4T", through the same `parsePeriodToken` grammar the DR303
 * writer uses. ANNUAL is deliberately refused: the annual summary is modelo 390, not a 303. Returns
 * the union and the normalized token from one source, so they cannot disagree.
 */
function requireLiquidationPeriod(raw: string | undefined): {
  period: LiquidationPeriod;
  token: string;
} {
  if (raw !== undefined) {
    const token = raw.trim().toUpperCase();
    const period = parsePeriodToken(token);
    if (period !== undefined) return { period, token };
  }
  throw new AppError("management.request_invalid", { field: "period" });
}

/**
 * One character, the DR303 field's length. The allowed set is an AEAT/asesor question, so any
 * single character passes.
 */
function requireDeclarationType(raw: string | undefined): string {
  if (raw === undefined || Array.from(raw).length !== 1) {
    throw new AppError("management.request_invalid", { field: "declarationType" });
  }
  return raw;
}

/** The data node's location clock, with `day_cutover` trimmed to HH:MM. */
export async function resolveVenueClock(
  tx: Transaction,
  nodeId: string,
): Promise<{ timeZone: string; dayCutover: string }> {
  const { rows } = await tx.execute<{ time_zone: string; day_cutover: string }>(sql`
    select l.time_zone, l.day_cutover
    from nodes n join locations l on l.id = n.location_id
    where n.id = ${nodeId}
  `);
  const row = rows[0];
  /* v8 ignore start */
  if (row === undefined) {
    // Unreachable on a primary: its node row exists and `nodes.location_id` is a not-null foreign
    // key. On a mirror the origin's rows may be absent. Either way, a server fault.
    throw new Error(`report-api: no node/location row for ${nodeId}`);
  }
  /* v8 ignore stop */
  return { timeZone: row.time_zone, dayCutover: row.day_cutover.slice(0, 5) };
}

async function countOpenTables(
  tx: Transaction,
  nodeId: NodeId,
): Promise<{ open: number; total: number }> {
  // `cast(x as text)`: this engine has no `::` operator, and text keeps both counts one type for
  // `Number()`.
  const { rows } = await tx.execute<{ total: string; open: string }>(sql`
    select cast(count(*) as text) as total,
           cast(count(*) filter (where dt.tab_id is not null) as text) as open
    from dining_tables dt
    join nodes n on n.location_id = dt.location_id
    where n.id = ${nodeId} and dt.active = true
  `);
  return { open: Number(rows[0]!.open), total: Number(rows[0]!.total) };
}

/**
 * Mount reporting routes through the shared authorization gate. report.view
 * permits operational reports; report.export permits the modelo 303 export.
 * The overview aggregates all tenant nodes; per-node reports use cfg.nodeId.
 * The modelo 303 file remains a candidate requiring uploader validation and asesor
 * confirmation for prorrata handling.
 */
export function mountReportApi(app: Hono, deps: ReportApiDeps, log: Logger): void {
  const gated = <T>(
    sessionId: string,
    permission: Permission,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, { managementSessionId: sessionId, permission });
      return fn(tx);
    });

  // Every per-node route derives the node and its venue clock here, so they cannot drift.
  const buildReportContext = async (
    tx: Transaction,
  ): Promise<{
    nodeId: NodeId;
    clock: { timeZone: string; dayCutover: string };
  }> => {
    const nodeId = brandNodeId(deps.cfg.nodeId);
    const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
    return { nodeId, clock };
  };

  app.get("/management-api/reports/modelo-303", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const year = requireYear(c.req.query("year"));
      const { period, token } = requireLiquidationPeriod(c.req.query("period"));
      const declarationType = requireDeclarationType(c.req.query("declarationType"));

      const record = await gated(sessionId, REPORT_EXPORT_PERMISSION, async (tx) => {
        // The obligado is the database's one taxpayer row.
        const issuer = await readTenant(tx);
        /* v8 ignore start */
        if (issuer === null) {
          throw new Error("report-api: no taxpayer row");
        }
        /* v8 ignore stop */
        const vatReturn = await computeVatReturn(tx, {
          year,
          period,
        });
        const modelo = mapModelo303(vatReturn);
        // The same token parsed above, so the writer's envelope cross-check cannot mismatch the
        // aggregate.
        return toDr303Record(modelo, {
          taxId: issuer.taxId,
          name: issuer.legalName,
          year,
          period: token,
          declarationType,
        });
      });

      // A per-request fiscal document behind auth: never cached, downloaded as an attachment.
      return c.body(new Uint8Array(record), 200, {
        "Content-Type": "text/plain; charset=ISO-8859-1",
        "Content-Disposition": `attachment; filename="modelo-303-${year}-${token}.txt"`,
        "Cache-Control": "no-store",
      });
    }),
  );

  // The overview aggregates every node for the venue's CURRENT business day; only the open-tables
  // count is location-scoped.
  app.get("/management-api/reports/overview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { nodeId, clock } = await buildReportContext(tx);
        const businessDay = currentBusinessDay(clock);
        // No `nodeId`: venue-wide.
        const input = {
          businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
        };
        // Awaited in turn, never `Promise.all`: they share one transaction (CLAUDE.md §3).
        const close = await computeDailyClose(tx, input);
        const topSellers = await computeTopSellers(tx, {
          fromBusinessDay: businessDay,
          toBusinessDay: businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
          limit: 5,
        });
        const openTables = await countOpenTables(tx, nodeId);
        return {
          businessDay,
          takings: {
            tenderTotal: close.cash.tenderTotal,
            tipTotal: close.cash.tipTotal,
            grossTotal: close.vat.grossTotal,
          },
          counts: close.counts,
          openTables,
          topSellers,
        };
      });
      return c.json(result);
    }),
  );

  // The full daily close and top sellers for ONE explicit business day, for this node.
  app.get("/management-api/reports/daily-close", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const businessDay = requirePeriod(c.req.query("businessDay"), "businessDay");
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { nodeId, clock } = await buildReportContext(tx);
        const input = {
          nodeId,
          businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
        };
        // Sequential, not Promise.all: both reads share ONE transaction (see the overview route).
        const close = await computeDailyClose(tx, input);
        const topSellers = await computeTopSellers(tx, {
          nodeId,
          fromBusinessDay: businessDay,
          toBusinessDay: businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
          limit: 10,
        });
        return { businessDay, vat: close.vat, cash: close.cash, counts: close.counts, topSellers };
      });
      return c.json(result);
    }),
  );

  // VAT summary and top sellers over an inclusive business-day range, for this node. Both ends
  // passed `requirePeriod`'s fixed "YYYY-MM-DD" shape, so a string compare orders them.
  app.get("/management-api/reports/period", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const from = requirePeriod(c.req.query("from"), "from");
      const to = requirePeriod(c.req.query("to"), "to");
      if (from > to) {
        throw new AppError("management.request_invalid", { field: "range" });
      }
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { nodeId, clock } = await buildReportContext(tx);
        const common = {
          nodeId,
          fromBusinessDay: from,
          toBusinessDay: to,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
        };
        // Sequential, not Promise.all: both reads share ONE transaction (see the overview route).
        const vat = await computeVatSummaryForPeriod(tx, common);
        const topSellers = await computeTopSellers(tx, { ...common, limit: 10 });
        return { from, to, vat, topSellers };
      });
      return c.json(result);
    }),
  );

  // This node's open kitchen orders whose worst unserved line is overdue, worst first. A live
  // snapshot: only `nodeId` is taken from the report context.
  app.get("/management-api/reports/overdue-orders", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const orders = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { nodeId } = await buildReportContext(tx);
        return computeOverdueOrders(tx, { nodeId });
      });
      return c.json({ orders });
    }),
  );
}
