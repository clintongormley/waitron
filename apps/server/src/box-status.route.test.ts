import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import { BACKUP_NODE_ID } from "./testing/backup-node.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDLE_TIMEOUT_MS } from "@waitron/identity";
import { jobOrigin } from "@waitron/shared";
import { WorkforceBackend } from "@waitron/workforce";
import { readShutdownStaff } from "./admin-shutdown-duties.js";

import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import type { StreamView } from "@waitron/stream";
import { createHealthState } from "./health.js";
import { readDestinationStatus, type BackupStatus } from "./backup-status.js";
import { mountBoxStatusApi, type BoxStatusDeps } from "./box-status.js";
import { buildBackupBackend } from "./backup-backends.js";
import { backupArchiveKey } from "./backup-keys.js";
import { mountManagementApi } from "./management-api.js";
import { mountMeApi } from "./me-api.js";
import { ALL_MODULES } from "./modules.js";
import { FIXTURE_CERT_PEM } from "./testing/tls-fixture.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { createAdminShutdown } from "./admin-shutdown.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";

// Exercise box-status authorization and the composed status read over a manager login. The full
// manifest is migrated because the route composes cells several modules own.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the seeded manager's dashboard password.
const MANAGER_EMAIL = "manager@x.com";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

const NIF = "72000001K";

/** The database is not reset between tests, so every group shares the venue provisioned on first use. */
let provisioned: Promise<{ nodeId: string; managerId: string }> | undefined;
function setupVenue(): Promise<{ nodeId: string; managerId: string }> {
  provisioned ??= provisionVenue();
  return provisioned;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function provisionVenue(): Promise<{ nodeId: string; managerId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: NIF,
        legalName: "Deli Test SL",
        name: "Main room",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "A",
        correctiveSeriesCode: "R",
        admin: {
          displayName: "Administrator",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  const managerId = await withTransaction(suite.db, async (tx) => {
    // Through the table definition, not raw SQL: `persons.id` and `persons.created_at` are
    // `$defaultFn` generators (`packages/db/src/schema/identity/persons.ts`) that raw SQL never
    // reaches.
    const [manager] = await seedPersons(tx, {
      displayName: "The Manager",
      email: MANAGER_EMAIL,
      pinHash: fixturePinHash("1234"),
      passwordHash: fixturePasswordHash(PASSWORD),
      role: "manager",
    });
    return manager!.id;
  });
  return { nodeId: venue.nodeId, managerId };
}

/** The management API (for its login route) plus the box-status route under test. */
function buildApp(
  nodeId: string,
  opts: {
    now: Date;
    tlsCertPath: string | undefined;
    readBackup?: () => Promise<BackupStatus>;
    readStream?: () => StreamView;
    shutdown?: Omit<NonNullable<BoxStatusDeps["shutdown"]>, "readStaff"> &
      Partial<Pick<NonNullable<BoxStatusDeps["shutdown"]>, "readStaff">> &
      Partial<Pick<ReturnType<typeof createAdminShutdown>, "middleware">>;
  },
): Hono {
  const app = new Hono();
  if (opts.shutdown?.middleware) app.use("*", opts.shutdown.middleware);
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  mountMeApi(
    app,
    { db: suite.db, venueLocale: "en", modules: [], credentialKeyRing: TOTP_KEY_RING },
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
      shutdown: opts.shutdown && { readStaff: async () => [], ...opts.shutdown },
      readStream: opts.readStream ?? (() => ({ state: "off" })),
      readMode: () => "primary",
      readSingletonRole: () => "primary",
      readTime: async () => ({ synced: false, source: "unavailable", warn: false }),
      readJobs: () => ({}),
      readAwaitingFiscalCertificate: () => false,
    },
    () => {},
  );
  return app;
}

/** Log in over HTTP by `email`, returning just the `waitron_management_session=…` cookie pair. */
async function login(app: Hono, email: string, password = PASSWORD): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

it("requires the same HTTPS page and an administrator before admitting shutdown", async () => {
  const { nodeId } = await setupVenue();
  const start = vi.fn();
  const app = buildApp(nodeId, {
    now: new Date(),
    tlsCertPath: undefined,
    shutdown: {
      start,
      resolvePaused: () => {},
      cancel: async () => {},
      status: () => ({ phase: "idle" }),
      beginDownload: () => {
        throw new Error("No archive");
      },
      confirmDownload: () => {},
      available: async () => true,
    },
  });
  const cookie = await login(app, MANAGER_EMAIL);
  const request = { method: "POST", headers: { cookie } };
  const socket = new TLSSocket(new Socket());
  try {
    const path = "https://box.example/api/box/shutdown";
    const plain = await app.request(path, request);
    expect(plain.status).toBe(403);
    expect(await plain.json()).toMatchObject({ error: { code: "node.operation_page_required" } });
    const secure = await app.request(path, request, { incoming: { socket } });
    expect(secure.status).toBe(403);
    expect(await secure.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(start).not.toHaveBeenCalled();
  } finally {
    socket.destroy();
  }
});

it("lets an administrator sign in again and cancel while payments are paused", async () => {
  const { nodeId } = await setupVenue();
  const shutdown = createAdminShutdown({
    check: (signal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    save: async () => {},
    clear: async () => {},
  });
  const app = buildApp(nodeId, {
    now: new Date(),
    tlsCertPath: undefined,
    shutdown: { ...shutdown, available: async () => true },
  });
  const paymentPath = "/api/working-orders/order/payments";
  app.post(paymentPath, (c) => c.body(null, 204));
  const socket = new TLSSocket(new Socket());
  const changeShutdown = (method: "POST" | "DELETE", cookie: string) =>
    app.request(
      "https://box.example/api/box/shutdown",
      { method, headers: { cookie } },
      {
        incoming: { socket },
      },
    );
  try {
    const cookie = await login(app, "owner@example.test", "dashPass123");
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, cookie, true, "passkey"));
    const needsPassword = await changeShutdown("POST", cookie);
    expect(await needsPassword.json()).toMatchObject({
      error: { code: "management_session.proof_required" },
    });
    expect(shutdown.status()).toEqual({ phase: "idle" });
    const proved = await app.request("/management-api/session/me/fresh-sign-in", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ method: "password", password: "dashPass123" }),
    });
    expect(proved.status).toBe(204);
    expect((await changeShutdown("POST", cookie)).status).toBe(202);
    vi.setSystemTime(Date.now() + IDLE_TIMEOUT_MS + 1_000);
    const expired = await changeShutdown("DELETE", cookie);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ error: { code: "management_session.expired" } });
    const refused = await app.request(paymentPath, { method: "POST" });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "box.shutdown_in_progress" } });
    const fresh = await login(app, "owner@example.test", "dashPass123");
    const cancelled = await changeShutdown("DELETE", fresh);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ phase: "idle" });
    expect((await app.request(paymentPath, { method: "POST" })).status).toBe(204);
  } finally {
    vi.useRealTimers();
    await shutdown.close();
    socket.destroy();
  }
});

