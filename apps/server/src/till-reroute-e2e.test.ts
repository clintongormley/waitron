import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
  writeMirrorConfig,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing } from "@waitron/credentials";
import { hashPin, hashSecret } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer, type StartedServer } from "./boot.js";
import { roleUrl } from "./testing/postgres.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { sealMirrorToken } from "./mirror-token.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

// The till-reroute HEADLINE proof (S6, till-reroute design §6): TWO booted `apps/server` instances
// (two `startServer` boots on two databases, in ONE test process — not two OS processes) on REAL
// Postgres. Real PG, not PGlite, because the venue-wide read runs under `app_user` (super=false) and a
// PGlite superuser holds every privilege, so a missing grant would pass there (CLAUDE.md §4); the second
// node also genuinely needs its own database. One venue, two nodes: A (primary, box) and B (mirror,
// cloud), each its own database with the SAME identity seeded directly, because replication of
// `devices`/`working_orders` is Track A's, not this slice's. The arc:
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
const TENANT = "11111111-1111-4111-8111-111111111111";
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
// database (the state a replicated tab would be in; swap spec §4.3, live-service rows are copied, never
// drained back). Only B carries it: the proof is that a promoted B inherits it.
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
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-reroute-e2e-media-"));
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-reroute-e2e-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_ENV: "preproduction",
};
const RING = loadKeyRing(KEY_ENV);

// One unreachable peer for a primary boot's push worker: port 1 has no listener, so the worker backs
// off and the box still binds and serves.
const SYNC_PEERS = JSON.stringify([
  {
    nodeId: "66666666-6666-4666-8666-666666666666",
    url: "http://127.0.0.1:1/",
    token: "peer-token",
  },
]);

const a = useTemplateDb({ template: "manifest" });
const b = useTemplateDb({ template: "manifest" });

let migrationsRoot: string;

/** Seed the venue's identity (tenant, location, both nodes, till, both series) plus a staff person on
 * PIN 5555 and the till device — all as the container superuser, on one clone. The device's `token_hash`
 * is the scrypt hash of `DEVICE_TOKEN` (`hashSecret`, the same function `enrolDevice` stores), so the
 * `waitron_device=<id>.<token>` cookie built above authenticates against this row on whichever node holds
 * it. Seeded identically on A and B — the "same device rows seeded directly" the design names. */
