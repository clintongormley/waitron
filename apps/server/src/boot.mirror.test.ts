import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  readSingletonRole,
  setDeploymentMode,
  stampDeployment,
  tenants,
  tills,
  withTransaction,
  writeMirrorConfig,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { resolveManagementSession } from "@waitron/identity";
import { drain } from "@waitron/fiscal-verifactu";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { runPass, DRAIN_DUTY } from "./pass.js";
import { singletonPass } from "./singleton-pass.js";
import { seedFiscalRegistro } from "./testing/fiscal-fixtures.js";
import { ensureMirrorViewer } from "./mirror-session.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

// Mirror-mode server boot. A mirror reads its origin, relay and CA from `mirror_config`. Four venue
// directories: `mirror` (read-only, refuses writes); `primary`, the same identity booted as primary —
// the control that the mirror's absences are real; `noConfig`, mirror-stamped with no
// `mirror_config` row, which must refuse to boot; and `adopting`, which holds no venue rows.
// Nothing is reset between tests, and the four directories never meet.
const VENUES = ["mirror", "primary", "noConfig", "adopting"] as const;
type VenueName = (typeof VENUES)[number];
const venueDir = {} as Record<VenueName, string>;
const stores = {} as Record<VenueName, VenueDatabase>;
const db = {} as Record<VenueName, Database>;

const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// Disables `fiscal-none` so a mirror boot does not refuse `module.fiscal_slot_ambiguous`.
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-mirror-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const KEY_ENV = {
  // Keeps the plain-HTTP landing listener off privileged port 80.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_ENV: "preproduction",
  ...TILL_ENV,
};

// Unreachable on purpose: nothing on these boots dials the relay.
const MIRROR_RELAY_URL = "http://127.0.0.1:1/";
const MIRROR_BOX_HOSTNAME = "mirror-box.local";
// The primary's node id, distinct from the mirror's own `WAITRON_TILL_NODE_ID`.
const MIRROR_ORIGIN_NODE = "77777777-7777-4777-8777-777777777777";
const BOX_CA_PEM = mintSelfSignedServerCert({
  hostnames: [MIRROR_BOX_HOSTNAME],
  ipAddresses: [],
  now: new Date(),
}).caCertPem;

let migrationsRoot: string;

