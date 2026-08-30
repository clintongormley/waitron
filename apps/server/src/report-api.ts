// Side-effect: loads this host's `management.request_invalid` augmentation (the query screens below
// throw it directly), under the "every file that throws one imports ./errors.js" convention. The auth
// codes (`management_session.*`, `person.suspended`, `authorization.not_permitted`) are declared in
// @waitron/identity and load via the `authorizeManager`/`requireManagementSession` value imports.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq, sql } from "drizzle-orm";
import {
  AppError,
  nodeId as brandNodeId,
  tenantId as brandTenantId,
  type NodeId,
  type TenantId,
} from "@waitron/shared";
import { asAppUser, tenants, withTenant, type Database, type Transaction } from "@waitron/db";
import {
  computeDailyClose,
  computeTopSellers,
  computeVatReturn,
  computeVatSummaryForPeriod,
  currentBusinessDay,
  mapModelo303,
  parsePeriodToken,
  toDr303Record,
  validateBusinessDay,
  type LiquidationPeriod,
} from "@waitron/reporting";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { requireManagementSession } from "./management-session.js";
import type { Logger } from "./logger.js";

/** Deps for the reporting/export routes: `db` + this venue's `cfg.tenantId` scope every read via
 * `withTenant` (RLS confines it to this server's one tenant). `cfg.nodeId` is THIS server's own node —
 * the dashboard overview is node-scoped (today's takings/counts/open-tables/top-sellers for this node),
 * unlike the modelo 303 export, which aggregates ALL of the obligado's nodes and ignores it. */
