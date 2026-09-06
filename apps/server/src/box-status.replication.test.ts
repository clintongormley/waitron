// Real PostgreSQL exercises authorization and replication reads after SET ROLE app_user.
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { lagFor } from "@waitron/sync";
import { createHealthState } from "./health.js";
import { mountBoxStatusApi } from "./box-status.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";

// Exercise the box-status route with PostgreSQL-backed authorization and the real lagFor reader.
// The owner seeds sync_log and sync_cursor for the requested origin.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the seeded manager's dashboard password.
// Dashboard sign-in resolves the person by EMAIL, so the seeded manager carries a login email
// (per-tenant unique — persons_tenant_email_uq).
const MANAGER_EMAIL = "manager@x.com";

// One producing origin, and two subscribers: s1 has applied 3 of the origin's 10 captured rows
// (lag 7), s2 is caught up (lag 0). `lagFor` returns worst-first, so the summary's `worstLagSeq` is
// s1's 7 and `subscribers` is 2.
const ORIGIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so the provisioned venue needs its own NIF — the same per-suite counter the sibling suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(73_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
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
      values (${venue.tenantId}, 'The Manager', ${MANAGER_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')
      returning id`);
    return manager.rows[0]!.id;
  });
  return { tenantId: venue.tenantId, nodeId: venue.nodeId, managerId };
}

/** Seed origin sequence 10 and peer cursors at 3 and 10, producing lag 7 and 0. */
async function seedReplication(tenantId: string): Promise<void> {
  await suite.admin.execute(
    sql`insert into sync_log (seq, origin_id, table_name, op, tenant_id, row_image)
        overriding system value
        values (10, ${ORIGIN}::uuid, 'products', 'insert', ${tenantId}::uuid, '{}'::jsonb)`,
  );
  await suite.admin.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, last_applied_seq, alive, lane) values
          ('s1', ${ORIGIN}::uuid, 3, true, 'ordered'),
          ('s2', ${ORIGIN}::uuid, 10, true, 'ordered')`,
  );
}

/**
 * A Hono app carrying the management API (for its login route) plus the box-status route under test,
 * wired with a REAL `readReplicationLag` over `suite.admin` — the seam Task 6 fills in boot.ts. Both
 * surfaces share the owner db + tenant, so a cookie minted on one resolves on the other.
 */
function buildApp(tenantId: string, nodeId: string, now: Date): Hono {
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
      readReplicationLag: () => lagFor(suite.admin),
      readDisposal: undefined,
      readBackup: undefined,
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

describe("GET /api/box/status replication summary (real postgres)", () => {
  let app: Hono;
  let managerCookie: string;

  beforeAll(async () => {
    const { tenantId, nodeId } = await setupTenant();
    await seedReplication(tenantId);
    app = buildApp(tenantId, nodeId, new Date("2026-08-29T10:00:00Z"));
    managerCookie = await login(app, MANAGER_EMAIL);
  });

  it("summarises replication worst-first when sync is configured", async () => {
    const res = await app.request("/api/box/status", { headers: { cookie: managerCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.singletonRole).toBe("primary");
    expect(body.replication).toEqual({ configured: true, worstLagSeq: "7", subscribers: 2 });
  });
});
