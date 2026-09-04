import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  readDeploymentAxes,
  readNodeMembership,
  setSingletonRole,
  stampDeployment,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing } from "@waitron/credentials";
import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { enrolPeer } from "@waitron/sync";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { mountSyncApi } from "./sync-api.js";
import { establishNodeIdentity } from "./node-identity.js";
import { roleUrl } from "./testing/postgres.js";

// Membership rejoin R1 (design §6) boot integration: a returned ex-primary whose held membership
// document marks it sell-only/evicted must come up FENCED — its saved singleton axis reconciled DOWN to
// 'secondary' (so the existing isSingletonPrimary gates suppress the submitter/reconciler/config-writer
// AND the authoritative sync source) and its whole write surface behind the read-only gate. Real
// Postgres is mandatory (CLAUDE.md §4): the demote is an OWNER-role write on `deployment` (app_user
// holds no UPDATE), and the singleton-source mount is served through the non-superuser `app_login`
// pool — both false passes on PGlite (every PGlite connection is a superuser).

// The till's fiscal identity — the five WAITRON_TILL_*_ID that put boot into TRADING mode. The NODE id
// is the one the fence read (`isFenced(held, config.till.nodeId)`) looks up in the held chart.
const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// A media dir under this suite's own temp root so boot's `mkdirSync(mediaDir)` never writes into
// `apps/server/src`. Created synchronously so `KEY_ENV` can reference it; torn down in `afterAll`.
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-fence-media-"));
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
  ...TILL_ENV,
};

// Short ticks so the boot loop's first (empty) pass lands inside the poll budget without a long idle
// sleep. No fiscal work is seeded, so no drain ever dials AEAT.
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

// A dead loopback sync peer so `loadSyncConfig` turns sync ON (sync is enabled iff WAITRON_SYNC_PEERS is
// a non-empty array — config.ts) and `mountSyncApi` is reached: the singleton SOURCE the fence must
// suppress. The pull worker dials this dead port in the background and backs off; it never blocks boot.
const SYNC_PEERS = JSON.stringify([
  {
    nodeId: "66666666-6666-4666-8666-666666666666",
    url: "http://127.0.0.1:1/",
    token: "peer-token",
  },
]);

// A clone of the full-manifest template — this suite's own database (each `useTemplateDb` call clones
// afresh), so the deployment stamp + singleton_role flips it performs are isolated to this file.
const suite = useTemplateDb({ template: "manifest" });

// A SECOND clone, the live gossip PEER for Case C/D: a plain sync source that advertises a signed
// membership document on its /sync-api/hello. The booted primary's REAL pull worker drains this peer
// and hands the advertised document to the REAL adoptMembership callback (boot.ts) — the runtime path
// that must schedule the restart-into-fenced when the document supersedes-and-fences this node. It
// only SERVES (never stamped); its held node_membership is rewritten per test.
const peerSource = useTemplateDb({ template: "manifest" });

// The peer's origin id (served on /hello, the id the booted primary pulls with `?originId=`).
const PEER_SOURCE_NODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// A trusted SIGNER identity distinct from the till node: its public half is stamped on a `nodes` row in
// the booted primary's tenant (below), so `readMembershipTrustSet` trusts a document this key signs,
// exactly as it trusts the till's own key. The private half signs the advertised documents in-process.
const SIGNER_NODE_ID = "77777777-7777-4777-8777-777777777777";
const SIGNER_KP = generateNodeKeyPair();

/** A membership document (design §3/§5) signed by the trusted SIGNER key, naming THIS node with
 * `standing` at `term`. Advertised by the live peer on /hello; the booted primary re-runs the accept
 * fence against it (membership-adopt.ts) and persists it iff strictly newer. `term: 6` supersedes the
 * held term-5 self-doc the primary boots with. */
function peerDoc(
  term: number,
  standing: "sell-only" | "serving-primary",
): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term,
    nodes: [{ nodeId: TILL_ENV.WAITRON_TILL_NODE_ID, contactUrl: "", standing }],
  };
  return {
    body,
    signerNodeId: SIGNER_NODE_ID,
    signature: signDocumentBody(body, SIGNER_KP.privateKey),
    endorsements: [],
  };
}

// The box key ring `establishNodeIdentity` seals under, built from the SAME credentials key boot loads.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

let migrationsRoot: string;
let appDatabaseUrl: string;
let syncDatabaseUrl: string;

// The live gossip peer (Case C/D): a real HTTP server serving the peer clone's /sync-api, the Bearer
// every pull presents, and the reader pool the /hello + /log handlers read through.
let peerSourceReader: Database;
let peerToken: string;
let peerServer: ServerType;
let peerBaseUrl: string;

/** Seed the boot till's tenant + location + node (so boot's `readOrderFlow` / `readVenueLocale` reads
 * resolve) plus a node identity, mirroring boot.promote.test.ts's `seedTillIdentity`. */
