import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  readNodeMembership,
  readSingletonRole,
  stampDeployment,
  tenants,
  tills,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { generateNodeKeyPair } from "@waitron/membership";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

// Ruling C7 — the returned-box membership reconciliation, proven end to end at boot (CLAUDE.md §1/§5).
// Deleting the pull worker deleted membership gossip; a box that died BEFORE it was fenced comes back
// naming ITSELF serving-primary and would sell while the promoted cloud is also primary — two nodes
// filing under one NIF, unrecoverable. This suite boots a real primary that holds exactly that stale
// chart AND a `mirror_config` pointing at a peer, and asserts the sale path is CLOSED:
//
//   FAILING CASE (the whole point): the peer is reachable and holds a HIGHER-term chart fencing this
//   node → after boot the node is read-only — `GET /api/node` reports `acceptingSales:false` (the exact
//   signal a till follows, till-reroute §3.1), a write is refused `node.read_only`, and the singleton
//   axis was demoted. WITHOUT the reconciliation the node would boot primary and sell.
//
//   CONTROL (prove-by-deletion, the other direction): the SAME seeded box with an UNREACHABLE peer boots
//   PRIMARY — `acceptingSales:true`, its held chart untouched — the "unreachable → proceed" rule. The two
//   boots differ only in whether the peer answers, so the read-only outcome above is the reconciliation
//   working, not a box that was fenced anyway.
//
// ## What the move off PostgreSQL took out of this file
//
// **The ROLE SPLIT is gone and is replaced by nothing.** The header used to say the container was
// mandatory because the fence persists `node_membership` and demotes `singleton_role` as the
// non-superuser app and owner roles, so a missing grant would be caught here. There are no roles on
// this engine: `pg.connectAs` has no counterpart and `asAppUser` is an inert function
// (`packages/db/src/testing/roles.ts`). Every statement below, and every statement the booted
// server issues, runs on the one connection `openVenueStore` hands out. Nothing here now shows that
// the fence's two writes are reachable by the role that has to make them.
//
// **The suite keeps its own handle open while the server holds one, and only READS through it.**
// Write-ahead mode admits a reader beside the writer, and both opens set `busy_timeout`
// (`packages/store/src/index.ts:128-136`); the seeding writes all happen before `startServer` and
// the read-backs after it, so the two handles never want the write lock at the same moment.

// The box's own fiscal identity — the four WAITRON_TILL_*_ID that put boot into TRADING + PRIMARY mode.
const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};
// The promoted cloud peer — a DISTINCT node whose key signs the superseding chart, seeded into this box's
// `nodes` so the box's trust set (readMembershipTrustSet) admits it.
const PEER_NODE = "66666666-6666-4666-8666-666666666666";
const PEER_KEY = generateNodeKeyPair();

const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-reconcile-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const KEY_ENV = {
  // Task 3: keep the plain-HTTP landing listener (default port 80) OUT of every boot test — 80 is
  // privileged, and a root CI container would otherwise stand up a live service on it. Its own
  // behaviour is proven directly in landing-listener.test.ts.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_ENV: "preproduction",
  ...TILL_ENV,
};

// A real box CA PEM for `mirror_config.box_ca_pem` — never used for a handshake here, but a genuine PEM
// keeps the wiring faithful.
const BOX_CA_PEM = mintSelfSignedServerCert({
  hostnames: ["box.local"],
  ipAddresses: [],
  now: new Date(),
}).caCertPem;

let migrationsRoot: string;
let supersededVenueDir: string;
let proceedsVenueDir: string;
let supersededDb: Database;
let proceedsDb: Database;
const openStores: VenueDatabase[] = [];

/** Seed the box's own fiscal identity (tenant/location/node/till/series) PLUS the peer node row carrying
 * the peer's public key (the trust anchor the fetched chart's signature verifies against). */
async function seed(db: Database): Promise<void> {
  // Every row goes in through its TABLE DEFINITION, the same change `packages/db/src/testing/seed.ts`
  // and `testing/fiscal-fixtures.ts` took. Two reasons: a raw insert reaches no `$defaultFn`
  // generator, and `created_at` on `tenants`, `nodes` and `tills` is one of those on this engine; and
  // `array['en']::text[]` is PostgreSQL array syntax with a PostgreSQL cast operator, both refused at
  // prepare here. `on conflict do nothing` stays UNTARGETED, as the statements it replaces were —
  // narrowing it would be a behaviour change this conversion is not making.
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90333333J", legalName: "Reconcile SL" })
    .onConflictDoNothing();
  await db
    .insert(locations)
    .values({
      id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Loc",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  await db
    .insert(nodes)
    .values({
      id: TILL_ENV.WAITRON_TILL_NODE_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Box",
    })
    .onConflictDoNothing();
  // The peer node, with its identity public key — this is what puts the peer's key in the box's trust set.
  await db
    .insert(nodes)
    .values({
      id: PEER_NODE,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Cloud",
      publicKey: PEER_KEY.publicKey,
    })
    .onConflictDoNothing();
  await db
    .insert(tills)
    .values({
      id: TILL_ENV.WAITRON_TILL_TILL_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Till",
    })
    .onConflictDoNothing();
  await db
    .insert(invoiceSeries)
    .values({
      id: TILL_ENV.WAITRON_TILL_SERIES_ID,
      nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
      code: "A",
    })
    .onConflictDoNothing();
}

/** The box's OWN stale chart: it still names ITSELF serving-primary at `term`. */
async function seedHeldChart(db: Database, term: number): Promise<void> {
  await writeNodeMembership(
    db,
    signedMembershipDoc(term, {
      signerNodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
      nodes: [
        {
          nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
          contactUrl: "https://box",
          standing: "serving-primary",
        },
      ],
    }),
  );
}

/** The peer's CURRENT chart: a higher term, the peer serving-primary, THIS box demoted to sell-only —
 * signed by the peer's key so the box's trust set verifies it. */
function peerFencingChart(term: number) {
  return signedMembershipDoc(term, {
    signerNodeId: PEER_NODE,
    keyPair: PEER_KEY,
    nodes: [
      { nodeId: PEER_NODE, contactUrl: "https://cloud", standing: "serving-primary" },
      { nodeId: TILL_ENV.WAITRON_TILL_NODE_ID, contactUrl: "https://box", standing: "sell-only" },
    ],
  });
}

/**
 * A fresh venue directory migrated through the manifest, plus a handle on it the suite keeps.
 *
 * The migration run is this suite's, not boot's, because the identity rows have to exist before
 * boot reads them; boot's own `applyMigrations` over the same directory then finds nothing to do.
 */
async function migratedVenue(): Promise<[string, Database]> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-reconcile-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  openStores.push(store);
  return [directory, store.venue];
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-reconcile-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  // Both directories keep the default mode 'primary' — this is the returned box that believes it is
  // primary.
  [supersededVenueDir, supersededDb] = await migratedVenue();
  [proceedsVenueDir, proceedsDb] = await migratedVenue();
  for (const db of [supersededDb, proceedsDb]) {
    await seed(db);
    await stampDeployment(db, "preproduction");
  }
}, 180_000);

