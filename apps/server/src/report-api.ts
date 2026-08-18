// Side-effect: loads this host's `management.request_invalid` augmentation (the query screens below
// throw it directly), under the "every file that throws one imports ./errors.js" convention. The auth
// codes (`management_session.*`, `person.suspended`, `authorization.not_permitted`) are declared in
// @waitron/identity and load via the `authorizeManager`/`requireManagementSession` value imports.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq } from "drizzle-orm";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import { asAppUser, tenants, withTenant, type Database, type Transaction } from "@waitron/db";
import {
  computeVatReturn,
  mapModelo303,
  parsePeriodToken,
  toDr303Record,
  type LiquidationPeriod,
} from "@waitron/reporting";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { requireManagementSession } from "./management-session.js";
import type { Logger } from "./logger.js";

/** Deps for the reporting/export routes: `db` + this venue's `cfg.tenantId` scope every read via
 * `withTenant` (RLS confines it to this server's one tenant). Same minimal shape as PurchasingApiDeps
 * — no nodeId, no card provider, no clock: the routes are pure reads over the filed record. */
export interface ReportApiDeps {
  db: Database;
  cfg: { tenantId: string };
}

/** The ONE permission gating the modelo 303 export — a NEW domain-named reporting seam (spec D7),
 * mapped to manager + admin. One constant, referenced at the route, so a future re-map is a one-line
 * swap here. */
const REPORT_EXPORT_PERMISSION: Permission = "report.export";

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

/** Screen the `year` query param: a 4-digit integer, else `management.request_invalid` {field:"year"}
 * (never a downstream make_date error). */
function requireYear(raw: string | undefined): number {
  if (raw === undefined || !/^\d{4}$/.test(raw)) {
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
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: REPORT_EXPORT_PERMISSION,
      });
      return fn(tx);
    });

  app.get("/management-api/reports/modelo-303", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const year = requireYear(c.req.query("year"));
      const { period, token } = requireLiquidationPeriod(c.req.query("period"));
      const declarationType = requireDeclarationType(c.req.query("declarationType"));

      const record = await gated(sessionId, async (tx) => {
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
}