it("requires a box administrator on HTTPS to resolve a failed shutdown check", async () => {
  const { nodeId } = await setupVenue();
  const shutdown = createAdminShutdown({
    check: async () => {
      throw new Error("Backup failed");
    },
    save: async () => {},
    clear: async () => {},
  });
  const app = buildApp(nodeId, {
    now: new Date(),
    tlsCertPath: undefined,
    shutdown: { ...shutdown, available: async () => true },
  });
  const admin = await login(app, "owner@example.test", "dashPass123");
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, admin, false));
  const manager = await login(app, MANAGER_EMAIL);
  const socket = new TLSSocket(new Socket());
  const request = (cookie: string, secure: boolean, decision: string) =>
    app.request(
      "https://box.example/api/box/shutdown",
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
      secure ? { incoming: { socket } } : undefined,
    );
  try {
    shutdown.start();
    await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
    expect((await request(admin, false, "shut-down-anyway")).status).toBe(403);
    expect((await request(manager, true, "shut-down-anyway")).status).toBe(403);
    expect((await request(admin, true, "unknown")).status).toBe(400);
    expect(shutdown.status().phase).toBe("paused");
    expect((await request(admin, true, "shut-down-anyway")).status).toBe(202);
    await vi.waitFor(() => expect(shutdown.status()).toEqual({ phase: "ready", checked: false }));
  } finally {
    await shutdown.close();
    socket.destroy();
  }
});

it("restricts the shutdown archive and its confirmation to box administrators on HTTPS", async () => {
  const { nodeId } = await setupVenue();
  const shutdown = createAdminShutdown({
    check: async () => {},
    save: async () => {},
    clear: async () => {},
  });
  const app = buildApp(nodeId, {
    now: new Date(),
    tlsCertPath: undefined,
    shutdown: { ...shutdown, available: async () => true },
  });
  const admin = await login(app, "owner@example.test", "dashPass123");
  const manager = await login(app, MANAGER_EMAIL);
  const socket = new TLSSocket(new Socket());
  const path = "https://box.example/api/box/shutdown";
  const name = "checked.backup.enc";
  try {
    for (const [cookie, secure, code] of [
      [admin, false, "node.operation_page_required"],
      [manager, true, "authorization.not_permitted"],
    ] as const) {
      const env = secure ? { incoming: { socket } } : undefined;
      const download = await app.request(`${path}/download/${name}`, { headers: { cookie } }, env);
      const confirm = await app.request(
        path,
        {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ decision: "backup-saved", name }),
        },
        env,
      );
      for (const response of [download, confirm]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code } });
      }
    }
    const stale = await app.request(
      `${path}/download/${name}`,
      { headers: { cookie: admin } },
      { incoming: { socket } },
    );
    expect(await stale.json()).toMatchObject({ error: { code: "box.shutdown_in_progress" } });
  } finally {
    await shutdown.close();
    socket.destroy();
  }
});

