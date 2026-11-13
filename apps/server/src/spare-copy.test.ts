import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadKeyRing,
  sealNodeSigningKeyTx,
  writePairLinkTx,
  type KeyRing,
} from "@waitron/credentials";
import { CORE_MIGRATIONS, nodes, withNodeTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { NODE_MIGRATIONS, pinPrimaryKeyTx, readPairLink, type PairLink } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import {
  generationName,
  pointerKey,
  signPointer,
  writePointer,
  type BucketConfig,
  type RestoreGenerationArgs,
} from "@waitron/stream";
import {
  createMemoryObjectStore,
  type MemoryObjectStore,
} from "@waitron/stream/testing/memory-store.js";
import { loadBoxEnv } from "./box-env.js";
import { loadRecoveryKey } from "./backup-config.js";
import { deriveStreamKey } from "./stream-key.js";
import {
  copyNeededLink,
  mountLatchBoxStatus,
  takeFirstCopy,
  type FirstCopyDeps,
  type FirstCopyStatus,
} from "./spare-copy.js";
import { holdRecoveryKey } from "./testing/recovery-key.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const MAIN = "node-main";
const SPARE = "node-spare";
const VENUE = "venue-7";
const OTHER_VENUE = "venue-8";
const PAIR = { accessKeyId: "waitron0123456789abcdef", secretAccessKey: "ab".repeat(32) };
const RECOVERY_KEY = "recovery-key-0123456789";
const LOOPBACK = "http://127.0.0.1:47123";

describe("takeFirstCopy", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS], timeoutMs: 60_000 });
  let db: Database;
  let stateDir: string;
  let fixtureDir: string;
  const mainKeys = generateNodeKeyPair();
  const spareKeys = generateNodeKeyPair();
  const otherKeys = generateNodeKeyPair();
  let logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  let link: PairLink;
  let running: { controller: AbortController; done: Promise<unknown> } | undefined;

  beforeAll(async () => {
    db = suite.db;
    fixtureDir = await mkdtemp(join(tmpdir(), "waitron-spare-copy-fixture-"));
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    logs = [];
    stateDir = await mkdtemp(join(tmpdir(), "waitron-spare-copy-"));
    await withNodeTransaction(suite.node, async (tx) => {
      await sealNodeSigningKeyTx(tx, RING, SPARE, spareKeys.privateKey);
      await writePairLinkTx(tx, RING, SPARE, {
        role: "serves",
        state: "awaiting_copy",
        peerNodeId: MAIN,
        peerPublicKey: mainKeys.publicKey,
        storeUrl: "https://main:7443",
        venueId: VENUE,
        ...PAIR,
      });
      await pinPrimaryKeyTx(tx, SPARE, { primaryNodeId: MAIN, publicKey: mainKeys.publicKey });
    });
    link = (await readPairLink(suite.node, SPARE))!;
  });

  afterEach(async () => {
    running?.controller.abort();
    await running?.done.catch(() => {});
    running = undefined;
    await rm(stateDir, { recursive: true, force: true });
  });

  /** A copy of this suite's venue.db holding the given `nodes` rows. */
  async function fixture(name: string, rows: { id: string; publicKey: string }[]) {
    if (rows.length > 0) {
      await db.insert(nodes).values(
        rows.map((row) => ({
          ...row,
          name: row.id,
          filingModule: "none",
          taxModule: "tax-es",
        })),
      );
    }
    const path = join(fixtureDir, `${name}.db`);
    await rm(path, { force: true });
    await db.archiveTo(path);
    await db.delete(nodes);
    return path;
  }

  const generation = (seconds: number) =>
    generationName(1, MAIN, new Date(Date.UTC(2026, 10, 13, 9, 0, seconds)));

  /** A store whose pointer names `gen`, for `venueId`, signed by `privateKey`, at `atVenue`'s key. */
  async function storeWithPointer(
    gen: string,
    opts: { privateKey?: string; venueId?: string; atVenue?: string } = {},
  ): Promise<MemoryObjectStore> {
    const store = createMemoryObjectStore();
    await setPointer(store, gen, opts);
    return store;
  }

  async function setPointer(
    store: MemoryObjectStore,
    gen: string,
    opts: { privateKey?: string; venueId?: string; atVenue?: string } = {},
  ) {
    const venueId = opts.venueId ?? VENUE;
    const signed = signPointer(
      { venueId, term: 1, nodeId: MAIN, generation: gen, writtenAt: "2026-11-13T09:01:00.000Z" },
      opts.privateKey ?? mainKeys.privateKey,
    );
    const atVenue = opts.atVenue ?? venueId;
    if (atVenue === venueId) {
      const existing = await store.get(pointerKey(venueId));
      await writePointer(store, venueId, signed, existing?.etag ?? null);
    } else {
      await store.put(pointerKey(atVenue), new TextEncoder().encode(JSON.stringify(signed)));
    }
  }

  const writeKey = (key = RECOVERY_KEY) => holdRecoveryKey(stateDir, key);

  function run(overrides: Partial<FirstCopyDeps> & { objectStore: MemoryObjectStore }) {
    const controller = new AbortController();
    const restart = vi.fn();
    const statuses: FirstCopyStatus[] = [];
    const openedWith: BucketConfig[] = [];
    const { objectStore, ...rest } = overrides;
    const done = takeFirstCopy({
      stateDir,
      node: suite.node,
      ring: RING,
      nodeId: SPARE,
      litestreamBin: "/unused/litestream",
      store: { loopbackUrl: LOOPBACK, stop: async () => {} },
      link,
      now: () => new Date(),
      log: (level, event, fields) => logs.push({ level, event, fields }),
      signal: controller.signal,
      readRecoveryKey: async () => loadRecoveryKey(await loadBoxEnv({}, stateDir)),
      migrationsRoot: null,
      restart,
      report: (status) => statuses.push(status),
      openStore: (bucket) => {
        openedWith.push(bucket);
        return objectStore;
      },
      intervalMs: 1,
      ...rest,
    });
    running = { controller, done };
    return { done, restart, statuses, openedWith, controller };
  }

  const copyOf = (path: string) =>
    vi.fn(async (args: RestoreGenerationArgs) => {
      await copyFile(path, args.outPath);
    });

  const events = (name: string) => logs.filter((entry) => entry.event === name);

  it("restores the newest generation the main box signed", async () => {
    await writeKey();
    const good = await fixture("good", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1));
    const restore = copyOf(good);
    // The main box opens a newer generation before the spare's first attempt reads the pointer.
    await setPointer(objectStore, generation(30));
    const r = run({ objectStore, restoreGeneration: restore });

    await expect(r.done).resolves.toBe("ready");
    expect(restore).toHaveBeenCalledOnce();
    const args = restore.mock.calls[0]![0];
    expect(args.generation).toBe(generation(30));
    expect(args.venueId).toBe(VENUE);
    expect(args.litestreamBin).toBe("/unused/litestream");
    expect(args.streamKey).toBe(deriveStreamKey(RECOVERY_KEY, VENUE));
    expect(args.outPath).toBe(join(stateDir, "pair-copy", "venue.db"));
    expect(args.bucket).toEqual({
      endpoint: LOOPBACK,
      region: "us-east-1",
      bucket: "waitron",
      prefix: "",
      ...PAIR,
    });
    expect(r.openedWith[0]).toEqual(args.bucket);
    await expect(stat(join(stateDir, "pair-copy", "ready.json"))).resolves.toBeTruthy();
    expect(r.restart).toHaveBeenCalledOnce();
    expect(events("spare.first_copy_ready")).toHaveLength(1);
  });

  it("ignores a pointer another key signed", async () => {
    await writeKey();
    const good = await fixture("good-other-key", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1), {
      privateKey: otherKeys.privateKey,
    });
    const restore = copyOf(good);
    const r = run({ objectStore, restoreGeneration: restore });

    await vi.waitFor(() =>
      expect(events("spare.first_copy_waiting").map((e) => e.fields?.reason)).toContain(
        "pointer_unverified",
      ),
    );
    expect(restore).not.toHaveBeenCalled();
    expect(r.restart).not.toHaveBeenCalled();

    // Control: the same store, once the main box's key signs the pointer, is restored.
    await setPointer(objectStore, generation(2));
    await expect(r.done).resolves.toBe("ready");
    expect(restore).toHaveBeenCalledOnce();
    expect(restore.mock.calls[0]![0].generation).toBe(generation(2));
  });

  it("discards a copy without this box's row and tries again", async () => {
    await writeKey();
    const late = await fixture("late", [{ id: MAIN, publicKey: mainKeys.publicKey }]);
    const wrongKey = await fixture("wrong-key", [{ id: SPARE, publicKey: otherKeys.publicKey }]);
    const good = await fixture("good-late", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const copies = [late, wrongKey, good];
    const seenBeforeRestore: boolean[] = [];
    const restore = vi.fn(async (args: RestoreGenerationArgs) => {
      seenBeforeRestore.push(
        await stat(args.outPath).then(
          () => true,
          () => false,
        ),
      );
      await copyFile(copies.shift()!, args.outPath);
    });
    const objectStore = await storeWithPointer(generation(1));
    const r = run({ objectStore, restoreGeneration: restore });

    await expect(r.done).resolves.toBe("ready");
    expect(restore).toHaveBeenCalledTimes(3);
    // Each attempt starts with no copy left from the one before.
    expect(seenBeforeRestore).toEqual([false, false, false]);
    expect(events("spare.first_copy_waiting").map((e) => e.fields?.reason)).toEqual([
      "own_row_missing",
    ]);
    expect(r.restart).toHaveBeenCalledOnce();
  });

  it("ignores a pointer naming another venue id", async () => {
    await writeKey();
    const good = await fixture("good-venue", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1), {
      venueId: OTHER_VENUE,
      atVenue: VENUE,
    });
    const restore = copyOf(good);
    const r = run({ objectStore, restoreGeneration: restore });

    await vi.waitFor(() =>
      expect(events("spare.first_copy_waiting").map((e) => e.fields?.reason)).toContain(
        "backup.stream_pointer_invalid",
      ),
    );
    expect(restore).not.toHaveBeenCalled();

    // Control: a pointer naming this venue is restored.
    await objectStore.delete(pointerKey(VENUE));
    await setPointer(objectStore, generation(2));
    await expect(r.done).resolves.toBe("ready");
    expect(restore).toHaveBeenCalledOnce();
  });

  it("reports waiting, restoring and ready, with bytes and ms, on the box status", async () => {
    const good = await fixture("good-status", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1));
    const readyAt = new Date(link.createdAt.getTime() + 93_000);
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const restore = vi.fn(async (args: RestoreGenerationArgs) => {
      await released;
      await copyFile(good, args.outPath);
    });
    let current: FirstCopyStatus | undefined;
    const app = new Hono();
    mountLatchBoxStatus(app, () => current);
    const status = async () => (await app.request("/api/box/status")).json();

    expect(await status()).toEqual({ adoption: "pending" });
    const r = run({
      objectStore,
      restoreGeneration: restore,
      now: () => readyAt,
      report: (next) => (current = next),
    });
    await vi.waitFor(() => expect(events("spare.first_copy_waiting")).toHaveLength(1));
    expect(await status()).toEqual({ adoption: "pending", copy: "waiting" });

    await writeKey();
    await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce());
    expect(await status()).toEqual({ adoption: "pending", copy: "restoring" });

    release();
    await expect(r.done).resolves.toBe("ready");
    const bytes = (await stat(good)).size;
    expect(await status()).toEqual({ adoption: "pending", copy: "ready", bytes, ms: 93_000 });
    expect(events("spare.first_copy_ready")[0]?.fields).toEqual({ bytes, ms: 93_000 });
  });

  it("waits while it holds no key", async () => {
    const good = await fixture("good-no-key", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1));
    const get = vi.spyOn(objectStore, "get");
    const restore = copyOf(good);
    const r = run({ objectStore, restoreGeneration: restore, intervalMs: 5 });

    await vi.waitFor(() => expect(r.statuses.length).toBeGreaterThanOrEqual(3));
    r.controller.abort();
    await r.done.catch(() => {});

    expect(r.statuses.every((s) => s.copy === "waiting")).toBe(true);
    expect(restore).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(events("spare.first_copy_waiting")).toEqual([
      {
        level: "info",
        event: "spare.first_copy_waiting",
        fields: { reason: "no_key" },
      },
    ]);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(RECOVERY_KEY);

    // A key under the length floor waits too, under its own reason.
    logs = [];
    await writeKey("short");
    const short = run({ objectStore, restoreGeneration: restore, intervalMs: 5 });
    await vi.waitFor(() => expect(short.statuses.length).toBeGreaterThanOrEqual(3));
    short.controller.abort();
    await short.done.catch(() => {});
    expect(restore).not.toHaveBeenCalled();
    expect(events("spare.first_copy_waiting").map((e) => e.fields?.reason)).toEqual([
      "key_too_short",
    ]);
  });

  it("makes no attempt while its hold is pending, and copies once it settles", async () => {
    await writeKey();
    const good = await fixture("good-held", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1));
    const restore = copyOf(good);
    const readRecoveryKey = vi.fn(async () => loadRecoveryKey(await loadBoxEnv({}, stateDir)));
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const r = run({ objectStore, restoreGeneration: restore, readRecoveryKey, hold });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readRecoveryKey).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    release();
    await expect(r.done).resolves.toBe("ready");
    expect(restore).toHaveBeenCalledOnce();
  });

  it("stops while held once its signal aborts", async () => {
    await writeKey();
    const objectStore = await storeWithPointer(generation(1));
    const restore = vi.fn();
    const r = run({ objectStore, restoreGeneration: restore, hold: new Promise<void>(() => {}) });

    r.controller.abort(new Error("stopped"));
    await expect(r.done).rejects.toThrow("stopped");
    expect(restore).not.toHaveBeenCalled();
  });

  it("reads the key afresh on every attempt", async () => {
    const good = await fixture("good-fresh", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1));
    const restore = copyOf(good);
    let attempts = 0;
    const readRecoveryKey = vi.fn(async () => {
      attempts += 1;
      // Written after the first attempt has read nothing, before the second reads again.
      if (attempts === 2) await writeKey();
      return loadRecoveryKey(await loadBoxEnv({}, stateDir));
    });
    const r = run({ objectStore, restoreGeneration: restore, readRecoveryKey });

    await expect(r.done).resolves.toBe("ready");
    expect(readRecoveryKey).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenCalledOnce();
    expect(restore.mock.calls[0]![0].streamKey).toBe(deriveStreamKey(RECOVERY_KEY, VENUE));
  });

  it("starts no copy when venue.db already holds this box's row", async () => {
    await db.insert(nodes).values({
      id: SPARE,
      name: "Spare",
      filingModule: "none",
      taxModule: "tax-es",
      publicKey: spareKeys.publicKey,
    });
    expect(await copyNeededLink({ db, node: suite.node, nodeId: SPARE })).toBeUndefined();

    // Control: with no row, the link is handed back for the copy.
    await db.delete(nodes);
    expect(await copyNeededLink({ db, node: suite.node, nodeId: SPARE })).toMatchObject({
      venueId: VENUE,
      state: "awaiting_copy",
    });
  });

  it("tries again after a restore the store refuses", async () => {
    await writeKey();
    const good = await fixture("good-refused", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1));
    let calls = 0;
    const restore = vi.fn(async (args: RestoreGenerationArgs) => {
      calls += 1;
      if (calls === 1)
        throw new AppError("backup.stream_request_failed", {
          operation: "get",
          key: "x",
          status: 503,
          name: "ServiceUnavailable",
        });
      await copyFile(good, args.outPath);
    });
    const r = run({ objectStore, restoreGeneration: restore });

    await expect(r.done).resolves.toBe("ready");
    expect(restore).toHaveBeenCalledTimes(2);
    expect(events("spare.first_copy_waiting").map((e) => e.fields)).toEqual([
      { reason: "backup.stream_request_failed", status: 503 },
    ]);
    expect(JSON.parse(await readFile(join(stateDir, "pair-copy", "ready.json"), "utf8"))).toEqual(
      {},
    );
  });

  it("refuses a copy made by newer software", async () => {
    await writeKey();
    await db.run(
      sql`insert into __drizzle_migrations_db (hash, created_at) values ('from-later', 1)`,
    );
    let ahead: string;
    try {
      ahead = await fixture("ahead", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    } finally {
      await db.run(sql`delete from __drizzle_migrations_db where hash = 'from-later'`);
    }
    const objectStore = await storeWithPointer(generation(1));
    const restore = copyOf(ahead);
    const r = run({ objectStore, restoreGeneration: restore });

    await vi.waitFor(() =>
      expect(events("spare.first_copy_waiting").map((e) => e.fields?.reason)).toContain(
        "provisioning.database_ahead",
      ),
    );
    r.controller.abort();
    await r.done.catch(() => {});
    expect(restore).toHaveBeenCalled();
    expect(r.restart).not.toHaveBeenCalled();
    expect(r.statuses.some((s) => s.copy === "ready")).toBe(false);
    await expect(stat(join(stateDir, "pair-copy", "ready.json"))).rejects.toThrow();
  });

  it("discards a copy that fails the integrity check", async () => {
    await writeKey();
    const good = await fixture("good-damaged", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1));
    const restore = copyOf(good);
    const checkIntegrity = vi.fn(async () => false);
    const r = run({ objectStore, restoreGeneration: restore, checkIntegrity });

    await vi.waitFor(() => expect(checkIntegrity.mock.calls.length).toBeGreaterThanOrEqual(2));
    r.controller.abort();
    await r.done.catch(() => {});
    expect(checkIntegrity).toHaveBeenCalledWith(join(stateDir, "pair-copy", "venue.db"));
    expect(events("spare.first_copy_waiting").map((e) => e.fields?.reason)).toEqual([
      "integrity_failed",
    ]);
    expect(r.restart).not.toHaveBeenCalled();
    expect(r.statuses.some((s) => s.copy === "ready")).toBe(false);
    await expect(stat(join(stateDir, "pair-copy", "ready.json"))).rejects.toThrow();
  });

  it("never logs the recovery key it holds", async () => {
    await writeKey();
    const good = await fixture("good-no-leak", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1));
    let calls = 0;
    const restore = vi.fn(async (args: RestoreGenerationArgs) => {
      calls += 1;
      if (calls === 1)
        throw new AppError("backup.stream_restore_failed", { exitCode: 1, diskFull: false });
      await copyFile(good, args.outPath);
    });
    const r = run({ objectStore, restoreGeneration: restore });
    await expect(r.done).resolves.toBe("ready");
    expect(events("spare.first_copy_waiting")).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(RECOVERY_KEY);

    // A key under the length floor; its text appears in no reason this module logs.
    const shortKey = "Qx7-Wv3";
    logs = [];
    await writeKey(shortKey);
    const short = run({ objectStore, restoreGeneration: restore, intervalMs: 5 });
    await vi.waitFor(() => expect(events("spare.first_copy_waiting")).toHaveLength(1));
    short.controller.abort();
    await short.done.catch(() => {});
    expect(JSON.stringify(logs)).not.toContain(shortKey);
  });

  it("leaves the status out of the waiting line when the refused request got no answer", async () => {
    await writeKey();
    const good = await fixture("good-no-answer", [{ id: SPARE, publicKey: spareKeys.publicKey }]);
    const objectStore = await storeWithPointer(generation(1));
    let calls = 0;
    const restore = vi.fn(async (args: RestoreGenerationArgs) => {
      calls += 1;
      if (calls === 1)
        throw new AppError("backup.stream_request_failed", {
          operation: "get",
          key: "x",
          status: null,
          name: "other",
        });
      await copyFile(good, args.outPath);
    });
    const r = run({ objectStore, restoreGeneration: restore });

    await expect(r.done).resolves.toBe("ready");
    expect(events("spare.first_copy_waiting").map((e) => e.fields)).toStrictEqual([
      { reason: "backup.stream_request_failed" },
    ]);
  });
});
