import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent } from "undici";
import { loadKeyRing } from "@waitron/credentials";
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
import { ensureBoxSecrets } from "./box-secrets.js";
import { establishNodeIdentity } from "./node-identity.js";
import { REBUILD_MARKER } from "./rebuild-first-start.js";

// A box that returns after being fenced still names itself serving-primary; if it sold, two nodes
// would file under one NIF. Pinned at boot: a reachable peer holding a higher-term chart that fences
// this node leaves it read-only, while the same box with an unreachable peer boots primary — the
// control, so the read-only outcome is the reconciliation and not a box fenced anyway.
//
// The suite keeps its own handle open beside the server's and writes through it only before
// `startServer`, so the two never want the write lock at once.

const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};
const PEER_NODE = "66666666-6666-4666-8666-666666666666";
const PEER_KEY = generateNodeKeyPair();

const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-reconcile-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const KEY_ENV = {
  // Keeps the plain-HTTP landing listener off privileged port 80.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_ENV: "preproduction",
  ...TILL_ENV,
};

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

async function seed(db: Database): Promise<void> {
  // `onConflictDoNothing` is untargeted: nothing here reads the result.
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
  // The peer's public key is what puts it in the box's trust set.
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

/** Migrated here, not by boot, because the identity rows have to exist before boot reads them. */
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

  // Both keep the default mode 'primary': the returned box believes it is primary.
  [supersededVenueDir, supersededDb] = await migratedVenue();
  [proceedsVenueDir, proceedsDb] = await migratedVenue();
  for (const db of [supersededDb, proceedsDb]) {
    await seed(db);
    await stampDeployment(db, "preproduction");
  }
}, 180_000);

afterAll(async () => {
  while (openStores.length > 0) await openStores.pop()?.close();
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  for (const directory of [supersededVenueDir, proceedsVenueDir]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

/** `WAITRON_HTTP_PORT` refuses "0", so the OS picks a free port first. */
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

/** Stands in for the promoted cloud's membership endpoint, ignoring the credential header. */
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
    await seedHeldChart(supersededDb, 1);
    const peer = await startPeer(peerFencingChart(2));
    await writeMirrorConfig(supersededDb, TILL_ENV.WAITRON_TILL_NODE_ID, {
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
      const node = await fetch(`${base}/api/node`);
      expect(node.status).toBe(200);
      expect(await node.json()).toMatchObject({ acceptingSales: false });

      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // Persisted and demoted, not merely a per-request gate.
      const held = await readNodeMembership(supersededDb);
      expect(held?.body.term).toBe(2);
      expect(await readSingletonRole(supersededDb, TILL_ENV.WAITRON_TILL_NODE_ID)).toBe(
        "secondary",
      );
    } finally {
      await server.close();
      await peer.stop();
    }
  }, 60_000);

  // A box restored from an old archive while the cloud serves in its place: its first start after
  // the restore must not move the term before the peer's chart is read, or the fencing chart reads
  // as not newer and two nodes sell.
  it("a restored box that the peer fences adopts the fence and leaves its first start for later", async () => {
    const [venueDir, db] = await migratedVenue();
    await seed(db);
    await stampDeployment(db, "preproduction");
    // This node can sign, so a first start that ran would move the term.
    await establishNodeIdentity(
      { ownerDb: db, ring: loadKeyRing(KEY_ENV) },
      TILL_ENV.WAITRON_TILL_NODE_ID,
    );
    await seedHeldChart(db, 1);
    const peer = await startPeer(peerFencingChart(2));
    await writeMirrorConfig(db, TILL_ENV.WAITRON_TILL_NODE_ID, {
      relayUrl: peer.url,
      boxHostname: "box.local",
      boxCaPem: BOX_CA_PEM,
      originNodeId: PEER_NODE,
    });
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-reconcile-restored-"));
    writeFileSync(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
      listIpv4: () => [],
    });
    await writeFile(
      join(stateDir, REBUILD_MARKER),
      JSON.stringify({ version: 1, source: "archive" }),
    );
    const leafBefore = await readFile(join(stateDir, "tls", "server.crt"));
    const dispatcher = new Agent({
      connect: { ca: await readFile(join(stateDir, "tls", "ca.crt")) },
    });

    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      const node = await fetch(`https://127.0.0.1:${port}/api/node`, {
        dispatcher,
      } as RequestInit);
      expect(node.status).toBe(200);
      expect(await node.json()).toMatchObject({ acceptingSales: false });
      expect((await readNodeMembership(db))?.body.term).toBe(2);
      expect(existsSync(join(stateDir, REBUILD_MARKER))).toBe(true);
      expect(await readFile(join(stateDir, "tls", "server.crt"))).toEqual(leafBefore);
    } finally {
      await server.close();
      await peer.stop();
      await dispatcher.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("an UNREACHABLE peer leaves the returned box PRIMARY — it proceeds and accepts sales (prove-by-deletion)", async () => {
    await seedHeldChart(proceedsDb, 1);
    const deadPort = await freePort();
    await writeMirrorConfig(proceedsDb, TILL_ENV.WAITRON_TILL_NODE_ID, {
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
      const node = await fetch(`${base}/api/node`);
      expect(node.status).toBe(200);
      expect(await node.json()).toMatchObject({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        acceptingSales: true,
      });

      const held = await readNodeMembership(proceedsDb);
      expect(held?.body.term).toBe(1);
      expect(await readSingletonRole(proceedsDb, TILL_ENV.WAITRON_TILL_NODE_ID)).toBe("primary");
    } finally {
      await server.close();
    }
  }, 60_000);
});
