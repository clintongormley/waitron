import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountReportApi } from "./report-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

// Real Postgres, not PGlite: this suite refuses the modelo 303 export and the overview to a staff
// session, with every DB touch under test going through the route's own `withTenant` + `asAppUser`,
// so the reads run as the non-superuser app role rather than the superuser the harness hands out
// (CLAUDE.md §4). Only the `report.export` case carries a guard-by-deletion receipt (recorded on it);
// the `report.view` case asserts the refusal without one. The route mechanics (year/period/
// declarationType screens, STATUS map, the 2944-byte ISO-8859-1 body) are already proven in-process on
// PGlite (`report-api.test.ts`), and the overview tile in `report-api.overview.test.ts` — so with the
// two gates as its only remaining subject this file is a candidate for the PGlite tier once the suites
// are re-tagged.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the produced bytes matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter the sibling real-Postgres suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  nodeId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `report.export`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then — as the app role under the tenant, so RLS
 * is exercised on the write side too — seed a MANAGER (role `manager`, holds `report.export`) and a
 * STAFF person (role `staff`, holds nothing) and mint a live management session for each. Each test
 * gets its OWN tenant(s), so its reads are that test's alone and order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<Venue> {
  const taxId = nextNif();
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId,
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  const { managerSid, staffSid } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: stf.rows[0]!.id,
    });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });

  return {
    tenantId: venue.tenantId,
    nodeId: venue.nodeId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** One Hono app per venue — `mountReportApi` binds ONE (tenant, node) via `cfg`, so each venue's route
 * needs its own app (mirrors `purchasing-api.pg.test.ts`). The `nodeId` scopes the overview route; the
 * modelo 303 export ignores it. */
function mountApp(v: Pick<Venue, "tenantId" | "nodeId">): Hono {
  const app = new Hono();
  mountReportApi(
    app,
    { db: suite.admin, cfg: { tenantId: v.tenantId, nodeId: v.nodeId } },
    noopLog,
  );
  return app;
}

/** GET the modelo 303 file for a period, carrying `cookie`. */
async function download(
  app: Hono,
  cookie: string,
  year: string,
  period: string,
  declarationType: string,
): Promise<Response> {
  return app.request(
    `/management-api/reports/modelo-303?year=${year}&period=${period}&declarationType=${declarationType}`,
    { method: "GET", headers: { cookie } },
  );
}

describe("mountReportApi — modelo 303 export over real Postgres (the report.export gate)", () => {
  it("refuses the export to a staff-role session — 403 (gate by deletion)", async () => {
    // Prove the `report.export` gate BY DELETION. A `staff`-role management session holds no
    // `report.export`, so `authorizeManager` (inside `gated`) throws `authorization.not_permitted`
    // before any read runs — a 403.
    //
    // GUARD-BY-DELETION (authorizeManager), run 2026-08-18 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed the
    //   `await authorizeManager(tx, { managementSessionId: sessionId, permission: REPORT_EXPORT_PERMISSION });`
    // call from `report-api.ts`'s `gated` helper. This test then FAILED — the staff request returned
    // 200 (the file) instead of 403, so the `toBe(403)` assertion flipped GREEN→RED. Restored the line
    // and the test passed again; `git diff report-api.ts` is clean afterwards.
    const v = await setupVenue();
    const res = await download(mountApp(v), v.staffCookie, "2026", "08", "I");
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });
});

describe("mountReportApi — /reports/overview over real Postgres (the report.view gate)", () => {
  it("refuses the overview to a staff-role session — 403 (report.view gate)", async () => {
    // A `staff`-role session holds no `report.view`, so `authorizeManager` throws
    // `authorization.not_permitted` before any read — a 403, the counterpart to the export gate above.
    const v = await setupVenue();
    const res = await mountApp(v).request("/management-api/reports/overview", {
      method: "GET",
      headers: { cookie: v.staffCookie },
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });
});