async function seedTillIdentity(admin: Database): Promise<void> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'ES', '90111111H', 'Fence Till SL')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Barra',
            array['en']::text[], 'Hospitality')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into nodes (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_NODE_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Fence node')
    on conflict do nothing`);
  await establishNodeIdentity(
    { ownerDb: admin, ring: RING },
    TILL_ENV.WAITRON_TILL_TENANT_ID,
    TILL_ENV.WAITRON_TILL_NODE_ID,
  );
}

/** A held membership document (design §3/§5) naming THIS node with `standing`. The fence read is
 * UNVERIFIED (`readNodeMembership` returns the blob whole), so the placeholder signature is fine — we
 * write it directly through the plain-upsert setter, exactly as an owner/promote path would persist an
 * already-verified document. */
function selfDoc(standing: "sell-only" | "serving-primary"): SignedMembershipDocument {
  return {
    body: {
      term: 5,
      nodes: [{ nodeId: TILL_ENV.WAITRON_TILL_NODE_ID, contactUrl: "", standing }],
    },
    signerNodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
    signature: "self-placeholder-sig",
    endorsements: [],
  };
}

beforeAll(async () => {
  // The migrations root, built exactly as boot.promote.test.ts does: boot's from-source default does
  // not exist under source, so `WAITRON_MIGRATIONS_DIR` must point `applyMigrations` at the real
  // journal content per manifest set.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-fence-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  await seedTillIdentity(suite.admin);
  // Stamp production (matching WAITRON_ENV so the boot guard passes); singleton_role keeps its column
  // default 'primary' (migration 0071) — so this clone is a PRIMARY, the state a returned ex-primary is
  // in before its held fence is reconciled.
  await stampDeployment(suite.admin, "production");

  appDatabaseUrl = roleUrl(suite.pg.uri, "app_login", "app_pw");
  syncDatabaseUrl = roleUrl(suite.pg.uri, "sync_applier", "ap");

  // Stand up the live gossip peer for Case C/D. The /hello + /log handlers read through a
  // sync_applier pool (app_user's SELECT), exactly as boot builds the source reader; the peer enrols
  // the Bearer the booted primary presents from WAITRON_SYNC_PEERS. Stamp the primary's `nodes` row
  // with the trusted SIGNER public key so its `readMembershipTrustSet` accepts the advertised document
  // (the till + location the FK references were seeded above by `seedTillIdentity`).
  peerSourceReader = await peerSource.pg.connectAs("sync_applier", "ap");
  peerToken = (
    await enrolPeer(peerSource.admin, { subscriberId: "fence-gossip", name: "fence-gossip" })
  ).token;
  await suite.admin.execute(sql`
    insert into nodes (id, tenant_id, location_id, name, public_key)
    values (${SIGNER_NODE_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, ${TILL_ENV.WAITRON_TILL_LOCATION_ID},
            'Peer signer', ${SIGNER_KP.publicKey})
    on conflict do nothing`);
  const app = new Hono();
  mountSyncApi(
    app,
    {
      db: peerSourceReader,
      tenantId: TILL_ENV.WAITRON_TILL_TENANT_ID,
      nodeId: PEER_SOURCE_NODE,
      environment: "production",
    },
    () => {},
  );
  const peerPort = await new Promise<number>((resolve) => {
    peerServer = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) =>
      resolve(info.port),
    );
  });
  peerBaseUrl = `http://127.0.0.1:${peerPort}`;
}, 180_000);

afterAll(async () => {
  if (peerServer !== undefined)
    await new Promise<void>((resolve) => peerServer.close(() => resolve()));
  if (peerSourceReader !== undefined) await peerSourceReader.close();
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
});

/** The WAITRON_SYNC_PEERS JSON pointing the booted primary at the live gossip peer (Case C/D). */
function livePeers(): string {
  return JSON.stringify([{ nodeId: PEER_SOURCE_NODE, url: peerBaseUrl, token: peerToken }]);
}

/** An OS-assigned free port, released before use (boot.promote.test.ts's helper — WAITRON_HTTP_PORT
 * rejects "0", so the host cannot bind an ephemeral port itself). */
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

/** Boot a trading server against this clone with sync enabled (a dead peer), the shared env for both
 * cases. */
async function bootFenceServer(port: number, syncPeers: string = SYNC_PEERS) {
  return startServer({
    ...KEY_ENV,
    ...TICK_ENV,
    DATABASE_URL: appDatabaseUrl,
    // Superuser: boot's fenced demote opens a short-lived owner pool from this URL for the
    // `setSingletonRole` write (app_user holds no UPDATE on `deployment`), and boot re-runs the
    // (idempotent) migrations over it too.
    WAITRON_MIGRATIONS_DATABASE_URL: suite.pg.uri,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_SYNC_PEERS: syncPeers,
    WAITRON_SYNC_DATABASE_URL: syncDatabaseUrl,
  });
}

