import { tableInService } from "@waitron/db";
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  addDecimal,
  AppError,
  decimal,
  nodeId as brandNodeId,
  type BusinessDayClock,
  type NodeId,
  type SupportedLocale,
} from "@waitron/shared";
import {
  devices,
  printers,
  readHistoryNodes,
  readTenant,
  recordActivity,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  CATEGORY_REPORT_MODES,
  computeCategorySales,
  readDailyClose,
  computeDailyClose,
  computeOverdueOrders,
  computeTopSellers,
  computeVatReturn,
  computeVatSummaryForPeriod,
  currentBusinessDay,
  resolveVenueClock,
  mapModelo303,
  parsePeriodToken,
  toDr303Record,
  type CashUp,
  type CategoryReport,
  type CategoryReportMode,
  type DailyClose,
  type LiquidationPeriod,
} from "@waitron/reporting";
import { currentClassifications } from "@waitron/catalogue";
import { enqueuePrintJob } from "@waitron/printing";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody, requireBodyUuid, requireEnum } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { requirePeriod, requireRange } from "@waitron/server-kit";
import { formatCategorySalesPage } from "./category-sales-page.js";
import { toLanguage } from "./personal-data-export-api.js";
import { listTransferClosedInvoices, renderTransferClosedCsv } from "./transfer-closed-export.js";
import { listAccountantExport, renderAccountantWorkbook } from "./accountant-export.js";
import { resolveSessionLocale } from "./session-locale.js";
import { readHandoverIntervals } from "./handover-intervals.js";
import type { Logger } from "./logger.js";

/**
 * On a mirror the data node is the ORIGIN recorded in node.db's `node_mirror_link`, not the
 * mirror's own id. Per-node reports use it; venue-wide reports read every node.
 */
export interface ReportApiDeps {
  db: Database;
  cfg: { nodeId: string };
  /** The printed page's language when neither the person nor the browser names one, and always the
   * download language. */
  venueLocale: SupportedLocale;
}

const REPORT_EXPORT_PERMISSION: Permission = "report.export";
const REPORT_VIEW_PERMISSION: Permission = "report.view";

/** Client faults only; anything else reaches `run` as a server fault. */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "printer.not_found": 404,
  // Today's catalogue fails the checks a sale's snapshot passes, as the till route answers it.
  "sale_classification.invalid": 409,
};

interface CategoryRequest {
  from: string;
  to: string;
  mode: CategoryReportMode;
  extrasIntoDish: boolean;
}

/** Absent is false; the query string spells a flag "true" or "false". */
export function queryFlag(raw: string | undefined, field: string): boolean {
  if (raw === undefined) return false;
  if (raw === "true" || raw === "false") return raw === "true";
  throw new AppError("management.request_invalid", { field });
}

function bodyFlag(raw: unknown, field: string): boolean {
  if (raw === undefined) return false;
  if (typeof raw === "boolean") return raw;
  throw new AppError("management.request_invalid", { field });
}

const run = createErrorBoundary(STATUS, "report.failed");
// A category report print names its printer only in the body's `printerId`.
const runCategoryPrint = createErrorBoundary(
  { ...STATUS, "printer.not_found": 400 },
  "report.failed",
);

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

export { resolveVenueClock } from "@waitron/reporting";

async function countOpenTables(tx: Transaction): Promise<{ open: number; total: number }> {
  // `cast(x as text)`: this engine has no `::` operator, and text keeps both counts one type for
  // `Number()`. A table is open while a party holds it (an active membership).
  const { rows } = await tx.execute<{ total: string; open: string }>(sql`
    select cast(count(*) as text) as total,
           cast(count(*) filter (where exists (
             select 1 from party_tables pt where pt.table_id = dt.id and pt.left_at is null
           )) as text) as open
    from dining_tables dt
    where ${tableInService(sql`dt.id`)}
  `);
  return { open: Number(rows[0]!.open), total: Number(rows[0]!.total) };
}

