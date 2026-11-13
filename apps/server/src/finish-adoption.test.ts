import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loadKeyRing, sealNodeSigningKeyTx, writePairLinkTx } from "@waitron/credentials";
import { nodes, withNodeTransaction, type Database, type NodeDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant, seedVenue } from "@waitron/db/testing/seed.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readPairLink } from "@waitron/node-db";
import { MIRROR_VIEWER_PERSON_ID } from "./mirror-session.js";
import {
  PENDING_ADOPTION_FILE,
  readPendingAdoption,
  runFinishAdoption,
  writePendingAdoption,
  type PendingAdoption,
} from "./finish-adoption.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-adopt-"));
  dirs.push(dir);
  return dir;
}

const STANDBY_NODE_ID = "33333333-3333-4333-8333-333333333333";
const PENDING: PendingAdoption = {
  standby: { nodeId: STANDBY_NODE_ID, publicKey: "pub" },
  nodeName: "standby",
  filingModule: "fiscal-verifactu",
  taxModule: null,
  reserved: { modules: {}, series: [], endorsement: {} as never },
  originNodeId: "77777777-7777-4777-8777-777777777777",
};

const dummyDb = {} as Database;
const dummyNode = {} as NodeDatabase;
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

describe("writePendingAdoption / readPendingAdoption", () => {
  it("round-trips the pending record and writes it 0600", async () => {
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    expect(await readPendingAdoption(dir)).toEqual(PENDING);
    const mode = (await stat(join(dir, PENDING_ADOPTION_FILE))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null when no pending file exists", async () => {
    const dir = await tempDir();
    expect(await readPendingAdoption(dir)).toBeNull();
  });
});

describe("runFinishAdoption", () => {
  it("returns immediately when there is no pending file (nothing to finish)", async () => {
    const dir = await tempDir();
    let restarts = 0;
    const events: string[] = [];
    await runFinishAdoption({
      ownerDb: dummyDb,
      node: dummyNode,
      ring: RING,
      nodeId: STANDBY_NODE_ID,
      stateDir: dir,
      modules: [],
      restart: () => (restarts += 1),
      log: ((_l: string, event: string) => events.push(event)) as never,
    });
    expect(restarts).toBe(0);
    expect(events).toEqual([]);
  });
});

describe("readPendingAdoption — unreadable record", () => {
  it("rejects with the read error when the record's path is not a readable file", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, PENDING_ADOPTION_FILE));
    await expect(readPendingAdoption(dir)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

describe("runFinishAdoption — on a migrated venue", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  const own = generateNodeKeyPair();
  const main = generateNodeKeyPair();

  async function spareNode(): Promise<void> {
    await withNodeTransaction(suite.node, async (tx) => {
      await sealNodeSigningKeyTx(tx, RING, STANDBY_NODE_ID, own.privateKey);
      await writePairLinkTx(tx, RING, STANDBY_NODE_ID, {
        role: "serves",
        state: "awaiting_copy",
        peerNodeId: PENDING.originNodeId,
        peerPublicKey: main.publicKey,
        storeUrl: "https://main:7443",
        venueId: "venue-1",
        accessKeyId: "waitron0123456789abcdef",
        secretAccessKey: "ab".repeat(32),
      });
    });
  }

  async function copyHoldsRow(publicKey: string): Promise<void> {
    await seedVenue(suite.db, {
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    });
    await suite.db.insert(nodes).values({ id: STANDBY_NODE_ID, name: "standby", publicKey });
  }

  function finish(dir: string, logged: unknown[], restart: () => void) {
    return runFinishAdoption({
      ownerDb: suite.db,
      node: suite.node,
      ring: RING,
      nodeId: STANDBY_NODE_ID,
      stateDir: dir,
      modules: [],
      restart,
      log: ((level: string, event: string, fields: unknown) =>
        logged.push({ level, event, fields })) as never,
    });
  }

  it("keeps the latch and logs the refusal when venue.db holds no row for this box", async () => {
    await seedTenant(suite.db);
    await spareNode();
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    const logged: unknown[] = [];
    let restarts = 0;
    await finish(dir, logged, () => (restarts += 1));
    expect(logged).toEqual([
      {
        level: "error",
        event: "adoption.establish_failed",
        fields: { code: "mirror.venue_not_copied" },
      },
    ]);
    expect(await readPendingAdoption(dir)).toEqual(PENDING);
    expect((await suite.db.execute(sql`select 1 from nodes`)).rows).toEqual([]);
    expect((await suite.db.execute(sql`select 1 from persons`)).rows).toEqual([]);
    expect(restarts).toBe(0);
  });

  it("finishes joining when venue.db holds this box's row with its own key", async () => {
    await spareNode();
    await copyHoldsRow(own.publicKey);
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    const logged: unknown[] = [];
    let restarts = 0;
    await finish(dir, logged, () => (restarts += 1));
    expect(logged).toEqual([
      { level: "info", event: "adoption.established", fields: { nodeId: STANDBY_NODE_ID } },
    ]);
    expect(await readPendingAdoption(dir)).toBeNull();
    expect((await readPairLink(suite.node, STANDBY_NODE_ID))?.state).toBe("copied");
    expect(restarts).toBe(1);
    const rows = await suite.db.execute<{ id: string }>(sql`select id from nodes`);
    expect(rows.rows).toEqual([{ id: STANDBY_NODE_ID }]);
    const viewer = await suite.db.execute(
      sql`select 1 from persons where id = ${MIRROR_VIEWER_PERSON_ID}`,
    );
    expect(viewer.rows).toEqual([]);
  });

  it("keeps the latch when the row's key is not this box's", async () => {
    await spareNode();
    await copyHoldsRow(generateNodeKeyPair().publicKey);
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    const logged: unknown[] = [];
    let restarts = 0;
    await finish(dir, logged, () => (restarts += 1));
    expect(logged).toEqual([
      {
        level: "error",
        event: "adoption.establish_failed",
        fields: { code: "node.identity_mismatch" },
      },
    ]);
    expect(await readPendingAdoption(dir)).toEqual(PENDING);
    expect((await readPairLink(suite.node, STANDBY_NODE_ID))?.state).toBe("awaiting_copy");
    expect(restarts).toBe(0);
  });

  it("keeps the latch when removing it fails, and asks for no restart", async () => {
    await spareNode();
    await copyHoldsRow(own.publicKey);
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    const logged: unknown[] = [];
    let restarts = 0;
    // A folder that cannot be written keeps its files readable but refuses their removal.
    await chmod(dir, 0o500);
    try {
      await finish(dir, logged, () => (restarts += 1));
    } finally {
      await chmod(dir, 0o700);
    }
    expect(logged).toEqual([
      { level: "error", event: "adoption.establish_failed", fields: { code: "unknown" } },
    ]);
    expect(await readPendingAdoption(dir)).toEqual(PENDING);
    expect((await readPairLink(suite.node, STANDBY_NODE_ID))?.state).toBe("copied");
    expect(restarts).toBe(0);
  });
});