describe("boot fence (real Postgres): a held sell-only membership doc fences a returned primary", () => {
  it("Case A: a held sell-only self-doc demotes the singleton axis, gates writes, and unmounts the source", async () => {
    // A fresh primary starting point (a prior test may have demoted the shared clone).
    await setSingletonRole(suite.admin, "primary");
    // The held document marks THIS node sell-only — the fence.
    await writeNodeMembership(suite.admin, selfDoc("sell-only"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootFenceServer(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Reconciled: boot demoted the singleton axis DOWN to 'secondary' (mode stays 'primary' — the
      // (primary, secondary) pair is valid, deployment_role_valid_ck).
      const axes = await readDeploymentAxes(suite.admin);
      expect(axes).toEqual({ mode: "primary", singletonRole: "secondary" });

      // A write verb is refused by the read-only gate BEFORE the route (a cookieless POST 403s), the
      // error-boundary shape.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // The authoritative sync SOURCE is NOT mounted: mountSyncApi gates on isSingletonPrimary, now
      // false, so the singleton workers are suppressed by the reconciled axis. 404, not 401.
      const source = await fetch(`${base}/sync-api/log`);
      expect(source.status).toBe(404);
    } finally {
      await server.close();
    }
  }, 60_000);

  it("Case B: a held serving-primary self-doc does NOT fence — primary stays open and sources", async () => {
    // A fresh primary starting point, then a held document that keeps this node SERVING — not fenced.
    await setSingletonRole(suite.admin, "primary");
    await writeNodeMembership(suite.admin, selfDoc("serving-primary"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootFenceServer(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Unfenced: the singleton axis stays 'primary' (no demote fired).
      const axes = await readDeploymentAxes(suite.admin);
      expect(axes).toEqual({ mode: "primary", singletonRole: "primary" });

      // Writes are open — the read-only gate is not mounted, so a POST reaches its OWN auth screen
      // (management-session cookie missing → 401), NOT the gate's 403.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).not.toBe(403);

      // The singleton sync SOURCE IS mounted (isSingletonPrimary true): a tokenless request reaches the
      // peer-auth screen (401 sync.node_unauthorized), NOT a 404 — the route exists. This is the control
      // proving Case A's 404 is the fence's doing, not a missing route.
      const source = await fetch(`${base}/sync-api/log`);
      expect(source.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 60_000);
});

describe("boot fence gossip (real Postgres): a superseding document adopted at runtime restarts into the fenced posture", () => {
  it("Case C: an unfenced running primary adopts a superseding sell-only document → schedules a restart-into-fenced", async () => {
    // The primary boots UNFENCED: singleton axis 'primary' and a held self-doc that keeps it serving.
    await setSingletonRole(suite.admin, "primary");
    await writeNodeMembership(suite.admin, selfDoc("serving-primary"));
    // The live peer advertises a strictly-newer (term 6 > 5) document marking THIS node sell-only.
    await writeNodeMembership(peerSource.admin, peerDoc(6, "sell-only"));

    // SAFETY (CLAUDE.md §4): the fencing adopt schedules `setTimeout(() => process.kill(pid, "SIGTERM"), 0)`.
    // Spy on process.kill so the restart NEVER fires a real SIGTERM at the vitest worker; assert it was
    // scheduled. Installed BEFORE boot so the next-tick timer hits the spy, restored in `finally`.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const port = await freePort();
    const server = await bootFenceServer(port, livePeers());
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // The pull worker drained the peer, verified the trusted document, and PERSISTED it: this node's
      // held membership bumps to term 6 — read back through the admin connection (the row on disk, not
      // the callback's return), the honest proof the adoption actually happened.
      const held = await poll(async () => {
        const m = await readNodeMembership(suite.admin);
        return m !== null && m.body.term === 6 ? m : undefined;
      });
      expect(held).not.toBeNull();
      expect(held!.body.term).toBe(6);

      // ...and because the newly-adopted document fences a node that booted unfenced, the next-tick
      // restart-into-fenced was scheduled: process.kill fired into the spy, never a real SIGTERM.
      await poll(async () => (killSpy.mock.calls.length > 0 ? true : undefined));
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
    } finally {
      await server.close();
      killSpy.mockRestore();
    }
  }, 60_000);

  it("Case D (negative control): a superseding document that keeps this node serving-primary is adopted but schedules NO restart", async () => {
    // Same unfenced boot, but the advertised strictly-newer document keeps this node SERVING — the adopt
    // must persist (term bumps) WITHOUT scheduling a restart (shouldFenceRestart is false: not fenced).
    await setSingletonRole(suite.admin, "primary");
    await writeNodeMembership(suite.admin, selfDoc("serving-primary"));
    await writeNodeMembership(peerSource.admin, peerDoc(6, "serving-primary"));

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const port = await freePort();
    const server = await bootFenceServer(port, livePeers());
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // The adopt DID happen — the held document bumps to term 6 (the branch was reached and evaluated).
      const held = await poll(async () => {
        const m = await readNodeMembership(suite.admin);
        return m !== null && m.body.term === 6 ? m : undefined;
      });
      expect(held!.body.term).toBe(6);

      // Give any erroneously-scheduled next-tick restart timer ample time to fire, then prove it did not:
      // a serving-primary document does not fence, so no SIGTERM is ever requested.
      await delay(300);
      expect(killSpy).not.toHaveBeenCalledWith(process.pid, "SIGTERM");
    } finally {
      await server.close();
      killSpy.mockRestore();
    }
  }, 60_000);
});

/** Polls `predicate` up to ~10s for its first defined value — boot.promote.test.ts's shape. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}
