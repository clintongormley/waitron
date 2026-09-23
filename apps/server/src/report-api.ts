// Side-effect: loads this host's `management.request_invalid` augmentation (the query screens below
// throw it directly), under the "every file that throws one imports ./errors.js" convention. The auth
// codes (`management_session.*`, `person.suspended`, `authorization.not_permitted`) are declared in
// @waitron/identity and load via the `authorizeManager`/`requireManagementSession` value imports.
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
 * Reporting dependencies include the tenant and data node. On a mirror the data node is the ORIGIN
 * recorded in `mirror_config` — the primary it was adopted from, not the mirror's own id. Per-node
 * reports use it; the overview and modelo 303 aggregate the tenant's nodes.
 */
export interface ReportApiDeps {
  db: Database;
  cfg: { nodeId: string };
}

/** The permissions gating the reporting routes, referenced through these constants (never an inline
 * literal — the catalogue-api `CATALOGUE_WRITE_PERMISSION` pattern). `report.export` gates the modelo
 * 303 DR303 export (manager + admin); `report.view` gates the dashboard reporting reads — overview,
 * daily-close and period (supervisor, manager + admin). Two DISTINCT seams: viewing the takings
 * dashboard is not exporting the fiscal file (a supervisor holds view but not export). */
const REPORT_EXPORT_PERMISSION: Permission = "report.export";
const REPORT_VIEW_PERMISSION: Permission = "report.view";

/** Every AppError CODE these routes answer + its HTTP status (the purchasing-api STATUS parallel).
 * CLIENT faults only; a genuine SERVER fault reaches `run` as a non-AppError → an opaque 500. No new
 * code is introduced: request-shape faults reuse `management.request_invalid`. */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
};

const run = createErrorBoundary(STATUS, "report.failed");

/** Screen the `year` query param: a 4-digit integer in 1000..9999 — the SAME bound `validatePeriod`
 * (`@waitron/reporting`, period.ts) enforces, so a screened year never reaches its plain-`Error` throw.
 * `/^\d{4}$/` would admit the leading-zero range "0000".."0999" (`Number("0999") === 999`), which
 * validatePeriod then rejects downstream as a plain `Error` → opaque `server.internal` 500; `/^[1-9]\d{3}$/`
 * refuses it here as `management.request_invalid` {field:"year"} (never a downstream error). */
function requireYear(raw: string | undefined): number {
  if (raw === undefined || !/^[1-9]\d{3}$/.test(raw)) {
    throw new AppError("management.request_invalid", { field: "year" });
  }
  return Number(raw);
}

/** Screen the `period` query param into a LiquidationPeriod. Accepts "01".."12" (month) and
 * "1T".."4T" (quarter) via `parsePeriodToken` — the ONE token grammar shared with the DR303 writer's
 * `formatPeriod`, so the route's accepted set cannot drift from the writer's. ANNUAL is deliberately
 * NOT accepted: there is no annual modelo 303 file (the annual resumen is modelo 390, out of scope —
 * spec D3). Anything else → `management.request_invalid` {field:"period"}. Returns both the union and
 * the normalized string the envelope must carry (derived from ONE source, so they cannot disagree —
 * spec D4). The name distinguishes it from `request-screens.ts`'s date-screening `requirePeriod`. */
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

/** Screen the AEAT tipo de declaración: a single character (the DR303 field is length 1). The exact
 * allowed SET (I/D/C/N/…) is an AEAT/asesor detail (spec §7 owner-review), so any single char passes;
 * absent/multi-char → `management.request_invalid` {field:"declarationType"}. */
function requireDeclarationType(raw: string | undefined): string {
  if (raw === undefined || Array.from(raw).length !== 1) {
    throw new AppError("management.request_invalid", { field: "declarationType" });
  }
  return raw;
}

/**
 * Read the configured data node's location clock, joining the node to its location.
 * Convert day_cutover to HH:MM. A missing location is a configuration
 * error surfaced as an opaque server error.
 */
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
    // Expected-unreachable on a primary: its own node row is always present, and `nodes.location_id`
    // (NOT NULL, FK to locations.id — 0015_nodes) guarantees its location row (mirrors the modelo 303
    // route's whoami-style tenant guard). On a mirror the row is the configured origin's, present only
    // once the mirror holds the venue's rows — nothing brings them today (`mirror-bundle.ts`'s header).
    // Either way a node with no row becomes an opaque 500 via `run`.
    throw new Error(`report-api: no node/location row for ${nodeId}`);
  }
  /* v8 ignore stop */
  return { timeZone: row.time_zone, dayCutover: row.day_cutover.slice(0, 5) };
}

