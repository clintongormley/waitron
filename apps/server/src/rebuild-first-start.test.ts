import { X509Certificate, createPrivateKey } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteCredential, loadKeyRing, putCredential, type KeyRing } from "@waitron/credentials";
import {
  locations,
  nodes,
  readMembershipTrustSet,
  readNodeMembership,
  tenants,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import {
  generateNodeKeyPair,
  verifyMembershipDocument,
  type MembershipNode,
} from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  generationName,
  pointerKey,
  signPointer,
  writePointer,
  type ObjectStore,
} from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { establishNodeIdentity } from "./node-identity.js";
import { STREAM_PURPOSE, streamSettingsPayload, type StreamSettings } from "./stream-host.js";
import {
  REBUILD_MARKER,
  completeRebuild,
  deferFirstStart,
  readBucketPointerTerm,
  runFirstStart,
  type RebuildDeps,
  type RebuildSource,
} from "./rebuild-first-start.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
/** A key ring that cannot open this node's membership key, so signing the next term fails. */
const OTHER_RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});
const NODE = "c0000000-0000-4000-8000-000000000008";
const OTHER_NODE = "c0000000-0000-4000-8000-000000000009";
const LOCATION = "c0000000-0000-4000-8000-000000000002";
const OLD_ADDRESS = "192.168.1.10";
const NEW_ADDRESS = "192.168.1.77";
const NOW = new Date("2026-09-23T10:00:00Z");

beforeAll(async () => {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Waitron SL" });
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Local",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await suite.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Node 1" });
  await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, NODE);
});

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A state folder as a restore leaves it: the dead box's certificate files, naming its old
 * address, the marker the restore wrote (none for an ordinary start), and the dead box's term-0
 * membership document. */
async function rebuiltStateDir(marker: RebuildSource | false): Promise<string> {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-rebuild-"));
  dirs.push(stateDir);
  await ensureBoxSecrets({
    stateDir,
    hostnames: ["waitron.local", "localhost"],
    now: () => NOW,
    listIpv4: () => [OLD_ADDRESS],
  });
  if (marker !== false) {
    await writeFile(join(stateDir, REBUILD_MARKER), JSON.stringify({ version: 1, source: marker }));
  }
  await seedTermZeroMembership({ db: suite.db, ring: RING }, NODE, "https://old-box.example");
  return stateDir;
}

function deps(stateDir: string, overrides: Partial<RebuildDeps> = {}): RebuildDeps {
  return {
    stateDir,
    db: suite.db,
    ring: RING,
    nodeId: NODE,
    contactUrl: "https://waitron.local",
    hostnames: ["waitron.local", "localhost"],
    listIpv4: () => [NEW_ADDRESS],
    now: () => NOW,
    log: () => {},
    ...overrides,
  };
}

async function leafOf(stateDir: string): Promise<X509Certificate> {
  return new X509Certificate(await readFile(join(stateDir, "tls", "server.crt"), "utf8"));
}