async function seedVenue(admin: Database): Promise<void> {
  await admin.execute(sql`insert into tenants (id, country, tax_id, legal_name)
    values (${TENANT}, 'ES', '90444444A', 'Reroute E2E SL') on conflict do nothing`);
  await admin.execute(sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${LOCATION}, ${TENANT}, 'Loc', array['en']::text[], 'Hospitality') on conflict do nothing`);
  for (const node of [NODE_A, NODE_B]) {
    await admin.execute(sql`insert into nodes (id, tenant_id, location_id, name)
      values (${node}, ${TENANT}, ${LOCATION}, 'Node') on conflict do nothing`);
  }
  await admin.execute(sql`insert into tills (id, tenant_id, location_id, name)
    values (${TILL}, ${TENANT}, ${LOCATION}, 'Till') on conflict do nothing`);
  await admin.execute(sql`insert into invoice_series (id, tenant_id, node_id, code)
    values (${SERIES_A}, ${TENANT}, ${NODE_A}, 'A') on conflict do nothing`);
  await admin.execute(sql`insert into invoice_series (id, tenant_id, node_id, code)
    values (${SERIES_B}, ${TENANT}, ${NODE_B}, 'B') on conflict do nothing`);
  await admin.execute(sql`insert into persons (id, tenant_id, display_name, pin_hash, role)
    values (${PERSON}, ${TENANT}, 'Cajera', ${hashPin("5555")}, 'staff') on conflict do nothing`);
  await admin.execute(sql`insert into device_profiles (id, tenant_id, name, form_factor, capabilities)
    values (${DEVICE_PROFILE}, ${TENANT}, 'Counter', 'till', '[]'::jsonb) on conflict do nothing`);
  await admin.execute(sql`insert into devices (id, tenant_id, location_id, device_profile_id, till_id, label, token_hash)
    values (${DEVICE_ID}, ${TENANT}, ${LOCATION}, ${DEVICE_PROFILE}, ${TILL}, 'Counter till', ${hashSecret(DEVICE_TOKEN)})
    on conflict do nothing`);
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

/** The env for a PRIMARY (selling) boot of `nodeId`/`seriesId` on `clone` at `port`: an unreachable
 * push peer + a retention connection, so the source-side workers mount and back off. */
function primaryEnv(
  clone: { pg: { uri: string } },
  port: number,
  nodeId: string,
  seriesId: string,
): Record<string, string> {
  return {
    ...KEY_ENV,
    WAITRON_TILL_TENANT_ID: TENANT,
    WAITRON_TILL_TILL_ID: TILL,
    WAITRON_TILL_NODE_ID: nodeId,
    WAITRON_TILL_SERIES_ID: seriesId,
    WAITRON_TILL_LOCATION_ID: LOCATION,
    DATABASE_URL: roleUrl(clone.pg.uri, "app_login", "app_pw"),
    WAITRON_MIGRATIONS_DATABASE_URL: clone.pg.uri,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_SYNC_DATABASE_URL: roleUrl(clone.pg.uri, "sync_applier", "ap"),
    WAITRON_SYNC_PEERS: SYNC_PEERS,
    WAITRON_SYNC_RETENTION_DATABASE_URL: roleUrl(clone.pg.uri, "sync_pruner", "pp"),
  };
}

/** The env for B's MIRROR boot: the pull connection comes from `mirror_config` + the vault (seeded in
 * beforeAll), not env, so only the local sync pool is passed. The relay is unreachable, so the pull
 * worker backs off and the box still binds and serves. */
function mirrorEnv(clone: { pg: { uri: string } }, port: number): Record<string, string> {
  return {
    ...KEY_ENV,
    WAITRON_TILL_TENANT_ID: TENANT,
    WAITRON_TILL_TILL_ID: TILL,
    WAITRON_TILL_NODE_ID: NODE_B,
    WAITRON_TILL_SERIES_ID: SERIES_B,
    WAITRON_TILL_LOCATION_ID: LOCATION,
    DATABASE_URL: roleUrl(clone.pg.uri, "app_login", "app_pw"),
    WAITRON_MIGRATIONS_DATABASE_URL: clone.pg.uri,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_SYNC_DATABASE_URL: roleUrl(clone.pg.uri, "sync_applier", "ap"),
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

  await seedVenue(a.admin);
  await seedVenue(b.admin);

  // B is the mirror: stamp it, flip mode='mirror' (co-sets singleton_role='secondary'), and seed the
  // DB-stored pull config a mirror boot requires (unreachable relay). A keeps the 'primary'/'primary'
  // column defaults; a stamp is all it needs.
  await stampDeployment(a.admin, "preproduction");
  await stampDeployment(b.admin, "preproduction");
  await setDeploymentMode(b.admin, "mirror");
  await writeMirrorConfig(b.admin, {
    relayUrl: "http://127.0.0.1:1/",
    boxHostname: "reroute-box.local",
    boxCaPem: mintSelfSignedServerCert({
      hostnames: ["reroute-box.local"],
      ipAddresses: [],
      now: new Date(),
    }).caCertPem,
    originNodeId: NODE_A,
  });
  await sealMirrorToken(b.admin, RING, TENANT, "reroute-peer-token");

  // The inherited tab: an open working order in B's database tagged with the DEAD node's id (A's).
  await b.admin
    .execute(sql`insert into working_orders (id, tenant_id, till_id, node_id, order_number, status)
    values (${TAB_ID}, ${TENANT}, ${TILL}, ${NODE_A}, 1, 'open') on conflict do nothing`);
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

describe("till reroute — two instances, one venue (real Postgres)", () => {
  it("A primary, B standby; A goes down; B promoted+restarted; the device cookie follows and the venue's tab is inherited", async () => {
    const portA = await freePort();
    const portB = await freePort();
    const serverA = await startServer(primaryEnv(a, portA, NODE_A, SERIES_A));
    // B's boot is inside the try so a rejection there still closes A in the finally (no leaked listener).
    let serverB: StartedServer | undefined;
    try {
      serverB = await startServer(mirrorEnv(b, portB));
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
      await setDeploymentMode(b.admin, "primary");
      await setSingletonRole(b.admin, "primary");

      // The boot-captured control (node-api.ts, §3.1) — the measurement where a live read and the
      // captured one genuinely differ (CLAUDE.md §1): the STILL-RUNNING mirror keeps answering
      // `acceptingSales:false` even though the DB now says primary, because the flag is read ONCE at boot,
      // never live. A live read would already be true here, and a till would move to a node that has not
      // completed its promotion reboot. Only the restart below flips it true.
      expect((await probe(portB)).acceptingSales).toBe(false);
      await serverB.close();
      serverB = undefined;

      const serverB2 = await startServer(primaryEnv(b, portB, NODE_B, SERIES_B));
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
