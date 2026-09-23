import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { createHealthState } from "./health.js";
import { readBackupStatus, type BackupStatus } from "./backup-status.js";
import { mountBoxStatusApi } from "./box-status.js";
import { buildBackend } from "./local-fs-backend.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { FIXTURE_CERT_PEM } from "./testing/tls-fixture.js";

// Exercise box-status authorization and the composed status read over a manager login. The full
// manifest is migrated because the route composes cells several modules own.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the seeded manager's dashboard password.
// Dashboard sign-in resolves the person by EMAIL, so the seeded manager carries a login email
// (unique on `lower(email)` across the database — persons_tenant_email_uq).
const MANAGER_EMAIL = "manager@x.com";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

// One fixed NIF: this suite owns its own venue directory, so nothing else ever writes the `tenants`
// row the uniqueness constraint covers.
const NIF = "72000001K";

/** The suite's one venue. The database holds one tenant (one tenant per database) and is not reset
 *  between tests, so every group shares the venue provisioned on first use rather than another. */
let provisioned: Promise<{ nodeId: string; managerId: string }> | undefined;
function setupTenant(): Promise<{ nodeId: string; managerId: string }> {
  provisioned ??= provisionTenant();
  return provisioned;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function provisionTenant(): Promise<{ nodeId: string; managerId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: NIF,
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  const managerId = await withTransaction(suite.db, async (tx) => {
    // Through the table definition, not raw SQL: `persons.id` and `persons.created_at` are
    // `$defaultFn` generators (`packages/identity/src/schema/persons.ts:26,:67`) that an insert
    // statement never reaches, and both columns are NOT NULL.
    const [manager] = await tx
      .insert(persons)
      .values({
        displayName: "The Manager",
        email: MANAGER_EMAIL,
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(PASSWORD),
        role: "manager",
      })
      .returning({ id: persons.id });
    return manager!.id;
  });
  return { nodeId: venue.nodeId, managerId };
}

/**
 * A Hono app carrying the management API (for its login route) plus the box-status route under test.
 * Both surfaces share the owner db + tenant, so a cookie minted on one resolves on the other. `now`
 * feeds BOTH the cert reader and the duties snapshot; `tlsCertPath` toggles the cert branch.
 */
function buildApp(
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
      db: suite.db,
      cfg: { nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    () => {},
  );
  mountBoxStatusApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId },
      environment: "preproduction",
      health: createHealthState(opts.now),
      now: () => opts.now,
      tlsCertPath: opts.tlsCertPath,
      readBackup: opts.readBackup,
      readMode: () => "primary",
      readSingletonRole: () => "primary",
      readAwaitingFiscalCertificate: () => false,
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

describe("GET /api/box/status", () => {
  let app: Hono;
  let managerCookie: string;

  beforeAll(async () => {
    const { nodeId } = await setupTenant();
    app = buildApp(nodeId, {
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
    expect(body.backup).toEqual({ configured: false });
    expect(body.configConflicts).toBeUndefined(); // the config-conflict cell was removed (swap S4)
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

    const { nodeId } = await setupTenant();
    const backupApp = buildApp(nodeId, {
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

describe("GET /api/box/status with a configured TLS cert", () => {
  let app: Hono;
  let managerCookie: string;

  beforeAll(async () => {
    const { nodeId } = await setupTenant();
    // A real leaf on disk exercises the cert-configured branch + `readCertExpiry` closure end-to-end
    // (the undefined-cert suite above never touches them). `now` is 30 days before the fixture's
    // notAfter, so `daysRemaining` is a deterministic 30.
    const certPath = join(mkdtempSync(join(tmpdir(), "box-status-cert-")), "server.crt");
    writeFileSync(certPath, FIXTURE_CERT_PEM);
    app = buildApp(nodeId, {
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
