import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { FIXTURE_CERT_PEM } from "./testing/tls-fixture.js";

// Real Postgres, not PGlite: the route AUTHORIZES with `authorizeManager`, which reads
// persons + management_sessions under the app role's RLS, and reads the tenant's `cadenas` chain row —
// both false passes on PGlite's superuser connection (CLAUDE.md §4). The manager-login harness
// (`applyVenue`/`planVenue` + password `login`) is the one `management-api.status.test.ts` uses.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the seeded manager's dashboard password.
// Dashboard sign-in resolves the person by EMAIL, so the seeded manager carries a login email
// (per-tenant unique — persons_tenant_email_uq).
const MANAGER_EMAIL = "manager@x.com";

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
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (current_tenant_id(), 'The Manager', ${MANAGER_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')
      returning id`);
    return manager.rows[0]!.id;
  });
  return { tenantId: venue.tenantId, nodeId: venue.nodeId, managerId };
}

/**
 * A Hono app carrying the management API (for its login route) plus the box-status route under test.
 * Both surfaces share the owner db + tenant, so a cookie minted on one resolves on the other. `now`
 * feeds BOTH the cert reader and the duties snapshot; `tlsCertPath` toggles the cert branch.
 */
function buildApp(
  tenantId: string,
  nodeId: string,
  opts: { now: Date; tlsCertPath: string | undefined },
): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId, nodeId },
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
      health: createHealthState(opts.now),
      now: () => opts.now,
      tlsCertPath: opts.tlsCertPath,
      readReplicationLag: undefined,
      readBackup: undefined,
      readMode: () => "primary",
      readSingletonRole: () => "primary",
    },
    () => {},
  );
  return app;
}

/** Log in over HTTP by `email`, returning just the `waitron_management_session=…` cookie pair. */
async function login(app: Hono, email: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

describe("GET /api/box/status (real postgres)", () => {
  let app: Hono;
  let managerCookie: string;

  beforeAll(async () => {
    const { tenantId, nodeId } = await setupTenant();
    app = buildApp(tenantId, nodeId, {
      now: new Date("2026-08-29T10:00:00Z"),
      tlsCertPath: undefined,
    });
    managerCookie = await login(app, MANAGER_EMAIL);
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
    expect(body.singletonRole).toBe("primary");
    expect(body.environment).toBe("preproduction");
    expect(body.cert).toEqual({ available: false }); // tlsCertPath undefined
    expect(body.replication).toEqual({ configured: false }); // no lag reader
    expect(body.backup).toEqual({ configured: false });
    expect(body.time.source).toMatch(/timedatectl|unavailable/);
  });
});

describe("GET /api/box/status with a configured TLS cert (real postgres)", () => {
  let app: Hono;
  let managerCookie: string;

  beforeAll(async () => {
    const { tenantId, nodeId } = await setupTenant();
    // A real leaf on disk exercises the cert-configured branch + `readCertExpiry` closure end-to-end
    // (the undefined-cert suite above never touches them). `now` is 30 days before the fixture's
    // notAfter, so `daysRemaining` is a deterministic 30.
    const certPath = join(mkdtempSync(join(tmpdir(), "box-status-cert-")), "server.crt");
    writeFileSync(certPath, FIXTURE_CERT_PEM);
    app = buildApp(tenantId, nodeId, {
      now: new Date("2036-07-27T13:07:51.000Z"),
      tlsCertPath: certPath,
    });
    managerCookie = await login(app, MANAGER_EMAIL);
  });

  it("reports cert.available:true with the fixture's notAfter and daysRemaining", async () => {
    const res = await app.request("/api/box/status", { headers: { cookie: managerCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cert).toEqual({
      available: true,
      notAfter: "2036-08-26T13:07:51.000Z",
      daysRemaining: 30,
    });
  });
});