export interface ReportApiDeps {
  db: Database;
  cfg: { tenantId: string; nodeId: string };
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

/** Screen a business-day query param ("YYYY-MM-DD") the SAME way `requireLiquidationPeriod` screens
 * `period`: pre-validate at the request boundary so a bad value becomes `management.request_invalid`
 * {field} (400) here, never a plain `Error` from the reporting layer's own `validateBusinessDay` (which
 * `computeDailyClose`/`computeVatSummaryForPeriod`/`computeTopSellers` call downstream) reaching `run`
 * as an opaque `server.internal` 500. `validateBusinessDay` rejects both a malformed shape and a
 * well-formed-but-impossible date (e.g. "2026-02-30"); its throw is translated, not propagated.
 * `field` distinguishes `businessDay` (daily-close) from `from`/`to` (period). */
function requireBusinessDay(raw: string | undefined, field: string): string {
  if (raw === undefined || raw === "") {
    throw new AppError("management.request_invalid", { field });
  }
  try {
    validateBusinessDay(raw);
  } catch {
    throw new AppError("management.request_invalid", { field });
  }
  return raw;
}

/** Reads THIS server's venue clock — the `time_zone`/`day_cutover` of the node's location — the inputs
 * `currentBusinessDay`/`computeDailyClose` consume (spec D9). `day_cutover` is a `time` ("HH:MM:SS"),
 * sliced to the "HH:MM" the reporting validators expect. A missing node is not user input: `cfg.nodeId`
 * is this server's OWN node (from `till.nodeId`), whose location row always exists (composite FK), so
 * the guard is an unreachable invariant break → an opaque 500 via `run`, never a registered code (the
 * `tenants`-row guard in the modelo 303 route below does the same). */
async function resolveVenueClock(
  tx: Transaction,
  nodeId: string,
): Promise<{ timeZone: string; dayCutover: string }> {
  const { rows } = await tx.execute<{ time_zone: string; day_cutover: string }>(sql`
    select l.time_zone, l.day_cutover
    from nodes n join locations l on l.tenant_id = n.tenant_id and l.id = n.location_id
    where n.id = ${nodeId}
  `);
  const row = rows[0];
  /* v8 ignore start */
  if (row === undefined) {
    // Unreachable: this server's own node + its location always exist (mirrors the modelo 303 route's
    // whoami-style tenant guard). A misconfigured node becomes an opaque 500 via `run`.
    throw new Error(`report-api: no node/location row for ${nodeId}`);
  }
  /* v8 ignore stop */
  return { timeZone: row.time_zone, dayCutover: row.day_cutover.slice(0, 5) };
}

/** Counts THIS node's dining tables and how many carry an open tab, for the overview's open-tables tile.
 * `dining_tables` is LOCATION-scoped, not node-scoped, so it is scoped by the node's location (join
 * `nodes` on the tenant-consistent `location_id`); `tab_id is not null` is the open flag (design §2b).
 * Inactive tables (deactivated, `active = false`) are excluded. The explicit `tenant_id` predicate is
 * belt-and-suspenders over RLS, the aggregate idiom the reporting reads use. */
async function countOpenTables(
  tx: Transaction,
  tenantId: TenantId,
  nodeId: NodeId,
): Promise<{ open: number; total: number }> {
  const { rows } = await tx.execute<{ total: string; open: string }>(sql`
    select count(*)::text as total,
           count(*) filter (where dt.tab_id is not null)::text as open
    from dining_tables dt
    join nodes n on n.tenant_id = dt.tenant_id and n.location_id = dt.location_id
    where dt.tenant_id = ${tenantId} and n.id = ${nodeId} and dt.active = true
  `);
  return { open: Number(rows[0]!.open), total: Number(rows[0]!.total) };
}

/**
 * Mounts the gated modelo 303 export route on an existing Hono app — `mountPurchasingApi`'s sibling,
 * attached to the SAME app. `GET /management-api/reports/modelo-303?year&period&declarationType`
 * returns the AEAT DR303 fixed-layout file (ISO-8859-1) for the period. Every DB touch funnels
 * through `gated` (withTenant + asAppUser + authorizeManager(report.export)), so RLS scopes the read
 * to this server's one tenant and the gate runs in one place.
 *
 * PRE-FILING CAVEATS (unchanged from dr303.ts §29-38): the produced file is a CANDIDATE, not a proven
 * submission-ready one — página 2 is omitted (validate once against the real sede uploader), and under
 * prorrata the base is emitted unscaled pending an asesor confirmation.
 */
export function mountReportApi(app: Hono, deps: ReportApiDeps, log: Logger): void {
  const gated = <T>(
    sessionId: string,
    permission: Permission,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission });
      return fn(tx);
    });

  // The (tenantId, nodeId, clock) triple every reporting route below derives identically — extracted
  // so overview/daily-close/period cannot drift on branding or on how the venue clock is resolved.
  // Closes over `deps` (unlike `resolveVenueClock`, which is a top-level function taking `nodeId`
  // explicitly); the modelo-303 route above does NOT use this, since it derives its own `tenantId`
  // from the authoritative `tenants` row rather than from `deps.cfg`.
  const buildReportContext = async (
    tx: Transaction,
  ): Promise<{
    tenantId: TenantId;
    nodeId: NodeId;
    clock: { timeZone: string; dayCutover: string };
  }> => {
    const tenantId = brandTenantId(deps.cfg.tenantId);
    const nodeId = brandNodeId(deps.cfg.nodeId);
    const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
    return { tenantId, nodeId, clock };
  };

  app.get("/management-api/reports/modelo-303", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const year = requireYear(c.req.query("year"));
      const { period, token } = requireLiquidationPeriod(c.req.query("period"));
      const declarationType = requireDeclarationType(c.req.query("declarationType"));

      const record = await gated(sessionId, REPORT_EXPORT_PERMISSION, async (tx) => {
        // The obligado identity comes from the authoritative tenant row (RLS-scoped), not a client
        // param — the till-api whoami idiom. Structurally present: cfg.tenantId is this server's own.
        const [issuer] = await tx
          .select({ taxId: tenants.taxId, name: tenants.legalName })
          .from(tenants)
          .where(eq(tenants.id, deps.cfg.tenantId));
        /* v8 ignore start */
        if (issuer === undefined) {
          // Unreachable: this server's own tenant row always exists and RLS returns it (mirrors
          // till-api.ts's whoami guard). A misconfigured tenant becomes an opaque 500 via `run`.
          throw new Error(`report-api: no tenant row for ${deps.cfg.tenantId}`);
        }
        /* v8 ignore stop */
        // `VatReturnInput.tenantId` is the branded `TenantId`, but `cfg.tenantId` is a plain string
        // (the deps shape the siblings share). Brand it here — the demo's `brandTenantId(...)` idiom —
        // so the read is typed; `withTenant` above still takes the plain string, as purchasing-api does.
        const vatReturn = await computeVatReturn(tx, {
          tenantId: brandTenantId(deps.cfg.tenantId),
          year,
          period,
        });
        const modelo = mapModelo303(vatReturn);
        // options.period === the SAME period token parsed above, so the writer's envelope cross-check
        // (monthly) can never mismatch the aggregate (spec D4).
        return toDr303Record(modelo, {
          taxId: issuer.taxId,
          name: issuer.name,
          year,
          period: token,
          declarationType,
        });
      });

      // ISO-8859-1 fixed-layout file: `record` is a latin1-encoded Buffer; `new Uint8Array` narrows it
      // to Uint8Array<ArrayBuffer> for `c.body` (the media-api idiom). It is a per-request fiscal
      // document behind auth → never cached; a download → Content-Disposition attachment.
      return c.body(new Uint8Array(record), 200, {
        "Content-Type": "text/plain; charset=ISO-8859-1",
        "Content-Disposition": `attachment; filename="modelo-303-${year}-${token}.txt"`,
        "Cache-Control": "no-store",
      });
    }),
  );

  // The dashboard's sales/takings overview for THIS node, TODAY: takings (tender + tip + gross), the
  // record counts, the open-tables tile and the top sellers — the venue clock (node's location) decides
  // "today". Node-scoped (unlike the tenant-wide modelo 303 export), gated on `report.view`. Money
  // crosses the wire as decimal STRINGS (the branded `Decimal` JSON-stringifies as-is).
  app.get("/management-api/reports/overview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { tenantId, nodeId, clock } = await buildReportContext(tx);
        const businessDay = await currentBusinessDay(tx, clock);
        const input = {
          tenantId,
          nodeId,
          businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
        };
        const [close, topSellers, openTables] = await Promise.all([
          computeDailyClose(tx, input),
          computeTopSellers(tx, {
            tenantId,
            nodeId,
            fromBusinessDay: businessDay,
            toBusinessDay: businessDay,
            timeZone: clock.timeZone,
            dayCutover: clock.dayCutover,
            limit: 5,
          }),
          countOpenTables(tx, tenantId, nodeId),
        ]);
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
      const businessDay = requireBusinessDay(c.req.query("businessDay"), "businessDay");
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { tenantId, nodeId, clock } = await buildReportContext(tx);
        const input = {
          tenantId,
          nodeId,
          businessDay,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
        };
        const [close, topSellers] = await Promise.all([
          computeDailyClose(tx, input),
          computeTopSellers(tx, {
            tenantId,
            nodeId,
            fromBusinessDay: businessDay,
            toBusinessDay: businessDay,
            timeZone: clock.timeZone,
            dayCutover: clock.dayCutover,
            limit: 10,
          }),
        ]);
        return { businessDay, vat: close.vat, cash: close.cash, counts: close.counts, topSellers };
      });
      return c.json(result);
    }),
  );

  // A VAT summary + top sellers over a closed business-day RANGE (`from`..`to`, inclusive) for THIS
  // node — the period roll-up behind the dashboard's date-range view. Node-scoped, gated on
  // `report.view`. `from`/`to` are each screened to a real "YYYY-MM-DD", and an inverted range
  // (`from > to`) is a request fault (400) — a valid string compare because both passed
  // `validateBusinessDay`'s fixed-shape check, exactly as `validateBusinessDayRange` orders them.
  app.get("/management-api/reports/period", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const from = requireBusinessDay(c.req.query("from"), "from");
      const to = requireBusinessDay(c.req.query("to"), "to");
      if (from > to) {
        throw new AppError("management.request_invalid", { field: "range" });
      }
      const result = await gated(sessionId, REPORT_VIEW_PERMISSION, async (tx) => {
        const { tenantId, nodeId, clock } = await buildReportContext(tx);
        const common = {
          tenantId,
          nodeId,
          fromBusinessDay: from,
          toBusinessDay: to,
          timeZone: clock.timeZone,
          dayCutover: clock.dayCutover,
        };
        const [vat, topSellers] = await Promise.all([
          computeVatSummaryForPeriod(tx, common),
          computeTopSellers(tx, { ...common, limit: 10 }),
        ]);
        return { from, to, vat, topSellers };
      });
      return c.json(result);
    }),
  );
}
