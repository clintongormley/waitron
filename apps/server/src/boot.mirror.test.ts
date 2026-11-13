import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { mkdirSync } from "node:fs";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  stampDeployment,
  tenants,
  withNodeTransaction,
  withTransaction,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { readNodeMode, setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { deletePairLinkTx, loadKeyRing, writePairLinkTx } from "@waitron/credentials";
import {
  persons,
  managementSessions,
  mintSessionToken,
  hashSessionToken,
  resolveManagementSession,
} from "@waitron/identity";
import { drain } from "@waitron/fiscal-verifactu";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { fakeMdnsSocket } from "./testing/fake-mdns-socket.js";
import { DECLARATION_PAGE_WORDS } from "./i18n/declaration-page.js";
import { TEST_RELEASE, writeDeclarationFolder } from "./testing/declaration-folder.js";
import { runPass, DRAIN_DUTY } from "./pass.js";
import { singletonPass } from "./singleton-pass.js";
import { seedFiscalRegistro } from "./testing/fiscal-fixtures.js";
import { MIRROR_VIEWER_PERSON_ID, MIRROR_VIEWER_SESSION_ID } from "./mirror-session.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { freePort, freePorts } from "./testing/free-ports.js";
import { peerCertificate, writeTlsSet } from "./testing/box-tls.js";
import { connect as connectTcp } from "node:net";
import { boxHostnameFor } from "./box-name.js";
import { get } from "node:https";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, startConfiguredServer, httpPort } =
  ephemeralServerFixture();

// Pass-through wrappers that record the mirror-bundle route's wake and the spare join's wakes.
const joinWiring = vi.hoisted(() => ({
  wakes: 0,
  wakeSpareJoin: undefined as (() => void) | undefined,
}));
vi.mock("./spare-join.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./spare-join.js")>();
  return {
    ...actual,
    startSpareJoin: (deps: Parameters<typeof actual.startSpareJoin>[0]) => {
      const join = actual.startSpareJoin(deps);
      return {
        stop: () => join.stop(),
        wake: () => {
          joinWiring.wakes += 1;
          join.wake();
        },
      };
    },
  };
});
vi.mock("./mirror-bundle-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mirror-bundle-api.js")>();
  return {
    ...actual,
    mountMirrorBundleApi: (...args: Parameters<typeof actual.mountMirrorBundleApi>) => {
      joinWiring.wakeSpareJoin = args[1].wakeSpareJoin;
      return actual.mountMirrorBundleApi(...args);
    },
  };
});

// Mirror-mode server boot. A mirror reads its origin, relay and CA from node.db's
// `node_mirror_link`. Four venue directories: `mirror` (read-only, refuses writes); `primary`, the
// same identity booted as primary — the control that the mirror's absences are real; `noConfig`,
// mirror-stamped with no `node_mirror_link` row, which must refuse to boot; and `adopting`, which
// holds no venue rows.
// Nothing is reset between tests, and the four directories never meet.
const VENUES = ["mirror", "primary", "noConfig", "adopting"] as const;
type VenueName = (typeof VENUES)[number];
const venueDir = {} as Record<VenueName, string>;
const stores = {} as Record<VenueName, VenueDatabase>;
const db = {} as Record<VenueName, Database>;

