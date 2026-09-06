import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { DrainProgress } from "@waitron/sync";
import { createHealthState } from "./health.js";
import { mountBoxStatusApi } from "./box-status.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";

// Real Postgres, not PGlite: the route AUTHORIZES with `authorizeManager` (persons +
// management_sessions under the app role's RLS) and reads the tenant's `cadenas` chain row — both
// false passes on PGlite's superuser connection (CLAUDE.md §4). Mirrors `box-status.replication.test.ts`;
// the disposal reader here is a stub (its own drain read is proven in packages/sync's disposal.test.ts),
// so the point exercised is the collapse in `collectBoxStatus` driven through the real GET route.
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
  return `${String(73_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then seed — as the app role under the tenant, so
 * RLS is exercised — a MANAGER (role `manager`, which holds `till.configure`) WITH a dashboard
 * password so it can log in. Provisioning creates only the ADMIN, so the manager is seeded directly;
 * `pin_hash` is NOT NULL, so a value is supplied even though it logs in by password. Mirrors the
 * sibling `box-status.replication.test.ts` scaffolding.
 */
async function setupTenant(): Promise<{ tenantId: string; nodeId: string; managerId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
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
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
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
 * `readDisposal` is threaded from the caller so each case can wire a stub reader or leave it absent.
 * Both surfaces share the owner db + tenant, so a cookie minted on one resolves on the other.
 */
function buildApp(
  tenantId: string,
  nodeId: string,
  now: Date,
  readDisposal: (() => Promise<{ carrierNodeId: string } & DrainProgress>) | undefined,
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
      health: createHealthState(now),
      now: () => now,
      tlsCertPath: undefined,
      readReplicationLag: undefined,
      readBackup: undefined,
      readDisposal,
      readConfigConflicts: undefined,
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

describe("GET /api/box/status disposal state (real postgres)", () => {
  let tenantId: string;
  let nodeId: string;

  beforeAll(async () => {
    const t = await setupTenant();
    tenantId = t.tenantId;
    nodeId = t.nodeId;
  });

  it("surfaces the carrier + drain verdict when a readDisposal is wired (bigint → string)", async () => {
    const app = buildApp(tenantId, nodeId, new Date("2026-08-29T10:00:00Z"), async () => ({
      carrierNodeId: "carrier",
      drained: false,
      ownTailSeq: 100n,
      carrierAppliedSeq: 40n,
    }));
    const cookie = await login(app, MANAGER_EMAIL);
    const res = await app.request("/api/box/status", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.disposal).toEqual({
      applicable: true,
      carrierNodeId: "carrier",
      drained: false,
      ownTailSeq: "100",
      carrierAppliedSeq: "40",
    });
  });

  it("reports applicable:false when no readDisposal is wired (a serving, unfenced node)", async () => {
    const app = buildApp(tenantId, nodeId, new Date("2026-08-29T10:00:00Z"), undefined);
    const cookie = await login(app, MANAGER_EMAIL);
    const res = await app.request("/api/box/status", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.disposal).toEqual({ applicable: false });
  });
});
