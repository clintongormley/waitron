import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { createHealthState } from "./health.js";
import { mountBoxStatusApi } from "./box-status.js";
import { mountManagementApi } from "./management-api.js";

// Real Postgres, not PGlite: the route AUTHORIZES with `authorizeManager`, which reads
// persons + management_sessions under the app role's RLS, and reads the tenant's `cadenas` chain row —
// both false passes on PGlite's superuser connection (CLAUDE.md §4). The manager-login harness
// (`applyVenue`/`planVenue` + password `login`) is the one `management-api.status.test.ts` uses.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the seeded manager's dashboard password.
const NOW = new Date("2026-08-29T10:00:00Z");

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so the provisioned venue needs its own NIF — the same per-suite counter the sibling suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then seed — as the app role under the tenant, so
 * RLS is exercised — a MANAGER (role `manager`, which holds `till.configure`) WITH a dashboard
 * password so it can log in. Provisioning creates only the ADMIN, so the manager is seeded directly;
 * `pin_hash` is NOT NULL, so a value is supplied even though it logs in by password.
 */
async function setupTenant(): Promise<{ tenantId: string; nodeId: string; managerId: string }> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
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
    }),
    { db: suite.admin },
  );

  const managerId = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const manager = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')
      returning id`);
    return manager.rows[0]!.id;
  });
  return { tenantId: venue.tenantId, nodeId: venue.nodeId, managerId };
}

/** Log in over HTTP as `personId`, returning just the `waitron_management_session=…` cookie pair. */
async function login(app: Hono, personId: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

describe("GET /api/box/status (real postgres)", () => {
  let app: Hono;
  let managerCookie: string;

  beforeAll(async () => {
    const { tenantId, nodeId, managerId } = await setupTenant();
    app = new Hono();
    // The management API is mounted only for its login route, so the box-status route can be exercised
    // with a real manager session cookie; both surfaces share the same owner db + tenant, so a cookie
    // minted on one resolves on the other.
    mountManagementApi(
      app,
      {
        db: suite.admin,
        cfg: { tenantId },
        secureCookies: false,
        rpId: "localhost",
        origin: "http://localhost",
      },
      () => {},
    );
    mountBoxStatusApi(
      app,
      {
        db: suite.admin,
        cfg: { tenantId, nodeId },
        environment: "preproduction",
        health: createHealthState(NOW),
        now: () => NOW,
        tlsCertPath: undefined,
        readReplicationLag: undefined,
      },
      () => {},
    );
    managerCookie = await login(app, managerId);
  });

  it("401s without a management session", async () => {
    const res = await app.request("/api/box/status");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
  });

  it("200s with the composed status for an authenticated manager", async () => {
    const res = await app.request("/api/box/status", { headers: { cookie: managerCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("primary");
    expect(body.environment).toBe("preproduction");
    expect(body.cert).toEqual({ available: false }); // tlsCertPath undefined
    expect(body.replication).toEqual({ configured: false }); // no lag reader
    expect(body.backup).toEqual({ configured: false });
    expect(body.time.source).toMatch(/timedatectl|unavailable/);
  });
});