describe("completeRebuild", () => {
  it.each(["archive", "stream"] as const)(
    "after a %s restore, presents a certificate naming THIS machine's addresses, from the same authority",
    async (source) => {
      const stateDir = await rebuiltStateDir(source);
      const caBefore = await readFile(join(stateDir, "tls", "ca.crt"), "utf8");
      expect(await completeRebuild(deps(stateDir))).toBe(true);
      // The two files `mintedBoxLeaf` (box-secrets.ts) hands the trading listener.
      const leaf = await leafOf(stateDir);
      expect(leaf.subjectAltName).toContain(`IP Address:${NEW_ADDRESS}`);
      expect(leaf.subjectAltName).not.toContain(OLD_ADDRESS);
      const ca = await readFile(join(stateDir, "tls", "ca.crt"), "utf8");
      expect(ca).toBe(caBefore);
      expect(leaf.verify(new X509Certificate(ca).publicKey)).toBe(true);
      const key = await readFile(join(stateDir, "tls", "server.key"), "utf8");
      expect(leaf.checkPrivateKey(createPrivateKey(key))).toBe(true);
      expect((await stat(join(stateDir, "tls", "server.key"))).mode & 0o777).toBe(0o600);
    },
  );

  it.each(["archive", "stream"] as const)(
    "after a %s restore, signs the membership document one term higher, carrying this machine's contact address",
    async (source) => {
      const stateDir = await rebuiltStateDir(source);
      await completeRebuild(deps(stateDir));
      const held = await readNodeMembership(suite.db);
      expect(held!.body.term).toBe(1);
      expect(held!.body.nodes).toEqual([
        { nodeId: NODE, contactUrl: "https://waitron.local", standing: "serving-primary" },
      ]);
      expect(verifyMembershipDocument(held!, await readMembershipTrustSet(suite.db))).toMatchObject(
        { valid: true },
      );
      await expect(stat(join(stateDir, REBUILD_MARKER))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("removes the marker last: a step that fails leaves it, so the next start runs the routine again", async () => {
    const stateDir = await rebuiltStateDir("stream");
    await expect(completeRebuild(deps(stateDir, { ring: OTHER_RING }))).rejects.toMatchObject({
      code: "credentials.decrypt_failed",
    });
    await stat(join(stateDir, REBUILD_MARKER));
    expect((await readNodeMembership(suite.db))!.body.term).toBe(0);
    // The other direction: the same folder with the right ring completes and removes it.
    expect(await completeRebuild(deps(stateDir))).toBe(true);
    await expect(stat(join(stateDir, REBUILD_MARKER))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does nothing on an ordinary start — the leaf stays byte-for-byte and the term does not move", async () => {
    const stateDir = await rebuiltStateDir(false);
    const leafBefore = await readFile(join(stateDir, "tls", "server.crt"));
    expect(await completeRebuild(deps(stateDir))).toBe(false);
    expect(await readFile(join(stateDir, "tls", "server.crt"))).toEqual(leafBefore);
    expect((await readNodeMembership(suite.db))!.body.term).toBe(0);
  });

  it.each(["{ torn", "{}"])(
    "runs on a marker whose body names no source (%s), because only a restore writes one",
    async (markerBody) => {
      const stateDir = await rebuiltStateDir(false);
      await writeFile(join(stateDir, REBUILD_MARKER), markerBody);
      const logged: Array<[string, Record<string, unknown> | undefined]> = [];
      expect(
        await completeRebuild(
          deps(stateDir, { log: (_level, event, fields) => logged.push([event, fields]) }),
        ),
      ).toBe(true);
      expect((await readNodeMembership(suite.db))!.body.term).toBe(1);
      expect(logged).toContainEqual(["restore.first_start_done", { term: 1, source: "unknown" }]);
    },
  );

  it("names the source the marker recorded in its log line", async () => {
    const stateDir = await rebuiltStateDir("stream");
    const logged: Array<[string, Record<string, unknown> | undefined]> = [];
    await completeRebuild(
      deps(stateDir, { log: (_level, event, fields) => logged.push([event, fields]) }),
    );
    expect(logged).toContainEqual(["restore.first_start_done", { term: 1, source: "stream" }]);
  });

  it("fails on a marker it cannot read at all, leaving it for the next start", async () => {
    const stateDir = await rebuiltStateDir(false);
    // A directory where the marker file goes: reading it fails with something other than ENOENT.
    await mkdir(join(stateDir, REBUILD_MARKER));
    await expect(completeRebuild(deps(stateDir))).rejects.toMatchObject({ code: "EISDIR" });
    expect((await readNodeMembership(suite.db))!.body.term).toBe(0);
  });

  // What a crash between the two renames in `reissueBoxLeaf` leaves: a certificate whose key does
  // not match it. The marker is still there, so the next start replaces both.
  it("repairs a mismatched pair left by an interrupted re-issue", async () => {
    const stateDir = await rebuiltStateDir("archive");
    const other = await mkdtemp(join(tmpdir(), "waitron-rebuild-other-"));
    dirs.push(other);
    await ensureBoxSecrets({ stateDir: other, hostnames: ["waitron.local"], now: () => NOW });
    await writeFile(
      join(stateDir, "tls", "server.key"),
      await readFile(join(other, "tls", "server.key")),
    );
    const key = () => readFile(join(stateDir, "tls", "server.key"), "utf8");
    expect((await leafOf(stateDir)).checkPrivateKey(createPrivateKey(await key()))).toBe(false);
    await completeRebuild(deps(stateDir));
    expect((await leafOf(stateDir)).checkPrivateKey(createPrivateKey(await key()))).toBe(true);
  });

  it("drops an address the authority cannot vouch for, as first minting does", async () => {
    const stateDir = await rebuiltStateDir("archive");
    await completeRebuild(deps(stateDir, { listIpv4: () => [NEW_ADDRESS, "100.64.0.9"] }));
    const leaf = await leafOf(stateDir);
    expect(leaf.subjectAltName).not.toContain("100.64.0.9");
    expect(leaf.subjectAltName).toContain(NEW_ADDRESS);
    expect(leaf.subjectAltName).toContain("IP Address:127.0.0.1");
  });

  it("changes only this node's contact address, leaving every other node as it was", async () => {
    const stateDir = await rebuiltStateDir("archive");
    const other: MembershipNode = {
      nodeId: OTHER_NODE,
      contactUrl: "https://other.example",
      standing: "sell-only",
    };
    const held = await readNodeMembership(suite.db);
    await writeNodeMembership(
      suite.db,
      await mintNextMembershipDocument(
        { db: suite.db, ring: RING },
        {
          heldDocument: null,
          nodes: [...held!.body.nodes, other],
          signerNodeId: NODE,
        },
      ),
    );
    await completeRebuild(deps(stateDir));
    expect((await readNodeMembership(suite.db))!.body.nodes).toEqual([
      { nodeId: NODE, contactUrl: "https://waitron.local", standing: "serving-primary" },
      other,
    ]);
  });

  // Whether a restored box absent from its own document should add itself, and at which standing,
  // is not settled by the plan or the spec; this pins today's answer so a change is deliberate.
  it("leaves the node list as it is when this node is absent from the restored document", async () => {
    const stateDir = await rebuiltStateDir("archive");
    const other: MembershipNode = {
      nodeId: OTHER_NODE,
      contactUrl: "https://other.example",
      standing: "serving-primary",
    };
    await writeNodeMembership(
      suite.db,
      await mintNextMembershipDocument(
        { db: suite.db, ring: RING },
        { heldDocument: null, nodes: [other], signerNodeId: NODE },
      ),
    );
    await completeRebuild(deps(stateDir));
    expect((await readNodeMembership(suite.db))!.body.nodes).toEqual([other]);
  });

  it("signs term 0 naming this node alone when the restored database holds no document", async () => {
    const stateDir = await rebuiltStateDir("archive");
    await suite.db.execute(sql`delete from node_membership`);
    await completeRebuild(deps(stateDir));
    const held = await readNodeMembership(suite.db);
    expect(held!.body.term).toBe(0);
    expect(held!.body.nodes).toEqual([
      { nodeId: NODE, contactUrl: "https://waitron.local", standing: "serving-primary" },
    ]);
  });
});

describe("the term after a restore (plan Reconciliation N23)", () => {
  it("signs one term above the bucket's pointer when the restored copy is older than it", async () => {
    const stateDir = await rebuiltStateDir("archive");
    await completeRebuild(deps(stateDir, { pointerTerm: async () => 2 }));
    expect((await readNodeMembership(suite.db))!.body.term).toBe(3);
  });

  it("moves one term up from the restored document when no bucket is set up or it holds no pointer", async () => {
    const stateDir = await rebuiltStateDir("stream");
    await completeRebuild(deps(stateDir, { pointerTerm: async () => null }));
    expect((await readNodeMembership(suite.db))!.body.term).toBe(1);
  });

  // Signing restored + 1 below a pointer the box could not read would leave the supervisor refusing
  // the copy for good (`pointer_newer_term`), with nothing to raise the term again.
  it("fails when a bucket is set up but its pointer cannot be read: the term stays and the marker stays", async () => {
    const stateDir = await rebuiltStateDir("archive");
    const unreadable = new AppError("restore.pointer_unreadable", {});
    await expect(
      completeRebuild(deps(stateDir, { pointerTerm: async () => Promise.reject(unreadable) })),
    ).rejects.toBe(unreadable);
    expect((await readNodeMembership(suite.db))!.body.term).toBe(0);
    await stat(join(stateDir, REBUILD_MARKER));
  });

  it("asks the bucket before re-issuing the certificate, so the wait overlaps the key generation", async () => {
    const stateDir = await rebuiltStateDir("archive");
    const leafBefore = await readFile(join(stateDir, "tls", "server.crt"), "utf8");
    let leafWhenAsked: string | undefined;
    await completeRebuild(
      deps(stateDir, {
        pointerTerm: async () => {
          leafWhenAsked = await readFile(join(stateDir, "tls", "server.crt"), "utf8");
          return null;
        },
      }),
    );
    expect(leafWhenAsked).toBe(leafBefore);
    expect(await readFile(join(stateDir, "tls", "server.crt"), "utf8")).not.toBe(leafBefore);
  });

  // The read starts before the re-issue, so a re-issue that throws leaves a read nobody awaits.
  // Vitest fails the run on an unhandled rejection.
  it("reports the re-issue's failure, and no unhandled rejection, when the pointer read fails too", async () => {
    const stateDir = await rebuiltStateDir("archive");
    await rm(join(stateDir, "tls", "ca.key"));
    await expect(
      completeRebuild(
        deps(stateDir, {
          pointerTerm: () => Promise.reject(new AppError("restore.pointer_unreadable", {})),
        }),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    // Gives an unobserved rejection the turn it needs to be reported.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("does not ask the bucket on an ordinary start", async () => {
    const stateDir = await rebuiltStateDir(false);
    const pointerTerm = vi.fn(async () => 5);
    await completeRebuild(deps(stateDir, { pointerTerm }));
    expect(pointerTerm).not.toHaveBeenCalled();
    expect((await readNodeMembership(suite.db))!.body.term).toBe(0);
  });
});

describe("readBucketPointerTerm", () => {
  const SETTINGS: StreamSettings = {
    venueId: LOCATION,
    bucket: {
      region: "eu-west-1",
      bucket: "venue-copy",
      prefix: "",
      accessKeyId: "AKIA",
      secretAccessKey: "secret-0123456789",
    },
  };
  const storeSettings = (settings: StreamSettings) =>
    withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, { purpose: STREAM_PURPOSE, value: streamSettingsPayload(settings) }),
    );
  afterEach(async () => {
    await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: STREAM_PURPOSE }));
  });

  it("answers null when the box has no bucket settings, without opening a bucket", async () => {
    const openStore = vi.fn();
    expect(await readBucketPointerTerm(suite.db, RING, { openStore })).toBeNull();
    expect(openStore).not.toHaveBeenCalled();
  });

  it("answers the pointer's term, and null when the bucket holds no pointer", async () => {
    await storeSettings(SETTINGS);
    const store = createMemoryObjectStore();
    expect(await readBucketPointerTerm(suite.db, RING, { openStore: () => store })).toBeNull();
    const signer = generateNodeKeyPair();
    await writePointer(
      store,
      LOCATION,
      signPointer(
        {
          venueId: LOCATION,
          term: 2,
          nodeId: NODE,
          generation: generationName(2, NODE, NOW),
          writtenAt: NOW.toISOString(),
        },
        signer.privateKey,
      ),
      null,
    );
    expect(await readBucketPointerTerm(suite.db, RING, { openStore: () => store })).toBe(2);
  });

  it("refuses, rather than answering null, when the bucket does not answer in time", async () => {
    await storeSettings(SETTINGS);
    const store = createMemoryObjectStore();
    const silent: ObjectStore = {
      get: () => new Promise<never>(() => {}),
      put: (key, body, condition) => store.put(key, body, condition),
      list: (prefix) => store.list(prefix),
      delete: (key) => store.delete(key),
      deleteMany: (keys) => store.deleteMany(keys),
    };
    await expect(
      readBucketPointerTerm(suite.db, RING, { openStore: () => silent, timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "restore.pointer_unreadable" });
  });

  it("refuses when the pointer in the bucket cannot be read", async () => {
    await storeSettings(SETTINGS);
    const store = createMemoryObjectStore();
    await store.put(pointerKey(LOCATION), new TextEncoder().encode("not json"), undefined);
    await expect(
      readBucketPointerTerm(suite.db, RING, { openStore: () => store }),
    ).rejects.toMatchObject({ code: "backup.stream_pointer_invalid" });
  });

  it("refuses when the stored settings cannot be read, without opening a bucket", async () => {
    await storeSettings(SETTINGS);
    const openStore = vi.fn();
    await expect(readBucketPointerTerm(suite.db, OTHER_RING, { openStore })).rejects.toMatchObject({
      code: "credentials.decrypt_failed",
    });
    expect(openStore).not.toHaveBeenCalled();
  });

  it("refuses when the bucket cannot be opened", async () => {
    await storeSettings(SETTINGS);
    const openStore = () => {
      throw new Error("no client");
    };
    await expect(readBucketPointerTerm(suite.db, RING, { openStore })).rejects.toMatchObject({
      code: "restore.pointer_unreadable",
    });
  });

  it("opens the stored bucket itself when no store is given", async () => {
    // Nothing listens on port 1, so the real client's request fails with the client's own code.
    await storeSettings({
      ...SETTINGS,
      bucket: { ...SETTINGS.bucket, endpoint: "http://127.0.0.1:1" },
    });
    await expect(readBucketPointerTerm(suite.db, RING, { timeoutMs: 5_000 })).rejects.toMatchObject(
      { code: "backup.stream_request_failed" },
    );
  });
});

describe("runFirstStart (plan Reconciliation N24)", () => {
  it("opens for sales without streaming, logs restore.first_start_failed, and keeps the marker for the next start", async () => {
    const stateDir = await rebuiltStateDir("stream");
    const log = vi.fn();
    await expect(runFirstStart(deps(stateDir, { ring: OTHER_RING, log }))).resolves.toEqual({
      mayStream: false,
      failedSince: NOW.toISOString(),
    });
    expect(log).toHaveBeenCalledWith("error", "restore.first_start_failed", {
      errorCode: "credentials.decrypt_failed",
    });
    await stat(join(stateDir, REBUILD_MARKER));
    await expect(runFirstStart(deps(stateDir))).resolves.toEqual({
      mayStream: true,
      failedSince: null,
    });
    await expect(stat(join(stateDir, REBUILD_MARKER))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails, keeps the marker and does not stream, when a bucket is set up but does not answer", async () => {
    const stateDir = await rebuiltStateDir("archive");
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, {
        purpose: STREAM_PURPOSE,
        value: streamSettingsPayload({
          venueId: LOCATION,
          bucket: {
            region: "eu-west-1",
            bucket: "venue-copy",
            prefix: "",
            accessKeyId: "AKIA",
            secretAccessKey: "secret-0123456789",
          },
        }),
      }),
    );
    try {
      const silent = { get: () => new Promise<never>(() => {}) } as unknown as ObjectStore;
      const log = vi.fn();
      await expect(
        runFirstStart(
          deps(stateDir, {
            log,
            pointerTerm: () =>
              readBucketPointerTerm(suite.db, RING, { openStore: () => silent, timeoutMs: 50 }),
          }),
        ),
      ).resolves.toEqual({ mayStream: false, failedSince: NOW.toISOString() });
      expect(log).toHaveBeenCalledWith("error", "restore.first_start_failed", {
        errorCode: "restore.pointer_unreadable",
      });
      await stat(join(stateDir, REBUILD_MARKER));
      expect((await readNodeMembership(suite.db))!.body.term).toBe(0);
    } finally {
      await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: STREAM_PURPOSE }));
    }
  });

  it("streams on an ordinary start", async () => {
    const stateDir = await rebuiltStateDir(false);
    await expect(runFirstStart(deps(stateDir))).resolves.toEqual({
      mayStream: true,
      failedSince: null,
    });
  });
});