afterAll(async () => {
  // `pop()` returns `VenueDatabase | undefined`, so the `?.` is a real guard rather than a decorative
  // one, and the array is left empty. Guard: `scripts/guarded-teardowns.test.ts`, which reads a
  // teardown hook as TEXT.
  while (openStores.length > 0) await openStores.pop()?.close();
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  for (const directory of [supersededVenueDir, proceedsVenueDir]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

/** An OS-assigned free port, released before use (boot.mirror.test.ts's helper). */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** A stub peer serving `GET /management-api/membership` → `{ document }` (the promoted cloud, a separate
 * closed service in production). It ignores the credential header — the box authenticates in production;
 * here the stub stands in for that closed endpoint. Returns its base relay URL. */
async function startPeer(document: unknown): Promise<{ url: string; stop: () => Promise<void> }> {
  const server: Server = createHttpServer((req, res) => {
    if (req.url === "/management-api/membership") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ document }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("returned-box membership reconciliation at boot", () => {
  it("a reachable peer holding a higher-term fencing chart sends the returned box read-only — it cannot sell", async () => {
    // The box's stale chart (term 1, itself serving-primary) and a mirror_config pointing at the peer,
    // which holds the superseding chart (term 2, this box sell-only).
    await seedHeldChart(supersededDb, 1);
    const peer = await startPeer(peerFencingChart(2));
    await writeMirrorConfig(supersededDb, {
      relayUrl: peer.url,
      boxHostname: "box.local",
      boxCaPem: BOX_CA_PEM,
      originNodeId: PEER_NODE,
    });

    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: supersededVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      // §5: the till's own routing probe reports the box is NOT accepting sales — the superseded box
      // steers every till away from itself rather than selling under a chain the cloud now owns.
      const node = await fetch(`${base}/api/node`);
      expect(node.status).toBe(200);
      expect(await node.json()).toMatchObject({ acceptingSales: false });

      // The read-only gate is engaged: a write is refused before any route (node.read_only 403), the
      // same posture a mirror runs. This is the concrete "a superseded node must not sell".
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // The reconciliation PERSISTED the peer's superseding chart (term 2), and the boot demoted the
      // singleton axis off it — the durable evidence the fence engaged, not merely a per-request gate.
      const held = await readNodeMembership(supersededDb);
      expect(held?.body.term).toBe(2);
      expect(await readSingletonRole(supersededDb)).toBe("secondary");
    } finally {
      await server.close();
      await peer.stop();
    }
  }, 60_000);

  it("an UNREACHABLE peer leaves the returned box PRIMARY — it proceeds and accepts sales (prove-by-deletion)", async () => {
    // The SAME seeded box, but its mirror_config points at a dead port: the best-effort fetch reads it as
    // unreachable and boot proceeds as primary (Ruling C7's accepted window). Without the peer answering,
    // the box keeps its own chart and sells — which is exactly what the reachable case above must prevent.
    await seedHeldChart(proceedsDb, 1);
    const deadPort = await freePort();
    await writeMirrorConfig(proceedsDb, {
      relayUrl: `http://127.0.0.1:${deadPort}/`,
      boxHostname: "box.local",
      boxCaPem: BOX_CA_PEM,
      originNodeId: PEER_NODE,
    });

    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: proceedsVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      // Primary and selling: the till's probe says this node accepts sales.
      const node = await fetch(`${base}/api/node`);
      expect(node.status).toBe(200);
      expect(await node.json()).toMatchObject({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        acceptingSales: true,
      });

      // Its held chart is untouched (still term 1, itself serving-primary) and it stays singleton primary
      // — nothing was persisted, nothing demoted.
      const held = await readNodeMembership(proceedsDb);
      expect(held?.body.term).toBe(1);
      expect(await readSingletonRole(proceedsDb)).toBe("primary");
    } finally {
      await server.close();
    }
  }, 60_000);
});