/**
 * Count active dining tables and open tabs at the data node's location.
 */
async function countOpenTables(
  tx: Transaction,
  nodeId: NodeId,
): Promise<{ open: number; total: number }> {
  // `cast(x as text)` in place of `x::text`: this engine has no cast OPERATOR and refuses the
  // colons with `unrecognized token: ":"`. The text is what keeps both counts one type for the
  // `Number()` below, whatever width the engine returns them at.
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

  // The (nodeId, clock) pair every reporting route below derives identically — extracted
  // so overview/daily-close/period cannot drift on branding or on how the venue clock is resolved.
  // Closes over `deps` (unlike `resolveVenueClock`, which is a top-level function taking `nodeId`
  // explicitly); the modelo-303 route above does NOT use this, since it reads the taxpayer's own
  // `tenants` row for the identity it files under.
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
        // The obligado identity is the database's one taxpayer row.
        const issuer = await readTenant(tx);
        /* v8 ignore start */
        if (issuer === null) {
          // A missing taxpayer row is a server configuration error.
          throw new Error("report-api: no taxpayer row");
        }
        /* v8 ignore stop */
        const vatReturn = await computeVatReturn(tx, {
          year,
          period,
        });
        const modelo = mapModelo303(vatReturn);
        // options.period === the SAME period token parsed above, so the writer's envelope cross-check
        // (monthly) can never mismatch the aggregate (spec D4).
        return toDr303Record(modelo, {
          taxId: issuer.taxId,
          name: issuer.legalName,
          year,
          period: token,
          declarationType,
        });
      });

      // ISO-8859-1 fixed-layout file: `record` is a latin1-encoded Buffer; `new Uint8Array` narrows it
      // to Uint8Array<ArrayBuffer> for `c.body`. It is a per-request fiscal
      // document behind auth → never cached; a download → Content-Disposition attachment.
      return c.body(new Uint8Array(record), 200, {
        "Content-Type": "text/plain; charset=ISO-8859-1",
        "Content-Disposition": `attachment; filename="modelo-303-${year}-${token}.txt"`,
        "Cache-Control": "no-store",
      });
    }),
  );

  // The overview aggregates every tenant node for the venue business day. Only the
  // open-table count is location-scoped. Read the venue clock to determine today.
  app.get("/management-api/reports/overview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { nodeId, clock } = await buildReportContext(tx);
        const businessDay = currentBusinessDay(clock);
        // No `nodeId` → venue-wide (all nodes). `nodeId` (from `buildReportContext`) still scopes the
        // open-tables tile below by its LOCATION.
        const input = {
          businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
        };
        // Sequential, not Promise.all: these reads share ONE transaction, whose connection queues
        // them anyway, and pg 9 removes that queueing (docs/developers/conventions-data.md).
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

  // The full daily close for ONE explicit business day (unlike overview, which anchors on TODAY): the
  // VAT summary, the cash-up and record counts (`computeDailyClose`) plus that day's top sellers.
  // Node-scoped, gated on `report.view`. `businessDay` is screened to a real "YYYY-MM-DD" at the
  // boundary; money crosses the wire as decimal STRINGS.
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

  // A VAT summary + top sellers over a closed business-day RANGE (`from`..`to`, inclusive) for THIS
  // node — the period roll-up behind the dashboard's date-range view. Node-scoped, gated on
  // `report.view`. `from`/`to` are each screened to a real "YYYY-MM-DD", and an inverted range
  // (`from > to`) is a request fault (400) — a valid string compare because both passed
  // `requirePeriod`'s fixed-shape check, exactly as `validateBusinessDayRange` orders them.
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

  // The manager overview's "orders taking too long" list (KDS order-timing alerts, design §7.4): THIS
  // node's currently-open kitchen orders whose worst unserved line is overdue/forgotten, worst-first.
  // A live snapshot, not a business-day query — `buildReportContext` is reused for its `nodeId`
  // only; its `clock` is irrelevant here (no business day involved) and left unused.
  // Gated on `report.view`, the same seam the dashboard's other three live/period reads use.
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
