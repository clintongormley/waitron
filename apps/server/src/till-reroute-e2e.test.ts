import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
  tenants,
  tills,
  workingOrders,
  writeMirrorConfig,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { hashPin, hashSecret, persons } from "@waitron/identity";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer, type StartedServer } from "./boot.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

// The till-reroute HEADLINE proof (S6, till-reroute design §6): TWO booted `apps/server` instances
// (two `startServer` boots, in ONE test process — not two OS processes), each on its OWN venue
// DIRECTORY of SQLite files. One venue, two nodes: A (primary, box) and B (mirror, cloud), with the
// SAME identity seeded directly into each directory, because nothing copies rows between the two
// nodes: the PostgreSQL replication that used to is deleted and its replacement has not landed.
//
// WHAT WENT WITH POSTGRESQL, AND IS NOT REPLACED. The suite used to justify a real container by the
// venue-wide read running under `app_user` (`super = false`) rather than a PGlite superuser, so that
// a missing GRANT failed here. There is no role on this engine: `pg.connectAs` has no counterpart and
// `asAppUser` is an inert function (`packages/db/src/testing/roles.ts`), and every call below runs on
// the one connection each directory has. Nothing now checks that the deployment role may take the
// venue-wide read. What the case still proves is the reroute itself — the three `/api/node` bodies,
// the standby's refusals, and a promoted node inheriting the dead node's tab.
//
// The arc:
//
//   1. A answers `acceptingSales:true`, B `:false` — the truth a till's `ServerRouter` routes on, taken
//      from the REAL boot posture, not a stub.
//   2. B (a standby) refuses a till login (read-only gate → `node.read_only`) and mounts no device group.
//   3. The seeded device cookie authenticates on A (the selling node); A logs a till in.
//   4. A goes down (its listener closes; a till sees an unreachable box). B is promoted (the deployment
//      flip a human's promote performs; Track B item 3 builds the endpoint) and RESTARTED —
//      `acceptingSales` is boot-captured, so an un-restarted B still answers false, and only the fresh
//      boot flips it true.
//   5. The SAME device cookie authenticates on the promoted B, the till re-logs-in, and the venue's open
//      tab — tagged with the DEAD node's id — is inherited by the now venue-wide read (§3.6).
//
// The three distinct `/api/node` bodies this observes are pinned to
// `apps/till/src/api/__fixtures__/node-probe.json`, the contract file the till-side
// `server-router.contract.test.ts` replays through the router — both sides read the one JSON, so a
// wire-shape drift fails a `toEqual` here before the router contract runs.

// One venue: shared tenant/location/till, DISTINCT nodes (so B reading a NODE_A-tagged tab is a genuine
// cross-node, venue-wide read) each with its own series. Fixed ids so `/api/node.nodeId` is deterministic
// and matches the committed fixture.
const LOCATION = "55555555-5555-4555-8555-555555555555";
const TILL = "22222222-2222-4222-8222-222222222222";
const NODE_A = "33333333-3333-4333-8333-333333333333";
const NODE_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERIES_A = "44444444-4444-4444-8444-444444444444";
const SERIES_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSON = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEVICE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
// A device is defined by its profile's form factor now (no device_kind column): a `till` profile means
// the binding rule requires a register (till_id), not a station.
const DEVICE_PROFILE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const DEVICE_TOKEN = "reroute-e2e-device-token";
// The venue's one open tab, tagged with A's node id — the tab A had opened, seeded straight into B's
// database, because nothing copies it there today (the deletion the header above records). It is the
// state a replicated tab WOULD have been in under that deleted replication, which classed live-service
// rows as copied to a standby and never drained back (swap spec §4.3). Only B carries it: the proof is
// that a promoted B inherits it.
const TAB_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const DEVICE_COOKIE_HEADER = `${DEVICE_COOKIE}=${DEVICE_ID}.${DEVICE_TOKEN}`;

interface NodeProbeBody {
  nodeId: string;
  term: number | null;
  standing: string | null;
  acceptingSales: boolean;
  environment: string;
}

// The shared contract file, read from disk (not imported) so this suite and the till-side router
// contract test consume the exact same bytes.
const FIXTURE = JSON.parse(
  readFileSync(new URL("../../till/src/api/__fixtures__/node-probe.json", import.meta.url), "utf8"),
) as { aPrimary: NodeProbeBody; bStandby: NodeProbeBody; bPrimary: NodeProbeBody };