it("shows the shutdown confirmation who is working or on break to box administrators", async () => {
  const { nodeId, managerId } = await setupVenue();
  const workforce = new WorkforceBackend();
  const input = {
    personId: managerId,
    nodeId,
    at: "2026-11-25T18:00:00.000Z",
    offsetMinutes: 60,
    origin: jobOrigin("dashboard"),
  };
  const workingId = await withTransaction(suite.db, async (tx) => {
    const [working, finished] = await seedPersons(tx, [
      { displayName: "Working staff", pinHash: "seed", role: "staff" },
      { displayName: "Finished staff", pinHash: "seed", role: "staff" },
    ]);
    await workforce.clockIn(tx, { ...input, personId: working!.id });
    await workforce.clockIn(tx, { ...input, personId: finished!.id });
    await workforce.clockOut(tx, {
      ...input,
      personId: finished!.id,
      at: "2026-11-25T18:10:00.000Z",
    });
    await workforce.clockIn(tx, input);
    await workforce.breakStart(tx, { ...input, at: "2026-11-25T18:15:00.000Z" });
    return working!.id;
  });
  const app = buildApp(nodeId, {
    now: new Date(),
    tlsCertPath: undefined,
    shutdown: {
      ...createAdminShutdown({
        check: async () => {},
        save: async () => {},
        clear: async () => {},
      }),
      available: async () => true,
      readStaff: () => readShutdownStaff(suite.db),
    },
  });
  const socket = new TLSSocket(new Socket());
  const request = (cookie: string) =>
    app.request(
      "https://box.example/api/box/shutdown",
      {
        headers: { cookie },
      },
      { incoming: { socket } },
    );
  try {
    const manager = await login(app, MANAGER_EMAIL);
    const admin = await login(app, "owner@example.test", "dashPass123");
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, admin));
    const deactivated = await app.request(`/management-api/staff/${workingId}/deactivate`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(deactivated.status).toBe(204);
    expect((await request(manager)).status).toBe(403);
    const response = await request(admin);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { displayName: "The Manager", state: "on_break" },
      { displayName: "Working staff", state: "working" },
    ]);
  } finally {
    socket.destroy();
  }
});

describe("GET /api/box/status", () => {
  let app: Hono;
  let managerCookie: string;

  beforeAll(async () => {
    const { nodeId } = await setupVenue();
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
    expect(body.stream).toEqual({ state: "off" });
    expect(body.configConflicts).toBeUndefined();
    expect(body.time.source).toMatch(/timedatectl|unavailable/);
  });

  it("carries the bucket copy's state from its reader", async () => {
    const stream: StreamView = {
      state: "off",
      reason: "no_membership",
      stateSince: "2026-08-29T09:00:00.000Z",
    };
    const { nodeId } = await setupVenue();
    const streamApp = buildApp(nodeId, {
      now: new Date("2026-08-29T10:00:00Z"),
      tlsCertPath: undefined,
      readStream: () => ({ ...stream, pruneBlockedSince: "2026-08-29T08:00:00Z" }),
    });
    const cookie = await login(streamApp, MANAGER_EMAIL);
    const res = await streamApp.request("/api/box/status", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).stream).toEqual(stream);
  });

  it("flows the per-destination backup shape through the route, reading a .backup.enc artifact as FRESH", async () => {
    const now = new Date("2026-08-29T10:00:00Z");
    const dir = mkdtempSync(join(tmpdir(), "box-status-backup-"));
    const artifact = join(
      dir,
      backupArchiveKey(new Date("2026-08-29T09:59:00Z"), { nodeId: BACKUP_NODE_ID }),
    );
    writeFileSync(artifact, "ciphertext");
    const mtime = new Date(now.getTime() - 30_000); // 30s old — inside the 60s stale window
    utimesSync(artifact, mtime, mtime);
    const backend = buildBackupBackend({ kind: "local-fs", id: "primary", dir });

    const { nodeId } = await setupVenue();
    const backupApp = buildApp(nodeId, {
      now,
      tlsCertPath: undefined,
      readBackup: async () => ({
        configured: true,
        destinations: [await readDestinationStatus(backend, 60_000, now, BACKUP_NODE_ID).status],
      }),
    });
    const cookie = await login(backupApp, MANAGER_EMAIL);
    const res = await backupApp.request("/api/box/status", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backup).toEqual({
      configured: true,
      destinations: [
        {
          id: "primary",
          lastBackupAt: mtime.toISOString(),
          lastBackupStartedAt: "2026-08-29T09:59:00.000Z",
          ageSeconds: 30,
          stale: false,
          readErrorCode: null,
        },
      ],
    });
  });
});

describe("GET /api/box/status with a configured TLS cert", () => {
  let app: Hono;
  let managerCookie: string;

  beforeAll(async () => {
    const { nodeId } = await setupVenue();
    // `now` is 30 days before the fixture's notAfter, so `daysRemaining` is a deterministic 30.
    const certPath = join(mkdtempSync(join(tmpdir(), "box-status-cert-")), "server.pem");
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