/**
 * Mount reporting routes through the shared authorization gate. report.view
 * permits operational reports; report.export permits the modelo 303 export and the
 * deferred-payments file.
 * The overview aggregates all tenant nodes; per-node reports read cfg.nodeId and the boxes it took
 * over from.
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

  // Every per-node route derives its boxes and venue clock here, so they cannot drift. The boxes
  // are this one and every box it took over from.
  const buildReportContext = async (
    tx: Transaction,
  ): Promise<{
    nodeIds: readonly NodeId[];
    clock: BusinessDayClock;
  }> => {
    const nodeIds = await readHistoryNodes(tx, brandNodeId(deps.cfg.nodeId));
    const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
    return { nodeIds, clock };
  };

  const categoryReport = async (tx: Transaction, req: CategoryRequest): Promise<CategoryReport> => {
    const { nodeIds, clock } = await buildReportContext(tx);
    return computeCategorySales(
      tx,
      {
        nodeIds,
        fromBusinessDay: req.from,
        toBusinessDay: req.to,
        timeZone: clock.timeZone,
        dayCutover: clock.dayCutover,
        cutoverChanges: clock.cutoverChanges,
        mode: req.mode,
        extrasIntoDish: req.extrasIntoDish,
      },
      req.mode === "current" ? (ids) => currentClassifications(tx, ids) : undefined,
    );
  };

  const activePrinters = () => eq(printers.active, true);

  app.get("/management-api/reports/handover-intervals", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => ({
        intervals: await readHandoverIntervals(tx),
        timeZone: (await resolveVenueClock(tx, deps.cfg.nodeId)).timeZone,
      }));
      c.header("Cache-Control", "no-store");
      return c.json(result);
    }),
  );

  app.get("/management-api/reports/modelo-303", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const year = requireYear(c.req.query("year"));
      const { period, token } = requireLiquidationPeriod(c.req.query("period"));
      const declarationType = requireDeclarationType(c.req.query("declarationType"));

      const record = await gated(sessionId, REPORT_EXPORT_PERMISSION, async (tx) => {
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

  // The overview aggregates every node for the venue's CURRENT business day.
  app.get("/management-api/reports/overview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
        const businessDay = currentBusinessDay(clock);
        // No `nodeIds`: venue-wide.
        const input = {
          businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
          cutoverChanges: clock.cutoverChanges,
        };
        // Awaited in turn, never `Promise.all`: they share one transaction (CLAUDE.md §3).
        const close = await computeDailyClose(tx, input);
        const topSellers = await computeTopSellers(tx, {
          fromBusinessDay: businessDay,
          toBusinessDay: businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
          cutoverChanges: clock.cutoverChanges,
          limit: 5,
        });
        const openTables = await countOpenTables(tx);
        const closureSummary = summariseClosures(close);
        return {
          businessDay,
          takings: {
            tenderTotal: close.cash.tenderTotal,
            tipTotal: close.cash.tipTotal,
            grossTotal: close.vat.grossTotal,
          },
          closureSummary,
          departmentTakings: close.departmentTakings,
          counts: close.counts,
          openTables,
          topSellers,
        };
      });
      return c.json(result);
    }),
  );

  // The full daily close and top sellers for ONE explicit business day.
  app.get("/management-api/reports/daily-close", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const businessDay = requirePeriod(c.req.query("businessDay"), "businessDay");
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { nodeIds, clock } = await buildReportContext(tx);
        const input = {
          nodeIds,
          businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
          cutoverChanges: clock.cutoverChanges,
        };
        // Sequential, not Promise.all: both reads share ONE transaction (see the overview route).
        const close = await readDailyClose(tx, input);
        const topSellers = await computeTopSellers(tx, {
          nodeIds,
          fromBusinessDay: businessDay,
          toBusinessDay: businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
          cutoverChanges: clock.cutoverChanges,
          limit: 10,
        });
        const cash = await namedCashUp(tx, close.cash);
        const closureSummary = summariseClosures(close);
        return {
          businessDay,
          vat: close.vat,
          cash,
          closureSummary,
          departmentTakings: close.departmentTakings,
          counts: close.counts,
          topSellers,
        };
      });
      return c.json(result);
    }),
  );

  // VAT summary and top sellers over an inclusive business-day range.
  app.get("/management-api/reports/period", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { from, to } = requireRange(c.req.query("from"), c.req.query("to"));
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { nodeIds, clock } = await buildReportContext(tx);
        const common = {
          nodeIds,
          fromBusinessDay: from,
          toBusinessDay: to,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
          cutoverChanges: clock.cutoverChanges,
        };
        // Sequential, not Promise.all: both reads share ONE transaction (see the overview route).
        const vat = await computeVatSummaryForPeriod(tx, common);
        const topSellers = await computeTopSellers(tx, { ...common, limit: 10 });
        return { from, to, vat, topSellers };
      });
      return c.json(result);
    }),
  );

  // The accountant's file of invoices whose bills were closed as deferred payments on a business
  // day in an inclusive range, venue-wide. A POST because each download writes its activity entry.
  app.post("/management-api/reports/closed-by-transfer", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { from, to } = requireRange(c.req.query("from"), c.req.query("to"));
      const rows = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: REPORT_EXPORT_PERMISSION,
        });
        const invoices = await listTransferClosedInvoices(tx, { from, to });
        await recordActivity(tx, {
          kind: "transfer_export.downloaded",
          subjectId: "closed-by-transfer",
          personId: authorizedBy,
          data: { from, to, rows: invoices.length },
        });
        return invoices;
      });
      return c.body(renderTransferClosedCsv(rows, toLanguage(deps.venueLocale)), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="deferred-payments-${from}-${to}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    }),
  );

  app.post("/management-api/reports/accountant-export", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { from, to } = requireRange(c.req.query("from"), c.req.query("to"));
      const data = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: REPORT_EXPORT_PERMISSION,
        });
        const data = await listAccountantExport(tx, { from, to });
        await recordActivity(tx, {
          kind: "accountant_export.downloaded",
          subjectId: "accountant-export",
          personId: authorizedBy,
          data: { from, to, invoices: data.invoices.length, purchases: data.purchases.length },
        });
        return data;
      });
      return c.body(await renderAccountantWorkbook(data, toLanguage(deps.venueLocale)), 200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="accountant-${from}-${to}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    }),
  );

  // Sales by reporting category over an inclusive business-day range.
  app.get("/management-api/reports/categories", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const req: CategoryRequest = {
        ...requireRange(c.req.query("from"), c.req.query("to")),
        mode: requireEnum(c.req.query("mode"), "mode", CATEGORY_REPORT_MODES),
        extrasIntoDish: queryFlag(c.req.query("extrasIntoDish"), "extrasIntoDish"),
      };
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, (tx) =>
        categoryReport(tx, req),
      );
      return c.json(result);
    }),
  );

  // The printers a report may be printed on. The printer settings list needs `hardware.manage`,
  // which a supervisor printing a report does not hold.
  app.get("/management-api/reports/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, REPORT_VIEW_PERMISSION, (tx) =>
        tx
          .select({ id: printers.id, name: printers.name })
          .from(printers)
          .where(activePrinters())
          .orderBy(asc(printers.name), asc(printers.id)),
      );
      return c.json(rows);
    }),
  );

  app.post("/management-api/reports/categories/print", (c) =>
    runCategoryPrint(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const req: CategoryRequest = {
        ...requireRange(body.from, body.to),
        mode: requireEnum(body.mode, "mode", CATEGORY_REPORT_MODES),
        extrasIntoDish: bodyFlag(body.extrasIntoDish, "extrasIntoDish"),
      };
      const printerId = requireBodyUuid(body.printerId, "printerId");
      const queued = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const [printer] = await tx
          .select({
            paperWidth: printers.paperWidth,
            resolution: printers.resolution,
          })
          .from(printers)
          .where(and(eq(printers.id, printerId), activePrinters()));
        if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });
        const report = await categoryReport(tx, req);
        const locale = await resolveSessionLocale(
          tx,
          sessionId,
          c.req.header("Accept-Language"),
          deps.venueLocale,
        );
        const payload = formatCategorySalesPage({ ...req, report, locale, printer });
        return enqueuePrintJob(tx, printerId, payload);
      });
      return c.json(queued, 202);
    }),
  );

  // The venue's open kitchen orders whose worst unserved line is overdue, worst first. A live
  // snapshot.
  app.get("/management-api/reports/overdue-orders", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const orders = await gated(sessionId, REPORT_VIEW_PERMISSION, (tx) =>
        computeOverdueOrders(tx),
      );
      return c.json({ orders });
    }),
  );
}

/** A transfer line is a final classification, never money received, so it stays out of `received`. */
function summariseClosures(close: DailyClose) {
  const cash = close.cash;
  const billsClosed = close.departmentTakings.reduce(
    (total, row) => ({
      count: total.count + row.billsClosed.count,
      total: addDecimal(total.total, row.billsClosed.total),
    }),
    { count: 0, total: decimal("0.00") },
  );
  let toBePaidByTransfer = decimal("0.00");
  let received = decimal("0.00");
  for (const line of cash.byOrigin.flatMap((row) => row.byMethod)) {
    if (line.method === "transfer")
      toBePaidByTransfer = addDecimal(toBePaidByTransfer, line.amount);
    else received = addDecimal(received, line.amount);
  }
  return { billsClosed, toBePaidByTransfer, received };
}

/**
 * The cash-up with each device row's name. Read with no `active` filter, so a device revoked after
 * it took money is still named on the day it took it.
 */
async function namedCashUp(tx: Transaction, cash: CashUp) {
  const ids = cash.byOrigin.flatMap((row) => (row.deviceId === null ? [] : [row.deviceId]));
  const named =
    ids.length === 0
      ? []
      : await tx
          .select({ id: devices.id, label: devices.label })
          .from(devices)
          .where(inArray(devices.id, ids));
  const names = new Map(named.map((row) => [row.id, row.label]));
  return {
    ...cash,
    byOrigin: cash.byOrigin.map((row) => ({
      ...row,
      deviceName: row.deviceId === null ? null : (names.get(row.deviceId) ?? null),
    })),
  };
}