// The credentials key + media/state dirs a trading boot requires, and a `modules.json` resolving the
// two-member fiscal slot to Veri*Factu (else the default-on both-enabled set refuses
// `module.fiscal_slot_ambiguous`), under this suite's own temp root.
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-reroute-e2e-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const KEY_ENV = {
  // Task 3: keep the plain-HTTP landing listener (default port 80) OUT of every boot test — 80 is
  // privileged, and a root CI container would otherwise stand up a live service on it. Its own
  // behaviour is proven directly in landing-listener.test.ts.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_ENV: "preproduction",
};

// One venue directory per node, migrated through the product's own `applyMigrations` — the same
// entry point boot calls, so each directory carries the append-only triggers a box carries. The
// long-lived handle beside it is this suite's seeding and promotion connection; it stays open
// alongside the booted server's own open of the same directory, which write-ahead mode and the
// store's `busy_timeout` allow (`packages/store/src/index.ts`).
let venueDirA: string;
let venueDirB: string;
let storeA: VenueDatabase;
let storeB: VenueDatabase;
let a: Database;
let b: Database;

let migrationsRoot: string;

/** Seed the venue's identity (tenant, location, both nodes, till, both series) plus a staff person on
 * PIN 5555 and the till device, on one venue directory. The device's `token_hash`
 * is the scrypt hash of `DEVICE_TOKEN` (`hashSecret`, the same function `acceptDeviceJoinRequest`
 * stores), so the `waitron_device=<id>.<token>` cookie built above authenticates against this row on
 * whichever node holds it. Seeded identically on A and B — the "same device rows seeded directly" the
 * design names. */
async function seedVenue(db: Database): Promise<void> {
  // Through the table definitions, not raw SQL. Every id here is supplied explicitly (the two nodes
  // and both series must match the constants the reroute is asserted against), so this is not about
  // generated ids — it is the `array['en']::text[]` constructor and the `'[]'::jsonb` cast, both of
  // which this engine refuses, plus the `created_at`/`enrolled_at` stamps that are JavaScript
  // generators a raw insert never reaches. The untargeted `on conflict do nothing` becomes a
  // primary-key-targeted one at each call: every row here is keyed by the id it supplies, and an
  // untargeted form absorbs EVERY unique conflict rather than the one the caller means
  // (CLAUDE.md §3).
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90444444A", legalName: "Reroute E2E SL" })
    .onConflictDoNothing({ target: tenants.id });
  await db
    .insert(locations)
    .values({
      id: LOCATION,
      name: "Loc",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing({ target: locations.id });
  for (const node of [NODE_A, NODE_B]) {
    await db
      .insert(nodes)
      .values({ id: node, locationId: LOCATION, name: "Node" })
      .onConflictDoNothing({ target: nodes.id });
  }
  await db
    .insert(tills)
    .values({ id: TILL, locationId: LOCATION, name: "Till" })
    .onConflictDoNothing({ target: tills.id });
  await db
    .insert(invoiceSeries)
    .values({ id: SERIES_A, nodeId: NODE_A, code: "A" })
    .onConflictDoNothing({ target: invoiceSeries.id });
  await db
    .insert(invoiceSeries)
    .values({ id: SERIES_B, nodeId: NODE_B, code: "B" })
    .onConflictDoNothing({ target: invoiceSeries.id });
  await db
    .insert(persons)
    .values({ id: PERSON, displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
    .onConflictDoNothing({ target: persons.id });
  await db
    .insert(deviceProfiles)
    .values({ id: DEVICE_PROFILE, name: "Counter", formFactor: "till", capabilities: [] })
    .onConflictDoNothing({ target: deviceProfiles.id });
  await db
    .insert(devices)
    .values({
      id: DEVICE_ID,
      locationId: LOCATION,
      deviceProfileId: DEVICE_PROFILE,
      tillId: TILL,
      label: "Counter till",
      tokenHash: hashSecret(DEVICE_TOKEN),
    })
    .onConflictDoNothing({ target: devices.id });
}

/** An OS-assigned free port, released before use — WAITRON_HTTP_PORT rejects "0", so the host cannot
 * bind an ephemeral port itself. */
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

/** The env for a PRIMARY (selling) boot of `nodeId`/`seriesId` on `venueDir` at `port`. */
function primaryEnv(
  venueDir: string,
  port: number,
  nodeId: string,
  seriesId: string,
): Record<string, string> {
  return {
    ...KEY_ENV,
    WAITRON_TILL_TILL_ID: TILL,
    WAITRON_TILL_NODE_ID: nodeId,
    WAITRON_TILL_SERIES_ID: seriesId,
    WAITRON_TILL_LOCATION_ID: LOCATION,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
  };
}

/** The env for B's MIRROR boot: no mirror config rides in env. A mirror boot REQUIRES a `mirror_config`
 * row (seeded in beforeAll) and reads its DATA SCOPE from it — `origin_node_id`, the primary whose rows
 * its node-scoped reads display; an absent row is a loud `server.config_invalid` (boot.ts). */
function mirrorEnv(venueDir: string, port: number): Record<string, string> {
  return {
    ...KEY_ENV,
    WAITRON_TILL_TILL_ID: TILL,
    WAITRON_TILL_NODE_ID: NODE_B,
    WAITRON_TILL_SERIES_ID: SERIES_B,
    WAITRON_TILL_LOCATION_ID: LOCATION,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
  };
}

async function probe(port: number): Promise<NodeProbeBody> {
  return (await fetch(`http://127.0.0.1:${port}/api/node`)).json() as Promise<NodeProbeBody>;
}

function get(port: number, path: string, cookie: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie } });
}

function post(port: number, path: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify(body),
  });
}