const SEEDED_SERIES_ID = "44444444-4444-4444-8444-444444444444";
const MIRROR_STAFF_ID = "66666666-6666-4666-8666-666666666666";
const TILL_LOCATION_ID = "55555555-5555-4555-8555-555555555555";
const TILL_ENV = {
  WAITRON_NODE_ID: "33333333-3333-4333-8333-333333333333",
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

// Unreachable on purpose: only a start that is not a spare's dials its link's main box, and the one
// venue here given a link is a spare.
const MIRROR_ORIGIN_URL = "http://127.0.0.1:1/";
const MIRROR_BOX_HOSTNAME = "mirror-box.local";
// The primary's node id, distinct from the mirror's own `WAITRON_NODE_ID`.
const MIRROR_ORIGIN_NODE = "77777777-7777-4777-8777-777777777777";
const BOX_CA_PEM = mintSelfSignedServerCert({
  hostnames: [MIRROR_BOX_HOSTNAME],
  ipAddresses: [],
  now: new Date(),
}).caCertPem;

let migrationsRoot: string;

const PAIR_SECRET = "c".repeat(64);
/** A spare's `tls/` set: its store's listener serves this leaf under this authority. */
const BOX_TLS = mintSelfSignedServerCert({
  hostnames: ["waitron.local"],
  ipAddresses: ["127.0.0.1"],
  now: new Date(),
});
const PAIR_ACCESS_KEY_ID = "waitron0123456789abcdef";

/**
 * A stand-in versitygw: records its arguments, its environment and its process id beside itself,
 * then waits to be stopped.
 */
async function fakeVersitygw(): Promise<{ bin: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-fake-versitygw-"));
  const bin = join(dir, "versitygw");
  writeFileSync(
    bin,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$@" > "${dir}/args"`,
      `env > "${dir}/env"`,
      `echo $$ > "${dir}/pid"`,
      "exec sleep 60",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return { bin, dir };
}

/** Gives `venue`'s node a pair link that serves its main box, for one case; returns its removal. */
async function servePair(venue: VenueName): Promise<() => Promise<void>> {
  const ring = loadKeyRing(KEY_ENV);
  await withNodeTransaction(stores[venue].node, (tx) =>
    writePairLinkTx(tx, ring, TILL_ENV.WAITRON_NODE_ID, {
      role: "serves",
      state: "awaiting_copy",
      peerNodeId: MIRROR_ORIGIN_NODE,
      peerPublicKey: "pub",
      storeUrl: "https://box-7777.waitron.local:7443",
      venueId: "venue",
      accessKeyId: PAIR_ACCESS_KEY_ID,
      secretAccessKey: PAIR_SECRET,
    }),
  );
  return () =>
    withNodeTransaction(stores[venue].node, (tx) => deletePairLinkTx(tx, TILL_ENV.WAITRON_NODE_ID));
}

/** What the stand-in recorded once it started; then that its process is gone after `close`. */
async function expectStoreRan(dir: string, stateDir: string, loopbackPort: number) {
  await vi.waitFor(async () => expect(await readFile(join(dir, "pid"), "utf8")).not.toBe(""), {
    timeout: 10_000,
  });
  const args = (await readFile(join(dir, "args"), "utf8")).trimEnd().split("\n");
  expect(args).toEqual([
    "--port",
    `127.0.0.1:${loopbackPort}`,
    "--region",
    "us-east-1",
    "posix",
    "--sidecar",
    join(stateDir, "pair-store", "meta"),
    join(stateDir, "pair-store", "data"),
  ]);
  const env = await readFile(join(dir, "env"), "utf8");
  expect(env).toContain(`ROOT_ACCESS_KEY_ID=${PAIR_ACCESS_KEY_ID}\n`);
  expect(env).toContain(`ROOT_SECRET_ACCESS_KEY=${PAIR_SECRET}\n`);
  return Number((await readFile(join(dir, "pid"), "utf8")).trim());
}

/** Whether something accepts a TCP connection on 127.0.0.1:`port`. */
function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connectTcp(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

/** The store's listener serves a leaf naming this box under `BOX_TLS`'s authority, whose own leaf
 * names only the venue: so the start's leaf repair reached the listener. */
async function expectStoreServesOwnName(port: number) {
  const ownName = boxHostnameFor(TILL_ENV.WAITRON_NODE_ID);
  const served = await peerCertificate({ port, ca: BOX_TLS.caCertPem, servername: ownName });
  expect(served?.checkHost(ownName)).toBe(ownName);
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function seedIdentity(admin: Database): Promise<void> {
  // `onConflictDoNothing` is untargeted: nothing here reads the result.
  await admin
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90222222J", legalName: "Mirror SL" })
    .onConflictDoNothing();
  await admin
    .insert(locations)
    .values({
      id: TILL_LOCATION_ID,
    })
    .onConflictDoNothing();
  await seedVenueSettings(admin, {
    name: "Loc",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
  });
  await seedBusinessDay(admin, {});
  await admin
    .insert(nodes)
    .values({
      id: TILL_ENV.WAITRON_NODE_ID,
      name: "Node",
    })
    .onConflictDoNothing();
  await admin
    .insert(invoiceSeries)
    .values({
      id: SEEDED_SERIES_ID,
      nodeId: TILL_ENV.WAITRON_NODE_ID,
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
  await seedPersons(db.mirror, { id: MIRROR_STAFF_ID, displayName: "Martha", role: "staff" });
  // The primary directory writes no `node_mode` row: `readNodeMode` reads it as 'primary'.
  await stampDeployment(db.mirror, "preproduction");
  await setNodeMode(
    { venue: db.mirror, node: stores.mirror.node },
    TILL_ENV.WAITRON_NODE_ID,
    "mirror",
  );
  await stampDeployment(db.primary, "preproduction");
  await stampDeployment(db.noConfig, "preproduction");
  await setNodeMode(
    { venue: db.noConfig, node: stores.noConfig.node },
    TILL_ENV.WAITRON_NODE_ID,
    "mirror",
  );
  // Adoption-pending: stamped and mode 'mirror', but deliberately NOT seeded with the till identity.
  await stampDeployment(db.adopting, "preproduction");
  await setNodeMode(
    { venue: db.adopting, node: stores.adopting.node },
    TILL_ENV.WAITRON_NODE_ID,
    "mirror",
  );

  // `noConfig` deliberately gets none.
  await writeMirrorLink(stores.mirror.node, TILL_ENV.WAITRON_NODE_ID, {
    originUrl: MIRROR_ORIGIN_URL,
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

/** Poll `predicate` up to ~10s for its first defined value. */
async function poll<T>(predicate: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}

describe("mirror-mode boot (node_mode.mode = 'mirror')", () => {
  it("issues no session locally and keeps the remote staff entrance closed", async () => {
    const [localPort, staffPort] = await freePorts(2);
    const certificate = mintSelfSignedServerCert({
      hostnames: ["staff.example.test"],
      ipAddresses: [],
      now: new Date(),
    });
    mkdirSync(join(STATE_ROOT, "cloud"), { recursive: true });
    writeFileSync(join(STATE_ROOT, "cloud/staff.key"), certificate.serverKeyPem);
    writeFileSync(join(STATE_ROOT, "cloud/staff.crt"), certificate.serverCertPem);
    const server = await startConfiguredServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.mirror,
      WAITRON_HTTP_PORT: String(localPort),
      WAITRON_STAFF_ORIGIN: "https://staff.example.test",
      WAITRON_STAFF_PORT: String(staffPort),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      const local = await fetch(`http://127.0.0.1:${localPort}/management-api/catalogues`);
      expect(local.headers.get("set-cookie")).toBeNull();
      expect(local.status).toBe(403);
      await local.arrayBuffer();
      const remote = new Promise<number>((resolve, reject) => {
        const request = get(
          {
            hostname: "127.0.0.1",
            port: staffPort,
            path: "/management-api/catalogues",
            servername: "staff.example.test",
            rejectUnauthorized: false,
            headers: { Host: "staff.example.test" },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode!));
          },
        );
        request.on("error", reject);
      });
      await expect(remote).rejects.toMatchObject({ code: "ECONNREFUSED" });
    } finally {
      await server.close();
    }
  });

  it("serves only spare status, refuses private reads and writes, and creates no anonymous session", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.mirror,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      for (const path of ["/", "/manage", "/manage/staff"]) {
        const page = await fetch(`${base}${path}`, { headers: { accept: "text/html" } });
        expect(page.status).toBe(200);
        expect(page.headers.get("set-cookie")).toBeNull();
        expect(page.headers.get("cache-control")).toBe("no-store");
        expect(await page.text()).toContain("Restaurant screens are closed here");
      }
      const declaration = await fetch(`${base}/legal/declaration`);
      expect(declaration.status).toBe(404);
      expect(await declaration.text()).toContain(DECLARATION_PAGE_WORDS.en.noneTitle);
      const about = await fetch(`${base}/legal/about`);
      expect(about.status).toBe(200);
      expect(await about.json()).toMatchObject({ release: null });
      for (const path of [
        "/management-api/catalogues",
        `/management-api/staff/${MIRROR_STAFF_ID}/personal-data/export`,
      ]) {
        const read = await fetch(`${base}${path}`);
        expect(read.status).toBe(403);
        expect(read.headers.get("set-cookie")).toBeNull();
        expect(await read.json()).toMatchObject({ error: { code: "node.spare", params: {} } });
      }
      const cookie = `${MANAGEMENT_COOKIE}=forged`;
      for (const path of ["", "/export"]) {
        const invoiceCustomer = await fetch(
          `${base}/management-api/invoice-customers/personal-data${path}?taxId=12345678Z`,
          { headers: { cookie } },
        );
        expect(invoiceCustomer.status).toBe(403);
        expect(await invoiceCustomer.json()).toMatchObject({
          error: { code: "node.spare", params: {} },
        });
      }

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

      // Removing a machine from the chart is a write; the primary control below answers 401.
      const removal = await fetch(`${base}/management-api/servers/${crypto.randomUUID()}/remove`, {
        method: "POST",
        headers: { cookie },
      });
      expect(removal.status).toBe(403);
      expect(await removal.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      const printStatus = await fetch(`${base}/print-api/agent/join/status`);
      expect(printStatus.status).toBe(403);
      const pageClaim = await fetch(`${base}/print-api/agent/page-jobs/claim`, { method: "POST" });
      expect(pageClaim.status).toBe(403);
      expect(await pageClaim.json()).toEqual({ error: { code: "node.read_only", params: {} } });
      const deviceStation = await fetch(`${base}/api/device/station-screen`);
      expect(deviceStation.status).toBe(403);

      const heldOrders = await fetch(`${base}/api/working-orders`);
      expect(heldOrders.status).toBe(403);
      expect(await heldOrders.json()).toMatchObject({ error: { code: "node.spare", params: {} } });

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
    expect(
      (await db.mirror.select().from(persons)).some((p) => p.id === MIRROR_VIEWER_PERSON_ID),
    ).toBe(false);
    expect(await db.mirror.select().from(managementSessions)).toEqual([]);
  }, 60_000);

  it("runs the trivial empty pass on a mirror — the fiscal drain (AEAT submission) is never invoked", async () => {
    // A node that is not the singleton primary must never file to AEAT under a chain it does not
    // own. `startServer` builds its AEAT client internally, so this drives the pass
    // as boot wires it — `singletonPass` around `runPass` with the real drainer — with a
    // `resolveClient` tripwire in place of the transport.

    // A pending envío this node must NOT submit.
    const seeded = await seedFiscalRegistro(db.mirror, {
      ids: {
        locationId: TILL_LOCATION_ID,
        nodeId: TILL_ENV.WAITRON_NODE_ID,
        seriesId: SEEDED_SERIES_ID,
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

    // The role `setNodeMode('mirror')` set, not one invented for the test.
    const role = (await readNodeMode(stores.mirror.node, TILL_ENV.WAITRON_NODE_ID)).singletonRole;
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
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      const bundle = await fetch(`${base}/management-api/mirror-bundle`, { method: "POST" });
      expect(bundle.status).toBe(401);
      expect((await bundle.json()).error.code).toBe("password.invalid");

      const servers = await fetch(`${base}/management-api/servers`);
      expect(servers.status).toBe(401);
      expect((await servers.json()).error.code).toBe("management_session.required");
      const removal = await fetch(`${base}/management-api/servers/${crypto.randomUUID()}/remove`, {
        method: "POST",
      });
      expect(removal.status).toBe(401);
      expect((await removal.json()).error.code).toBe("management_session.required");

      const printStatus = await fetch(`${base}/print-api/agent/join/status`);
      expect(printStatus.status).toBe(200);
      const printJobs = await fetch(`${base}/print-api/agent/jobs`, { method: "POST" });
      expect(printJobs.status).not.toBe(404);
      const pageClaim = await fetch(`${base}/print-api/agent/page-jobs/claim`, { method: "POST" });
      expect(pageClaim.status).toBe(401);
      expect(await pageClaim.json()).toEqual({ error: { code: "agent.unauthorized", params: {} } });
      const deviceStation = await fetch(`${base}/api/device/station-screen`);
      expect(deviceStation.status).not.toBe(404);

      // Both boots are unfenced, so `mode` is the only axis that differs.
      const probe = await fetch(`${base}/api/node`);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({
        nodeId: TILL_ENV.WAITRON_NODE_ID,
        acceptingSales: true,
      });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a primary's mirror-bundle route wakes the running spare join", async () => {
    joinWiring.wakes = 0;
    joinWiring.wakeSpareJoin = undefined;
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.primary,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      joinWiring.wakeSpareJoin!();
      expect(joinWiring.wakes).toBe(1);
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a mirror runs no check (control: the same identity booted as primary runs it once)", async () => {
    for (const [venue, calls] of [
      ["mirror", 0],
      ["primary", 1],
    ] as const) {
      const peerCheck = vi.fn(() =>
        Promise.resolve({ result: "proceed" as const, successorNodeId: null }),
      );
      const port = await freePort();
      const env = {
        ...KEY_ENV,
        WAITRON_VENUE_DIR: venueDir[venue],
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
      };
      const server = await startServer(env, {}, { peerCheck });
      try {
        expect({ venue, calls: peerCheck.mock.calls.length }).toEqual({ venue, calls });
      } finally {
        await server.close();
      }
    }
  }, 60_000);

  it("a primary keeps its release's declaration at start; a mirror keeps none", async () => {
    const declaration = await mkdtemp(join(tmpdir(), "waitron-mirror-declaration-"));
    try {
      await writeDeclarationFolder(declaration);
      const kept = async (venue: VenueName) =>
        (
          await db[venue].all<{ version: string }>(
            sql`select version from declaraciones_responsables`,
          )
        ).map((row) => row.version);
      for (const [venue, versions] of [
        ["mirror", []],
        ["primary", [TEST_RELEASE.version]],
      ] as const) {
        const port = await freePort();
        const server = await startServer(
          {
            ...KEY_ENV,
            WAITRON_VENUE_DIR: venueDir[venue],
            WAITRON_HTTP_PORT: String(port),
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
          },
          {},
          { declarationRoot: declaration },
        );
        await server.close();
        expect({ venue, versions: await kept(venue) }).toEqual({ venue, versions });
      }
    } finally {
      await rm(declaration, { recursive: true, force: true });
    }
  }, 60_000);

  it.each(["primary", "mirror"] as const)(
    "%s boot revokes a previously valid viewer token",
    async (venue) => {
      // Resolving the token before the boot is the control: without it, a refusal afterwards would
      // look the same whether or not boot acted.
      beforeServerStarts();
      const token = mintSessionToken();
      await withTransaction(db[venue], async (tx) => {
        await seedPersons(tx, {
          id: MIRROR_VIEWER_PERSON_ID,
          displayName: "Old viewer",
          role: "admin",
        });
        await tx.insert(managementSessions).values({
          id: MIRROR_VIEWER_SESSION_ID,
          personId: MIRROR_VIEWER_PERSON_ID,
          tokenHash: hashSessionToken(token),
        });
      });
      await expect(
        withTransaction(db[venue], (tx) => resolveManagementSession(tx, token)),
      ).resolves.toMatchObject({ authority: { admin: true } });

      const port = await freePort();
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: venueDir[venue],
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
      });
      const base = `http://127.0.0.1:${httpPort()}`;
      try {
        const read = await fetch(`${base}/management-api/catalogues`, {
          headers: { cookie: `${MANAGEMENT_COOKIE}=${token}` },
        });
        expect(read.status).toBe(venue === "mirror" ? 403 : 401);
        const answer = await read.json();
        if (venue === "primary") {
          expect(answer).toEqual({ error: { code: "management_session.required", params: {} } });
        } else {
          expect(answer).toMatchObject({ error: { code: "node.spare", params: {} } });
        }
      } finally {
        await server.close();
      }
      beforeServerStarts();
      await expect(
        withTransaction(db[venue], (tx) => resolveManagementSession(tx, token)),
      ).rejects.toMatchObject({ code: "management_session.required" });
    },
    60_000,
  );

  it("refuses private reads even with a real administrator session cookie", async () => {
    beforeServerStarts();
    const token = mintSessionToken();
    const personId = crypto.randomUUID();
    await withTransaction(db.mirror, async (tx) => {
      await seedPersons(tx, { id: personId, displayName: "Administrator", role: "admin" });
      await tx.insert(managementSessions).values({ personId, tokenHash: hashSessionToken(token) });
    });
    await expect(
      withTransaction(db.mirror, (tx) => resolveManagementSession(tx, token)),
    ).resolves.toMatchObject({ authority: { admin: true } });
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.mirror,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      for (const path of [
        "/management-api/catalogues",
        `/management-api/staff/${MIRROR_STAFF_ID}/personal-data/export`,
      ]) {
        const read = await fetch(`http://127.0.0.1:${httpPort()}${path}`, {
          headers: { cookie: `${MANAGEMENT_COOKIE}=${token}` },
        });
        expect(read.status).toBe(403);
        expect(await read.json()).toMatchObject({ error: { code: "node.spare", params: {} } });
      }
      for (const path of ["/setup/trust", "/help/en/products"]) {
        const read = await fetch(`http://127.0.0.1:${httpPort()}${path}`);
        expect(read.status).toBe(200);
        await read.arrayBuffer();
      }
    } finally {
      await server.close();
    }
    beforeServerStarts();
    await expect(
      withTransaction(db.mirror, (tx) => resolveManagementSession(tx, token)),
    ).resolves.toMatchObject({ authority: { admin: true } });
  }, 60_000);

  it("a mirror boot listens on a non-loopback host", async () => {
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.mirror,
      WAITRON_HTTP_HOST: "0.0.0.0",
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      const answer = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
      expect(answer.status).toBe(200);
      await answer.arrayBuffer();
    } finally {
      await server.close();
    }
  }, 60_000);

  it("keeps private reads closed on a non-loopback host", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venueDir.mirror,
      WAITRON_HTTP_HOST: "0.0.0.0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      const read = await fetch(`${base}/management-api/catalogues`);
      expect(read.status).toBe(403);
      expect(read.headers.get("set-cookie")).toBeNull();
      expect(await read.json()).toMatchObject({ error: { code: "node.spare", params: {} } });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a mirror start answers only its own name (control: the same identity as primary answers the venue's too)", async () => {
    for (const [venue, answered] of [
      ["mirror", ["box-3333.waitron.local"]],
      ["primary", ["box-3333.waitron.local", "waitron.local"]],
    ] as const) {
      const mdns = fakeMdnsSocket();
      const server = await startServer(
        {
          ...KEY_ENV,
          WAITRON_VENUE_DIR: venueDir[venue],
          WAITRON_HTTP_HOST: "0.0.0.0",
          WAITRON_HTTP_PORT: String(await freePort()),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
        },
        {},
        { mdnsSocket: () => mdns.socket },
      );
      try {
        const asked = ["box-3333.waitron.local", "waitron.local", "box-7777.waitron.local"];
        for (const name of asked) mdns.query(name);
        expect({ venue, answered: mdns.answered() }).toEqual({ venue, answered });
      } finally {
        await server.close();
      }
    }
  }, 60_000);

  it("a spare's full start runs its store on loopback with the pair's key, serves the leaf the start repaired, and stops it on close", async () => {
    const fake = await fakeVersitygw();
    const removePair = await servePair("mirror");
    const [httpPortNumber, loopbackPort, storePort] = await freePorts(3);
    await writeTlsSet(STATE_ROOT, BOX_TLS);
    let pid: number | undefined;
    try {
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: venueDir.mirror,
        WAITRON_HTTP_PORT: String(httpPortNumber),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_VERSITYGW_BIN: fake.bin,
        WAITRON_SPARE_STORE_LOOPBACK_PORT: String(loopbackPort),
        WAITRON_SPARE_STORE_PORT: String(storePort),
      });
      try {
        pid = await expectStoreRan(fake.dir, STATE_ROOT, loopbackPort!);
        expect(running(pid)).toBe(true);
        expect(await accepts(storePort!)).toBe(true);
        await expectStoreServesOwnName(storePort!);
      } finally {
        await server.close();
      }
      expect(running(pid)).toBe(false);
      expect(await accepts(storePort!)).toBe(false);
    } finally {
      await removePair();
      await rm(fake.dir, { recursive: true, force: true });
      await rm(join(STATE_ROOT, "pair-store"), { recursive: true, force: true });
      await rm(join(STATE_ROOT, "tls"), { recursive: true, force: true });
    }
  }, 60_000);

  it("a mirror with no pair link starts no store (control: the same box with one starts it)", async () => {
    const fake = await fakeVersitygw();
    try {
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: venueDir.mirror,
        WAITRON_HTTP_PORT: String(await freePort()),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_VERSITYGW_BIN: fake.bin,
      });
      await server.close();
      await expect(readFile(join(fake.dir, "pid"), "utf8")).rejects.toThrow();
    } finally {
      await rm(fake.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses a mirror boot that has no node_mirror_link row (a mirror REQUIRES its DB connection config)", async () => {
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
      variable: "node_mirror_link",
      reason: "mirror_requires_mirror_link",
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
    // Inert: this database holds no row for this box, so `runFinishAdoption` logs
    // `adoption.establish_failed` and keeps the latch rather than failing the boot.
    writeFileSync(
      join(stateDir, "pending-adoption.json"),
      JSON.stringify({
        standby: {
          nodeId: "88888888-8888-4888-8888-888888888888",
          publicKey: "pub",
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
    const base = `http://127.0.0.1:${httpPort()}`;
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
      expect((await fetch(`${base}/help/en/products`)).status).toBe(200);
      const declaration = await fetch(`${base}/legal/declaration`);
      expect(declaration.status).toBe(404);
      expect(await declaration.text()).toContain(DECLARATION_PAGE_WORDS.en.noneTitle);
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

  it("a box still joining runs its store with the pair's key, serves the leaf the start repaired, and stops it on close", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "waitron-adopting-store-"));
    writeFileSync(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    writeFileSync(
      join(stateDir, "pending-adoption.json"),
      JSON.stringify({
        standby: { nodeId: "88888888-8888-4888-8888-888888888888", publicKey: "pub" },
        nodeName: "standby",
        filingModule: "fiscal-verifactu",
        taxModule: null,
        reserved: { modules: {}, series: [], endorsement: {} },
        originNodeId: MIRROR_ORIGIN_NODE,
      }),
      { mode: 0o600 },
    );
    const fake = await fakeVersitygw();
    const removePair = await servePair("adopting");
    const [httpPortNumber, loopbackPort, storePort] = await freePorts(3);
    await writeTlsSet(stateDir, BOX_TLS);
    try {
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: venueDir.adopting,
        WAITRON_HTTP_PORT: String(httpPortNumber),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_VERSITYGW_BIN: fake.bin,
        WAITRON_SPARE_STORE_LOOPBACK_PORT: String(loopbackPort),
        WAITRON_SPARE_STORE_PORT: String(storePort),
      });
      let pid: number;
      try {
        pid = await expectStoreRan(fake.dir, stateDir, loopbackPort!);
        expect(running(pid)).toBe(true);
        expect(await accepts(storePort!)).toBe(true);
        await expectStoreServesOwnName(storePort!);
      } finally {
        await server.close();
      }
      expect(running(pid)).toBe(false);
      expect(await accepts(storePort!)).toBe(false);
    } finally {
      await removePair();
      await rm(fake.dir, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a box still joining reissues, before it serves, a leaf that does not name it", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "waitron-adopting-leaf-"));
    writeFileSync(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    writeFileSync(
      join(stateDir, "pending-adoption.json"),
      JSON.stringify({
        standby: { nodeId: "88888888-8888-4888-8888-888888888888", publicKey: "pub" },
        nodeName: "standby",
        filingModule: "fiscal-verifactu",
        taxModule: null,
        reserved: { modules: {}, series: [], endorsement: {} },
        originNodeId: MIRROR_ORIGIN_NODE,
      }),
      { mode: 0o600 },
    );
    await ensureBoxSecrets({ stateDir, hostnames: ["localhost"], now: () => new Date() });
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venueDir.adopting,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      // The handshake completes only if the served leaf names this box.
      const served = await peerCertificate({
        port: httpPort(),
        ca,
        servername: "box-3333.waitron.local",
      });
      expect(served?.subjectAltName).toContain("DNS:waitron.local");
    } finally {
      await server.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
  }, 60_000);
});
