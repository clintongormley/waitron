import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  putCredential,
  type KeyRing,
} from "@waitron/credentials";
import { CORE_MIGRATIONS, withTransaction, writeNodeMembership, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { buildNextMembershipDocument, generateNodeKeyPair } from "@waitron/membership";
import {
  readPointer,
  venuePrefix,
  verifyPointer,
  type SpawnFn,
  type StreamStatus,
} from "@waitron/stream";
import { FakeLitestream, type FakeChild } from "@waitron/stream/testing/fake-litestream.js";
import { SwitchableStore } from "@waitron/stream/testing/switchable-store.js";
import {
  readStreamSettings,
  STREAM_PURPOSE,
  StreamHost,
  streamSettingsPayload,
  type StreamHostDeps,
} from "./stream-host.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const NODE_ID = "node-a";
const SETTINGS = {
  venueId: "venue-1",
  endpoint: "-",
  region: "eu-south-2",
  bucket: "venue-copies",
  prefix: "-",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret-example",
};

const generationOf = (view: ReturnType<StreamHost["status"]>): string =>
  (view as StreamStatus).generation ?? "";

describe("the live copy's wiring", () => {
  const suite = useVenueDb({
    resetPerTest: false,
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
    timeoutMs: 60_000,
  });
  let db: Database;
  let stateDir: string;
  const keys = generateNodeKeyPair();
  let logs: string[] = [];

  const runtime = (overrides: Partial<StreamHostDeps> = {}) =>
    new StreamHost({
      db,
      ring: RING,
      nodeId: NODE_ID,
      venueDir: stateDir,
      stateDir,
      litestreamBin: "litestream",
      log: (_level, event) => logs.push(event),
      now: () => new Date(),
      isPrimary: () => true,
      ...overrides,
    });

  beforeAll(async () => {
    db = suite.db;
    stateDir = await mkdtemp(join(tmpdir(), "waitron-stream-host-"));
    await withTransaction(db, (tx) =>
      putCredential(tx, RING, {
        purpose: "membership.node_key",
        value: { privateKey: keys.privateKey },
      }),
    );
  });

  afterAll(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  it("reads no settings, and starts nothing, when no bucket is stored", async () => {
    logs = [];
    expect(await readStreamSettings(db, RING)).toBeNull();
    const litestream = new FakeLitestream();
    const rt = runtime({ spawn: litestream.spawn });
    await rt.start();
    expect(rt.status()).toEqual({ state: "off" });
    expect(litestream.children).toHaveLength(0);
    expect(logs).toContain("stream.not_configured");
  });

  it("stores an absent endpoint and an empty prefix as '-', and a present one as itself", () => {
    const settings = {
      venueId: "venue-1",
      bucket: {
        region: "eu-south-2",
        bucket: "b",
        prefix: "",
        accessKeyId: "A",
        secretAccessKey: "S",
      },
    };
    expect(streamSettingsPayload(settings)).toEqual({
      venueId: "venue-1",
      endpoint: "-",
      region: "eu-south-2",
      bucket: "b",
      prefix: "-",
      accessKeyId: "A",
      secretAccessKey: "S",
    });
    expect(
      streamSettingsPayload({
        ...settings,
        bucket: { ...settings.bucket, endpoint: "https://e", prefix: "p/" },
      }),
    ).toMatchObject({ endpoint: "https://e", prefix: "p/" });
  });

  describe("with a bucket stored", () => {
    beforeAll(async () => {
      await withTransaction(db, (tx) =>
        putCredential(tx, RING, { purpose: STREAM_PURPOSE, value: SETTINGS }),
      );
    });

    it("reads the settings, with `-` read as absent", async () => {
      expect(await readStreamSettings(db, RING)).toEqual({
        venueId: "venue-1",
        bucket: {
          endpoint: undefined,
          region: "eu-south-2",
          bucket: "venue-copies",
          prefix: "",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "secret-example",
        },
      });
    });

    it("reads a stored endpoint and prefix back as themselves", async () => {
      await withTransaction(db, (tx) =>
        putCredential(tx, RING, {
          purpose: STREAM_PURPOSE,
          value: { ...SETTINGS, endpoint: "https://s3.example", prefix: "copies/" },
        }),
      );
      try {
        expect((await readStreamSettings(db, RING))?.bucket).toMatchObject({
          endpoint: "https://s3.example",
          prefix: "copies/",
        });
      } finally {
        await withTransaction(db, (tx) =>
          putCredential(tx, RING, { purpose: STREAM_PURPOSE, value: SETTINGS }),
        );
      }
    });

    it("starts nothing on a node that is not the primary", async () => {
      logs = [];
      const litestream = new FakeLitestream();
      const rt = runtime({ spawn: litestream.spawn, isPrimary: () => false });
      await rt.start();
      expect(rt.status()).toEqual({ state: "off" });
      expect(litestream.children).toHaveLength(0);
      expect(logs).toContain("stream.not_primary");
    });

    // The generation name and the pointer carry the membership term, so without a document there is
    // no term to stream under.
    it("starts nothing, and says so, before this node holds a membership document", async () => {
      logs = [];
      const litestream = new FakeLitestream();
      const rt = runtime({ spawn: litestream.spawn, store: new SwitchableStore(() => new Date()) });
      await rt.start();
      expect(rt.status()).toEqual({ state: "off" });
      expect(litestream.children).toHaveLength(0);
      expect(logs).toContain("stream.no_membership");
    });

    // Nothing external may block the box: a vault this box cannot open is logged and reads off.
    it("never throws: settings it cannot read are logged, and the copy reads off", async () => {
      logs = [];
      const otherRing = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xe).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      });
      const rt = runtime({ ring: otherRing, spawn: new FakeLitestream().spawn });
      await expect(rt.start()).resolves.toBeUndefined();
      expect(rt.status()).toEqual({ state: "off" });
      expect(logs).toContain("stream.start_failed");
    });

    describe("and a membership document", () => {
      beforeAll(async () => {
        await writeNodeMembership(
          db,
          buildNextMembershipDocument({
            heldDocument: null,
            nodes: [{ nodeId: NODE_ID, contactUrl: "https://a", standing: "serving-primary" }],
            signerNodeId: NODE_ID,
            signerPrivateKey: keys.privateKey,
          }),
        );
      });

      it("reloads by stopping the running Litestream before starting the next, so two never stream at once", async () => {
        const events: string[] = [];
        const store = new SwitchableStore(() => new Date(), events);
        const litestream = new FakeLitestream(events);
        const rt = runtime({ spawn: litestream.spawn, store });
        try {
          await rt.start();
          await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
          await rt.reload();
          await vi.waitFor(() => expect(litestream.replicas()).toHaveLength(2), {
            timeout: 10_000,
          });
          const replicas = events.filter(
            (event) => event === "spawn replicate" || event === "kill replicate",
          );
          expect(replicas).toEqual(["spawn replicate", "kill replicate", "spawn replicate"]);
        } finally {
          await rt.stop();
        }
      });

      it("refuses a second reload while one is running, rather than interleaving them", async () => {
        const rt = runtime({
          spawn: new FakeLitestream().spawn,
          store: new SwitchableStore(() => new Date()),
        });
        try {
          const first = rt.reload();
          await expect(rt.reload()).rejects.toMatchObject({ code: "backup.reload_in_progress" });
          await first;
        } finally {
          await rt.stop();
        }
      });

      it("starts one supervisor when two starts overlap", async () => {
        const litestream = new FakeLitestream();
        const rt = runtime({
          spawn: litestream.spawn,
          store: new SwitchableStore(() => new Date()),
        });
        try {
          await Promise.all([rt.start(), rt.start()]);
          await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
          // A second supervisor would have probed the binary too.
          await new Promise((resolve) => setTimeout(resolve, 200));
          expect(litestream.children.filter((child) => child.args[0] === "version")).toHaveLength(
            1,
          );
        } finally {
          await rt.stop();
        }
      });

      it("starts nothing after stop, so a shutdown is final", async () => {
        const litestream = new FakeLitestream();
        const rt = runtime({
          spawn: litestream.spawn,
          store: new SwitchableStore(() => new Date()),
        });
        await rt.start();
        await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
        await rt.stop();
        await rt.reload();
        await rt.start();
        expect(rt.status()).toEqual({ state: "off" });
        expect(litestream.replicas()).toHaveLength(1);
      });

      // stopWork closes the store once stop() resolves, so Litestream must be gone by then even when
      // a reload had already begun stopping it.
      /** A Litestream that takes 800 ms to exit after it is killed. */
      const slowToDie =
        (litestream: FakeLitestream): SpawnFn =>
        (bin, args, env) => {
          const child = litestream.spawn(bin, args, env) as FakeChild;
          if (args[0] === "replicate") {
            const kill = child.kill.bind(child);
            child.kill = () => {
              setTimeout(kill, 800);
            };
          }
          return child;
        };

      it("waits, on stop, for the old Litestream a running reload is still stopping", async () => {
        const litestream = new FakeLitestream();
        const rt = runtime({
          spawn: slowToDie(litestream),
          store: new SwitchableStore(() => new Date()),
        });
        await rt.start();
        await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
        const old = litestream.running()!;
        const reloading = rt.reload();
        await rt.stop();
        expect(old.done).toBe(true);
        await reloading;
        expect(litestream.running()).toBeUndefined();
        expect(rt.status()).toEqual({ state: "off" });
      });

      it("starts no second Litestream while a reload is still stopping the first", async () => {
        const events: string[] = [];
        const litestream = new FakeLitestream(events);
        const rt = runtime({
          spawn: slowToDie(litestream),
          store: new SwitchableStore(() => new Date(), events),
        });
        try {
          await rt.start();
          await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
          await Promise.all([rt.reload(), rt.start()]);
          await vi.waitFor(() => expect(litestream.replicas()).toHaveLength(2), {
            timeout: 10_000,
          });
          // The next supervisor checks the binary first, so its `version` marks when it began.
          const children = events.filter((event) => /^(spawn|kill) /.test(event));
          expect(children).toEqual([
            "spawn version",
            "spawn replicate",
            "kill replicate",
            "spawn version",
            "spawn replicate",
          ]);
        } finally {
          await rt.stop();
        }
      });

      // start() reads the vault before it builds the supervisor, so a shutdown can land in between.
      it("starts nothing when stop lands while start is still reading the settings", async () => {
        const litestream = new FakeLitestream();
        const rt = runtime({
          spawn: litestream.spawn,
          store: new SwitchableStore(() => new Date()),
        });
        const started = rt.start();
        await rt.stop();
        await started;
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(rt.status()).toEqual({ state: "off" });
        expect(litestream.children).toHaveLength(0);
      });

      it("streams at this node's term and signs the pointer with this node's membership key", async () => {
        const store = new SwitchableStore(() => new Date());
        const litestream = new FakeLitestream();
        const rt = runtime({ spawn: litestream.spawn, store });
        try {
          await rt.start();
          await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
          const generation = generationOf(rt.status());
          expect(generation).toMatch(/^gen-0-node-a-\d{8}T\d{6}Z$/);
          store.upload(
            `${venuePrefix("venue-1")}${generation}/0000/0000000000000001-0000000000000001.ltx`,
          );
          await vi.waitFor(() => expect(rt.status().state).toBe("streaming"), { timeout: 10_000 });
          const pointer = await readPointer(store, "venue-1");
          expect(verifyPointer(pointer!.pointer, keys.publicKey)).toBe(true);
          expect(pointer!.pointer.body).toMatchObject({ venueId: "venue-1", nodeId: NODE_ID });
        } finally {
          await rt.stop();
        }
      });

      // The limit is read from `<venueDir>/venue.db-wal`, and the fold-back runs on the venue store.
      it("measures this venue's side file and folds it back through the venue store", async () => {
        const venueDir = await mkdtemp(join(tmpdir(), "waitron-stream-host-venue-"));
        await writeFile(join(venueDir, "venue.db-wal"), Buffer.alloc(64));
        const foldBack = vi.spyOn(db, "checkpointTruncate");
        const litestream = new FakeLitestream();
        const rt = runtime({
          venueDir,
          spawn: litestream.spawn,
          store: new SwitchableStore(() => new Date()),
          walLimitBytes: 64,
        });
        try {
          await rt.start();
          await vi.waitFor(() => expect(foldBack).toHaveBeenCalled(), { timeout: 10_000 });
          expect(rt.status()).toMatchObject({ state: "paused", reason: "side_file_limit" });
        } finally {
          await rt.stop();
          foldBack.mockRestore();
          await rm(venueDir, { recursive: true, force: true });
        }
      });

      // A side file that cannot be measured is never read as an empty one. A link to itself fails
      // `stat` alone: the folder beside it stays usable.
      it("treats a side file it cannot measure as a failure, not as empty", async () => {
        const venueDir = await mkdtemp(join(tmpdir(), "waitron-stream-host-loop-"));
        await symlink("venue.db-wal", join(venueDir, "venue.db-wal"));
        logs = [];
        const litestream = new FakeLitestream();
        const rt = runtime({
          venueDir,
          spawn: litestream.spawn,
          store: new SwitchableStore(() => new Date()),
        });
        try {
          await rt.start();
          await vi.waitFor(() => expect(logs).toContain("stream.open_failed"), { timeout: 10_000 });
          expect(rt.status().state).toBe("opening");
        } finally {
          await rt.stop();
          await rm(venueDir, { recursive: true, force: true });
        }
      });
    });
  });
});