async function seedIdentity(admin: Database): Promise<void> {
  // `onConflictDoNothing` is untargeted: nothing here reads the result.
  await admin
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90222222J", legalName: "Mirror SL" })
    .onConflictDoNothing();
  await admin
    .insert(locations)
    .values({
      id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Loc",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  await admin
    .insert(nodes)
    .values({
      id: TILL_ENV.WAITRON_TILL_NODE_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Node",
    })
    .onConflictDoNothing();
  await admin
    .insert(tills)
    .values({
      id: TILL_ENV.WAITRON_TILL_TILL_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Till",
    })
    .onConflictDoNothing();
  await admin
    .insert(invoiceSeries)
    .values({
      id: TILL_ENV.WAITRON_TILL_SERIES_ID,
      nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
      code: "A",
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-mirror-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  for (const name of VENUES) {
    venueDir[name] = await mkdtemp(join(tmpdir(), `waitron-mirror-venue-${name}-`));
    await applyMigrations(venueDir[name], fromSource);
    stores[name] = await openVenueDatabase(venueDir[name]);
    db[name] = stores[name].venue;
  }

  await seedIdentity(db.mirror);
  await seedIdentity(db.primary);
  await seedIdentity(db.noConfig);
  // The primary directory writes no `node_roles` row: `readDeploymentAxes` reads it as 'primary'.
  await stampDeployment(db.mirror, "preproduction");
  await setDeploymentMode(db.mirror, TILL_ENV.WAITRON_TILL_NODE_ID, "mirror");
  await stampDeployment(db.primary, "preproduction");
  await stampDeployment(db.noConfig, "preproduction");
  await setDeploymentMode(db.noConfig, TILL_ENV.WAITRON_TILL_NODE_ID, "mirror");
  // Adoption-pending: stamped and mode 'mirror', but deliberately NOT seeded with the till identity.
  await stampDeployment(db.adopting, "preproduction");
  await setDeploymentMode(db.adopting, TILL_ENV.WAITRON_TILL_NODE_ID, "mirror");

  // `noConfig` deliberately gets none.
  await writeMirrorConfig(db.mirror, TILL_ENV.WAITRON_TILL_NODE_ID, {
    relayUrl: MIRROR_RELAY_URL,
    boxHostname: MIRROR_BOX_HOSTNAME,
    boxCaPem: BOX_CA_PEM,
    originNodeId: MIRROR_ORIGIN_NODE,
  });
}, 180_000);

afterAll(async () => {
  for (const name of VENUES) if (stores[name] !== undefined) await stores[name].close();
  for (const name of VENUES)
    if (venueDir[name] !== undefined) await rm(venueDir[name], { recursive: true, force: true });
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

/** `WAITRON_HTTP_PORT` refuses "0", so the OS picks a free port first. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Poll `predicate` up to ~10s for its first defined value. */
async function poll<T>(predicate: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}

describe("mirror-mode boot (node_roles.mode = 'mirror')", () => {
  it("serves a dashboard read via the ambient viewer and refuses writes", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.mirror,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      // The viewer's cookie arrives on the first RESPONSE; the same request's gate cannot read it.
      const primer = await fetch(`${base}/management-api/catalogues`);
      expect(primer.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
      const cookie = primer.headers.get("set-cookie")!.split(";")[0]!;

      // Only the ambient cookie, no user login: the gated read resolves through the admin viewer.
      const read = await fetch(`${base}/management-api/catalogues`, { headers: { cookie } });
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual([]);

      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // The mirror-bundle endpoint is primary-only; the primary control below answers 401 here.
      const bundle = await fetch(`${base}/management-api/mirror-bundle`, {
        method: "POST",
        body: "{}",
      });
      expect(bundle.status).toBe(403);
      expect(await bundle.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // The agent and device groups are not mounted on a mirror. A GET bypasses the read-only
      // gate, so a 404 means the route is absent, not gated; the primary control answers 200.
      const printStatus = await fetch(`${base}/print-api/agent/join/status`);
      expect(printStatus.status).toBe(404);
      const deviceStation = await fetch(`${base}/api/device/station`);
      expect(deviceStation.status).toBe(404);

      // Till reads ARE mounted on a mirror, but no till can log in: `POST /api/session` is a
      // write the gate refuses, so the route stops at its session check.
      const heldOrders = await fetch(`${base}/api/working-orders`);
      expect(heldOrders.status).toBe(401);
      expect(await heldOrders.json()).toEqual({ error: { code: "session.required", params: {} } });

      const probe = await fetch(`${base}/api/node`);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({ acceptingSales: false });

      // The mirror's singleton_role is 'secondary', so the pass that ran is the trivial empty one.
      await poll(() => server.health.lastPassAt ?? undefined);
      expect(server.health.lastPassAt).not.toBeNull();
    } finally {
      await server.close();
    }
    await expect(fetch(`${base}/api/node`)).rejects.toThrow();
  }, 60_000);

  it("runs the trivial empty pass on a mirror — the fiscal drain (AEAT submission) is never invoked", async () => {
    // A node that is not the singleton primary must never file to AEAT under a chain it does not
    // own. `startServer` builds its AEAT client internally, so this drives the pass
    // as boot wires it — `singletonPass` around `runPass` with the real drainer — with a
    // `resolveClient` tripwire in place of the transport.

    // A pending envío this node must NOT submit.
    const seeded = await seedFiscalRegistro(db.mirror, {
      ids: {
        locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
        tillId: TILL_ENV.WAITRON_TILL_TILL_ID,
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        seriesId: TILL_ENV.WAITRON_TILL_SERIES_ID,
      },
      reuseExistingParents: true,
      envio: true,
      cadena: true,
      entorno: "preproduction",
    });

    let resolveClientCalled = false;
    const tripwireResolveClient = (): Promise<never> => {
      resolveClientCalled = true;
      return Promise.reject(new Error("mirror must not contact AEAT"));
    };
    const buildPass = (getRole: () => "primary" | "secondary") =>
      singletonPass(getRole, (at) =>
        runPass(
          {
            drain: (at2) =>
              drain(
                {
                  db: db.mirror,
                  resolveClient: tripwireResolveClient,
                  skipRetryMs: 300_000,
                  environment: "preproduction",
                },
                at2,
              ),
            reconcile: () =>
              Promise.resolve({
                ran: [],
                deferred: 0,
                beyondHorizon: 0,
                skipped: [],
                nextDueAt: null,
              }),
            awaitingCert: { current: false },
            monotonicMs: () => performance.now(),
            log: () => {},
          },
          at,
        ),
      );

    // The role `setDeploymentMode('mirror')` set, not one invented for the test.
    const role = await readSingletonRole(db.mirror, TILL_ENV.WAITRON_TILL_NODE_ID);
    expect(role).toBe("secondary");

    // An hour ahead, so the seeded envío is unambiguously due for the primary control below.
    const drainAt = new Date(Date.now() + 3_600_000);

    const mirrorReport = await buildPass(() => role)(drainAt);
    expect(resolveClientCalled).toBe(false);
    expect(mirrorReport).toEqual({ nextDueAt: null, duties: [] });

    const afterMirror = await db.mirror.execute<{ estado: string }>(
      sql`select estado from envios where registro_id = ${seeded.registroId}`,
    );
    expect(afterMirror.rows[0]?.estado).toBe("pendiente");

    // The control: the same wiring as 'primary' reaches the tripwire, so the mirror's clean pass is
    // the singleton gate working, not a drainer that never fires.
    const primaryReport = await buildPass(() => "primary")(drainAt);
    expect(resolveClientCalled).toBe(true);
    expect(primaryReport.duties.some((d) => d.duty === DRAIN_DUTY)).toBe(true);

    // The tripwire proves drain was reached, not that anything was filed.
    const afterPrimary = await db.mirror.execute<{ estado: string }>(
      sql`select estado from envios where registro_id = ${seeded.registroId}`,
    );
    expect(afterPrimary.rows[0]?.estado).toBe("pendiente");
  }, 60_000);

  it("primary boot of the same identity mounts the mirror-bundle endpoint + operational groups (control: the mirror's absence is real)", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.primary,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      const bundle = await fetch(`${base}/management-api/mirror-bundle`, { method: "POST" });
      expect(bundle.status).toBe(401);
      expect((await bundle.json()).error.code).toBe("password.invalid");

      const printStatus = await fetch(`${base}/print-api/agent/join/status`);
      expect(printStatus.status).toBe(200);
      const printJobs = await fetch(`${base}/print-api/agent/jobs`, { method: "POST" });
      expect(printJobs.status).not.toBe(404);
      const deviceStation = await fetch(`${base}/api/device/station`);
      expect(deviceStation.status).not.toBe(404);

      // Both boots are unfenced, so `mode` is the only axis that differs.
      const probe = await fetch(`${base}/api/node`);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        acceptingSales: true,
      });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a primary boot ends the mirror viewer's session, so a cookie a browser kept from the mirror is refused", async () => {
    // Resolving the token before the boot is the control: without it, a refusal afterwards would
    // look the same whether or not boot acted.
    const token = await ensureMirrorViewer(db.primary);
    await expect(
      withTransaction(db.primary, (tx) => resolveManagementSession(tx, token)),
    ).resolves.toMatchObject({ role: "admin" });

    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.primary,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      const read = await fetch(`${base}/management-api/catalogues`, {
        headers: { cookie: `${MANAGEMENT_COOKIE}=${token}` },
      });
      expect(read.status).toBe(401);
      expect(await read.json()).toEqual({
        error: { code: "management_session.required", params: {} },
      });
      await expect(
        withTransaction(db.primary, (tx) => resolveManagementSession(tx, token)),
      ).rejects.toMatchObject({ code: "management_session.required" });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("refuses a mirror boot binding a non-loopback host without the WAITRON_MIRROR_ALLOW_EXPOSED opt-in", async () => {
    // The mirror's dashboard is an unauthenticated ambient admin, so a routable bind would expose
    // admin with no auth.
    let caught: unknown;
    try {
      await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: venueDir.mirror,
        WAITRON_HTTP_HOST: "0.0.0.0",
        WAITRON_HTTP_PORT: String(await freePort()),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
      });
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught)).toBe(true);
    expect(isAppError(caught) && caught.code).toBe("server.mirror_bind_exposed");
    expect(isAppError(caught) && caught.params).toEqual({ host: "0.0.0.0" });
  }, 60_000);

  it("boots a mirror on a non-loopback host WITH the explicit opt-in (binds 0.0.0.0, guard silenced)", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.mirror,
      WAITRON_HTTP_HOST: "0.0.0.0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_MIRROR_ALLOW_EXPOSED: "true",
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      const primer = await fetch(`${base}/management-api/catalogues`);
      expect(primer.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
      const cookie = primer.headers.get("set-cookie")!.split(";")[0]!;
      const read = await fetch(`${base}/management-api/catalogues`, { headers: { cookie } });
      expect(read.status).toBe(200);
    } finally {
      await server.close();
    }
    await expect(fetch(`${base}/api/node`)).rejects.toThrow();
  }, 60_000);

  it("refuses a mirror boot that has no mirror_config row (a mirror REQUIRES its DB connection config)", async () => {
    let caught: unknown;
    try {
      await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: venueDir.noConfig,
        WAITRON_HTTP_PORT: String(await freePort()),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
      });
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught)).toBe(true);
    expect(isAppError(caught) && caught.code).toBe("server.config_invalid");
    expect(isAppError(caught) && caught.params).toEqual({
      variable: "mirror_config",
      reason: "mirror_requires_mirror_config",
    });
  }, 60_000);

  it("boots adoption-pending on an EMPTY database with status and public certificate help", async () => {
    // An adopted mirror restarts holding none of the venue's rows, and boot must serve a minimal
    // status surface without reading any. The empty database shows only that this boot serves and
    // never seeds the mirror viewer: the case has no negative control, and nothing names what would
    // fail without the guard.
    const stateDir = mkdtempSync(join(tmpdir(), "waitron-adopting-state-"));
    writeFileSync(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    // Inert: establishing the standby needs a `locations` row this database does not hold, and
    // `runFinishAdoption` logs `adoption.establish_failed` rather than failing the boot.
    writeFileSync(
      join(stateDir, "pending-adoption.json"),
      JSON.stringify({
        locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
        standby: {
          nodeId: "88888888-8888-4888-8888-888888888888",
          publicKey: "pub",
          privateKey: "priv",
        },
        nodeName: "standby",
        filingModule: "fiscal-verifactu",
        taxModule: null,
        reserved: { modules: {}, series: [], endorsement: {} },
        originNodeId: MIRROR_ORIGIN_NODE,
      }),
      { mode: 0o600 },
    );
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venueDir.adopting,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      // No pass has run, so readiness may be 503; the route must answer.
      const health = await fetch(`${base}/health`);
      expect([200, 503]).toContain(health.status);

      const status = await fetch(`${base}/api/box/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({ adoption: "pending" });
      const trust = await fetch(`${base}/setup/trust`);
      expect(trust.status).toBe(200);
      expect(await trust.text()).toContain("to this Waitron server");
      expect((await fetch(`${base}/setup-api/discovery`)).status).toBe(404);
      const reset = await fetch(`${base}/setup-api/reset-incomplete-adopt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId: "p", password: "x" }),
      });
      expect(reset.status).toBe(404);

      // No ambient viewer: the dashboard read primes no cookie.
      const dash = await fetch(`${base}/management-api/catalogues`);
      expect(dash.headers.get("set-cookie")).toBeNull();
    } finally {
      await server.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
    await expect(fetch(`${base}/health`)).rejects.toThrow();
  }, 60_000);
});