describe("deferFirstStart", () => {
  it("leaves the marker, the certificate and the term alone, and holds the stream", async () => {
    const stateDir = await rebuiltStateDir("archive");
    const leafBefore = await readFile(join(stateDir, "tls", "server.crt"));
    const log = vi.fn();
    await expect(deferFirstStart(stateDir, log)).resolves.toEqual({
      mayStream: false,
      failedSince: null,
    });
    expect(log).toHaveBeenCalledWith("warn", "restore.first_start_deferred", {});
    await stat(join(stateDir, REBUILD_MARKER));
    expect(await readFile(join(stateDir, "tls", "server.crt"))).toEqual(leafBefore);
    expect((await readNodeMembership(suite.db))!.body.term).toBe(0);
  });

  it("changes nothing on an ordinary start", async () => {
    const stateDir = await rebuiltStateDir(false);
    const log = vi.fn();
    await expect(deferFirstStart(stateDir, log)).resolves.toEqual({
      mayStream: true,
      failedSince: null,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("holds the stream when it cannot tell whether the marker is there", async () => {
    // The state folder is a file, so looking inside it fails with ENOTDIR rather than ENOENT.
    const dir = await mkdtemp(join(tmpdir(), "waitron-rebuild-"));
    dirs.push(dir);
    const notADirectory = join(dir, "state");
    await writeFile(notADirectory, "");
    await expect(deferFirstStart(notADirectory, () => {})).resolves.toEqual({
      mayStream: false,
      failedSince: null,
    });
  });
});
