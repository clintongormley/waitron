import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { createHealthState } from "./health.js";
import { readBackupStatus, type BackupStatus } from "./backup-status.js";
import { mountBoxStatusApi, readConfigConflictCount } from "./box-status.js";
import { buildBackend } from "./local-fs-backend.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { FIXTURE_CERT_PEM } from "./testing/tls-fixture.js";

// Exercise box-status authorization and chain reads on PostgreSQL with manager login.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the seeded manager's dashboard password.
// Dashboard sign-in resolves the person by EMAIL, so the seeded manager carries a login email
// (per-tenant unique — persons_tenant_email_uq).
const MANAGER_EMAIL = "manager@x.com";

const suite = useTemplateDb({ template: "manifest" });

// The config-conflict count reader under test reads through the `sync_tailer` role — `row_image` is
// tenant business data, so 0009 grants SELECT on `sync_config_conflicts` to `sync_tailer` only, NOT
// `app_user` (the same isolation `sync_log` enforces; proven by `config-conflict.grants.test.ts`). So
// the READER must be a sync_tailer connection, not the superuser `suite.admin` (which would bypass the
// grant and hide a regression). `sync_reader` is a LOGIN member of `sync_tailer`, created once in the
// shared-container global setup; seeding still runs as `suite.admin`. Guarded close (CLAUDE.md §4).
let conflictsReaderDb: Database | undefined;
beforeAll(async () => {
  conflictsReaderDb = await suite.pg.connectAs("sync_reader", "rp");
});
afterAll(async () => {
  if (conflictsReaderDb !== undefined) await conflictsReaderDb.close();
});

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so the provisioned venue needs its own NIF — the same per-suite counter the sibling suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
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

/**
 * A Hono app carrying the management API (for its login route) plus the box-status route under test.
 * Both surfaces share the owner db + tenant, so a cookie minted on one resolves on the other. `now`
 * feeds BOTH the cert reader and the duties snapshot; `tlsCertPath` toggles the cert branch.
 */
function buildApp(
  tenantId: string,
  nodeId: string,
  opts: {
    now: Date;
    tlsCertPath: string | undefined;
    readBackup?: () => Promise<BackupStatus>;
  },
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
      readDisposal: undefined,
      readBackup: opts.readBackup,
      // The Slice-7 config-conflict count reader, on the sync_tailer pool (the manifest template carries
      // the sync module, so sync_config_conflicts exists). Reads through `sync_tailer` — the role that
      // holds SELECT on the table (0009) — exactly as boot.ts wires it via `lagPool`.
      readConfigConflicts: () => readConfigConflictCount(conflictsReaderDb!),
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
    // The reader is wired, so the surface is configured; no conflicts have been recorded on this fresh
    // clone yet, so the healthy norm is zero.
    expect(body.configConflicts).toEqual({ configured: true, count: 0 });
    expect(body.time.source).toMatch(/timedatectl|unavailable/);
  });

  it("flows the per-destination backup shape through the route, reading a .backup.enc artifact as FRESH", async () => {
    // The success-path twin of the `configured:false` case above: a real `LocalFsBackend` holding an
    // encrypted `waitron-<ts>.backup.enc` archive must read FRESH per destination over the actual HTTP
    // route + manager gate — the regression BR-1 left (the old `.dump`-anchored reader reported a
    // working backup permanently stale) proven end-to-end, not just at the unit level.
    const now = new Date("2026-08-29T10:00:00Z");
    const dir = mkdtempSync(join(tmpdir(), "box-status-backup-"));
    const artifact = join(dir, "waitron-20260829T095900Z.backup.enc");
    writeFileSync(artifact, "ciphertext");
    const mtime = new Date(now.getTime() - 30_000); // 30s old — inside the 60s stale window
    utimesSync(artifact, mtime, mtime);
    const backend = buildBackend({ kind: "local-fs", id: "primary", dir });

    const { tenantId, nodeId } = await setupTenant();
    const backupApp = buildApp(tenantId, nodeId, {
      now,
      tlsCertPath: undefined,
      readBackup: () => readBackupStatus([backend], 60_000, now),
    });
    const cookie = await login(backupApp, MANAGER_EMAIL);
    const res = await backupApp.request("/api/box/status", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backup).toEqual({
      configured: true,
      destinations: [
        { id: "primary", lastBackupAt: mtime.toISOString(), ageSeconds: 30, stale: false },
      ],
    });
  });
});

describe("GET /api/box/status surfaces the config-conflict count (real postgres)", () => {
  let app: Hono;
  let managerCookie: string;
  let tenantId: string;

  beforeAll(async () => {
    const t = await setupTenant();
    tenantId = t.tenantId;
    app = buildApp(t.tenantId, t.nodeId, {
      now: new Date("2026-08-29T10:00:00Z"),
      tlsCertPath: undefined,
    });
    managerCookie = await login(app, MANAGER_EMAIL);
  });

  // Clear whole-database conflict rows so they do not affect later cases in this file.
  afterAll(async () => {
    await suite.admin.execute(sql`delete from sync_config_conflicts`);
  });

  it("reports configConflicts.count === the number of recorded ops rows", async () => {
    // Clear first as the owner so the assertion is order-independent, then seed exactly three rows and
    // read them back through the app-role reader the route uses.
    await suite.admin.execute(sql`delete from sync_config_conflicts`);
    for (let i = 0; i < 3; i += 1) {
      await suite.admin.execute(
        sql`insert into sync_config_conflicts (table_name, origin_id, lane, row_image)
            values ('products', gen_random_uuid(), 'ordered', ${JSON.stringify({ id: `p${i}`, tenant_id: tenantId })}::jsonb)`,
      );
    }
    const res = await app.request("/api/box/status", { headers: { cookie: managerCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configConflicts).toEqual({ configured: true, count: 3 });
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