/** The `name=value` of the first Set-Cookie on a response — the session cookie a login hands back. */
function cookieOf(res: Response): string {
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

beforeAll(async () => {
  // The migrations root: boot's from-source default does not exist, so WAITRON_MIGRATIONS_DIR must
  // point applyMigrations at the journal content copied out per manifest set.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-reroute-e2e-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  // Each directory is migrated through `applyMigrations` — the product's own entry point, which
  // installs each set's append-only triggers as well as its tables — before either handle is
  // opened. Boot re-runs it over the same directory, which drizzle makes a no-op.
  venueDirA = await mkdtemp(join(tmpdir(), "waitron-reroute-e2e-venue-a-"));
  venueDirB = await mkdtemp(join(tmpdir(), "waitron-reroute-e2e-venue-b-"));
  await applyMigrations(venueDirA, fromSource);
  await applyMigrations(venueDirB, fromSource);
  storeA = await openVenueDatabase(venueDirA);
  storeB = await openVenueDatabase(venueDirB);
  a = storeA.venue;
  b = storeB.venue;

  await seedVenue(a);
  await seedVenue(b);

  // B is the mirror: stamp it, flip mode='mirror' (co-sets singleton_role='secondary'), and seed the
  // `mirror_config` row a mirror boot requires. A keeps the 'primary'/'primary' column defaults; a
  // stamp is all it needs.
  await stampDeployment(a, "preproduction");
  await stampDeployment(b, "preproduction");
  await setDeploymentMode(b, "mirror");
  await writeMirrorConfig(b, {
    relayUrl: "http://127.0.0.1:1/",
    boxHostname: "reroute-box.local",
    boxCaPem: mintSelfSignedServerCert({
      hostnames: ["reroute-box.local"],
      ipAddresses: [],
      now: new Date(),
    }).caCertPem,
    originNodeId: NODE_A,
  });

  // The inherited tab: an open working order in B's database tagged with the DEAD node's id (A's).
  // `working_orders.opened_at` is a JavaScript generator on this engine, so this goes through the
  // table definition like the rest of the fixture; the conflict target is the id this row supplies.
  await b
    .insert(workingOrders)
    .values({ id: TAB_ID, tillId: TILL, nodeId: NODE_A, orderNumber: 1, status: "open" })
    .onConflictDoNothing({ target: workingOrders.id });
}, 180_000);

afterAll(async () => {
  // Closed before their directories are removed, and each guarded on its own so a store that never
  // opened does not stop the rest of the teardown.
  if (storeA !== undefined) await storeA.close();
  if (storeB !== undefined) await storeB.close();
  for (const dir of [venueDirA, venueDirB, migrationsRoot])
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

describe("till reroute — two instances, one venue", () => {
  it("A primary, B standby; A goes down; B promoted+restarted; the device cookie follows and the venue's tab is inherited", async () => {
    const portA = await freePort();
    const portB = await freePort();
    const serverA = await startServer(primaryEnv(venueDirA, portA, NODE_A, SERIES_A));
    // B's boot is inside the try so a rejection there still closes A in the finally (no leaked listener).
    let serverB: StartedServer | undefined;
    try {
      serverB = await startServer(mirrorEnv(venueDirB, portB));
      // 1. The probes the router routes on, from the REAL boot posture — pinned to the shared contract
      // fixture. FAILING CASE: a wire-shape drift (a renamed field, a missing one) fails this `toEqual`
      // before the router contract test ever runs.
      expect(await probe(portA)).toEqual(FIXTURE.aPrimary);
      expect(await probe(portB)).toEqual(FIXTURE.bStandby);

      // 2. B is a standby: it refuses a till login at the door (the read-only gate 403s every write on a
      // mirror) and mounts no device group (404). FAILING CASE: were the read-only gate to miss POST, B
      // would 200 the login and a standby would be selling.
      const refused = await post(portB, "/api/session", { personId: PERSON, pin: "5555" });
      expect(refused.status).toBe(403);
      expect((await refused.json()).error.code).toBe("node.read_only");
      expect((await get(portB, "/api/device/me", DEVICE_COOKIE_HEADER)).status).toBe(404);

      // 3. The seeded device cookie authenticates on A (the selling node), and A logs the till in.
      const meOnA = await get(portA, "/api/device/me", DEVICE_COOKIE_HEADER);
      expect(meOnA.status).toBe(200);
      expect((await meOnA.json()).deviceId).toBe(DEVICE_ID);
      const loginA = await post(
        portA,
        "/api/session",
        { personId: PERSON, pin: "5555" },
        DEVICE_COOKIE_HEADER,
      );
      expect(loginA.status).toBe(200);

      // 4. A goes down — its listener closes, which a till sees as an unreachable box. FAILING CASE: a
      // probe of a live A resolves; a closed listener rejects.
      await serverA.close();
      await expect(fetch(`http://127.0.0.1:${portA}/api/node`)).rejects.toThrow();

      // 5. Promote B at the DB level — the deployment flip a human's promote performs (Track B item 3
      // builds the endpoint).
      await setDeploymentMode(b, "primary");
      await setSingletonRole(b, "primary");

      // The boot-captured control (node-api.ts, §3.1) — the measurement where a live read and the
      // captured one genuinely differ (CLAUDE.md §1): the STILL-RUNNING mirror keeps answering
      // `acceptingSales:false` even though the DB now says primary, because the flag is read ONCE at boot,
      // never live. A live read would already be true here, and a till would move to a node that has not
      // completed its promotion reboot. Only the restart below flips it true.
      expect((await probe(portB)).acceptingSales).toBe(false);
      await serverB.close();
      serverB = undefined;

      const serverB2 = await startServer(primaryEnv(venueDirB, portB, NODE_B, SERIES_B));
      try {
        // The promoted, restarted B now accepts sales — pinned to the fixture's `bPrimary` body.
        expect(await probe(portB)).toEqual(FIXTURE.bPrimary);

        // 6. The SAME device cookie authenticates on the promoted B, the till re-logs-in, and the venue's
        // open tab — tagged with the DEAD node's id — is returned by the now venue-wide read. FAILING
        // CASE: the pre-§3.6 own-node filter would hide NODE_A's tab from B (whose own node is NODE_B).
        expect((await get(portB, "/api/device/me", DEVICE_COOKIE_HEADER)).status).toBe(200);
        const loginB = await post(
          portB,
          "/api/session",
          { personId: PERSON, pin: "5555" },
          DEVICE_COOKIE_HEADER,
        );
        expect(loginB.status).toBe(200);
        const held = await get(portB, "/api/working-orders", cookieOf(loginB));
        expect(held.status).toBe(200);
        expect(((await held.json()) as { id: string }[]).map((o) => o.id)).toContain(TAB_ID);
      } finally {
        await serverB2.close();
      }
    } finally {
      if (serverB !== undefined) await serverB.close().catch(() => undefined);
      await serverA.close().catch(() => undefined);
    }
  }, 120_000);
});
