import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadKeyRing,
  deleteCredential,
  putCredential,
  sealNodeSigningKeyTx,
  writePairLinkTx,
  type KeyRing,
} from "@waitron/credentials";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import {
  CORE_MIGRATIONS,
  createVenueSettings,
  ensureStreamId,
  VENUE_SETTINGS,
  readNodeMembership,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { buildNextMembershipDocument, generateNodeKeyPair, endorseKey } from "@waitron/membership";
import {
  pointerKey,
  signPointer,
  readPointer,
  verifyPointer,
  type SpawnFn,
  type StreamStatus,
} from "@waitron/stream";
import * as stream from "@waitron/stream";
import { ManualClock } from "@waitron/stream/testing/manual-clock.js";
import { FakeLitestream, type FakeChild } from "@waitron/stream/testing/fake-litestream.js";
import { SwitchableStore } from "@waitron/stream/testing/switchable-store.js";
import {
  readStreamSettings,
  readNewerBucketMain,
  STREAM_PURPOSE,
  StreamHost,
  streamService,
  streamSettingsPayload,
  type StreamHostDeps,
} from "./stream-host.js";
import { LiveEvents } from "./live-api.js";
import { STREAM_DIR, TLS_CLIENT_CERT_FILE, TLS_CLIENT_KEY_FILE, TLS_DIR } from "@waitron/store";
import { caCertPath } from "./box-secrets.js";
import {
  issueClientCert,
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";
import * as sparePipe from "./spare-pipe.js";
import { startStoreListener, type StoreListener } from "./spare-pipe.js";
import { omitStoredStreamField } from "./testing/old-stream-credential.js";
import { pauseListingPrefix } from "./testing/stream-pause-scenario.js";
import { backupAlertSource } from "./alert-sources.js";
import { deriveStreamKey } from "./stream-key.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const NODE_ID = "node-a";
const AT = new Date("2026-09-15T11:00:00.000Z");
const SETTINGS = {
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
    migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
    timeoutMs: 60_000,
  });
  let db: Database;
  let stateDir: string | undefined;
  const keys = generateNodeKeyPair();
  let logs: string[] = [];

  const runtime = (overrides: Partial<StreamHostDeps> = {}) =>
    new StreamHost({
      db,
      node: suite.node,
      ring: RING,
      nodeId: NODE_ID,
      venueDir: stateDir!,
      stateDir: stateDir!,
      litestreamBin: "litestream",
      log: (_level, event) => logs.push(event),
      now: () => new Date(),
      isPrimary: () => true,
      readRecoveryKey: async () => "backup-key-for-test-0123456789",
      refreshSealedState: async () => "sealed",
      ...overrides,
    });

  beforeAll(async () => {
    db = suite.db;
    stateDir = await mkdtemp(join(tmpdir(), "waitron-stream-host-"));
  });

  // useVenueDb empties the migrated tables after each case, so their rows are written per case.
  beforeEach(async () => {
    await withTransaction(db, (tx) =>
      createVenueSettings(
        tx,
        {
          ...VENUE_SETTINGS.defaults(),
          name: "Stream venue",
          streamId: "c0000000-0000-4000-8000-000000000002",
        },
        null,
      ),
    );
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING, NODE_ID, keys.privateKey),
    );
  });

  afterAll(async () => {
    if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
  });

  describe("evidence from the backup pointer", () => {
    const spareKeys = generateNodeKeyPair();
    const store = () => new SwitchableStore(() => AT);
    const deps = (bucket: SwitchableStore) => ({
      db,
      node: suite.node,
      ring: RING,
      nodeId: NODE_ID,
      store: bucket,
    });
    async function configure(
      options: {
        term?: number;
        standing?: "serving-secondary" | "evicted";
        endorsement?: "missing" | "forged";
      } = {},
    ) {
      await withTransaction(db, (tx) =>
        putCredential(tx, RING, { purpose: STREAM_PURPOSE, value: SETTINGS }),
      );
      const endorsement = endorseKey(
        "node-b",
        spareKeys.publicKey,
        NODE_ID,
        options.endorsement === "forged" ? spareKeys.privateKey : keys.privateKey,
      );
      await writeNodeMembership(
        db,
        buildNextMembershipDocument({
          heldDocument: null,
          minTerm: options.term ?? 1,
          nodes: [
            { nodeId: NODE_ID, contactUrl: "https://old.example", standing: "serving-primary" },
            {
              nodeId: "node-b",
              contactUrl: "https://new.example",
              standing: options.standing ?? "serving-secondary",
            },
          ],
          signerNodeId: NODE_ID,
          signerPrivateKey: keys.privateKey,
          endorsements: options.endorsement === "missing" ? [] : [endorsement],
        }),
      );
    }
    async function publish(
      bucket: SwitchableStore,
      term = 2,
      nodeId = "node-b",
      privateKey = spareKeys.privateKey,
    ) {
      const pointer = signPointer(
        {
          streamId: "c0000000-0000-4000-8000-000000000002",
          nodeId,
          term,
          generation: `gen-${term}-${nodeId}-20260915T110000Z`,
          writtenAt: AT.toISOString(),
        },
        privateKey,
      );
      await bucket.put(pointerKey(), new TextEncoder().encode(JSON.stringify(pointer)));
    }
    it("recognises only another enrolled box's newer signed pointer", async () => {
      await configure();
      const bucket = store();
      await publish(bucket);
      expect(await readNewerBucketMain(deps(bucket))).toEqual({
        successorNodeId: "node-b",
        membershipTerm: 2,
        contactUrl: "https://new.example",
      });
      await configure({ endorsement: "forged" });
      expect(await readNewerBucketMain(deps(bucket))).toBeNull();
    });
    it.each([
      "equal",
      "older",
      "self",
      "unknown",
      "bad-signature",
      "evicted",
      "missing-endorsement",
      "missing-pointer",
      "malformed",
      "unavailable",
      "unconfigured",
    ])("does not stop on %s evidence", async (kind) => {
      await configure({
        standing: kind === "evicted" ? "evicted" : undefined,
        endorsement: kind === "missing-endorsement" ? "missing" : undefined,
      });
      const bucket = store();
      if (kind === "self") {
        const chart = (await readNodeMembership(db))!;
        await writeNodeMembership(db, {
          ...chart,
          endorsements: [
            ...chart.endorsements,
            endorseKey(NODE_ID, keys.publicKey, NODE_ID, keys.privateKey),
          ],
        });
      }
      if (kind !== "missing-pointer")
        await publish(
          bucket,
          kind === "equal" ? 1 : kind === "older" ? 0 : 2,
          kind === "self" ? NODE_ID : kind === "unknown" ? "stranger" : "node-b",
          kind === "bad-signature" || kind === "self" ? keys.privateKey : spareKeys.privateKey,
        );
      if (kind === "malformed") await bucket.put(pointerKey(), new TextEncoder().encode("{}"));
      if (kind === "unavailable") bucket.down = true;
      if (kind === "unconfigured")
        await withTransaction(db, (tx) => tx.run(sql`delete from tenant_credentials`));
      expect(await readNewerBucketMain(deps(bucket))).toBeNull();
    });
    it("retries a failed stop instead of leaving the old main trading", async () => {
      await configure();
      const bucket = store();
      await publish(bucket);
      let attempts = 0;
      const rt = runtime({ store: bucket });
      try {
        rt.observeNewerMain(async () => {
          if (++attempts === 1) throw new Error("node read failed");
        }, 5);
        await vi.waitFor(() => expect(attempts).toBe(2));
      } finally {
        await rt.stop();
      }
    });
    it("reuses its bucket client until saved settings change", async () => {
      await configure();
      const bucket = store();
      const opened = vi.spyOn(stream, "createS3ObjectStore").mockReturnValue(bucket);
      const reads = vi.spyOn(bucket, "get");
      const rt = runtime();
      try {
        rt.observeNewerMain(async () => {}, 5);
        await vi.waitFor(() => expect(reads.mock.calls.length).toBeGreaterThanOrEqual(3));
        expect(opened).toHaveBeenCalledTimes(1);
        await withTransaction(db, (tx) =>
          putCredential(tx, RING, {
            purpose: STREAM_PURPOSE,
            value: { ...SETTINGS, secretAccessKey: "replacement-secret" },
          }),
        );
        await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
        expect(opened.mock.calls[1]![0].secretAccessKey).toBe("replacement-secret");
      } finally {
        await rt.stop();
        opened.mockRestore();
      }
    });
    it("checks the current chart after a slow bucket answer", async () => {
      await configure();
      const bucket = store();
      await publish(bucket);
      const get = bucket.get.bind(bucket);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = vi.fn();
      vi.spyOn(bucket, "get").mockImplementation(async (...args) => {
        entered();
        await hold;
        return get(...args);
      });
      const reading = readNewerBucketMain(deps(bucket));
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      await configure({ term: 3 });
      release();
      expect(await reading).toBeNull();
    });
    it("aborts and settles an observer waiting on a silent bucket during shutdown", async () => {
      await configure();
      const bucket = store();
      bucket.hang = true;
      const reading = vi.spyOn(bucket, "get");
      const stopped = vi.fn(async () => {});
      const rt = runtime({ store: bucket });
      rt.observeNewerMain(stopped, 5);
      await vi.waitFor(() => expect(reading).toHaveBeenCalledOnce());
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const prompt = await Promise.race([
          rt.stop().then(() => true),
          new Promise<boolean>((done) => {
            timer = setTimeout(() => done(false), 5_000);
          }),
        ]);
        expect(prompt).toBe(true);
        expect(stopped).not.toHaveBeenCalled();
      } finally {
        clearTimeout(timer);
        await rt.stop();
      }
    });
    it("settles an in-flight read before shutdown and ignores its late evidence", async () => {
      await configure();
      const bucket = store();
      await publish(bucket);
      const get = bucket.get.bind(bucket);
      let release!: () => void;
      let entered!: () => void;
      const held = new Promise<void>((done) => {
        release = done;
      });
      const reading = new Promise<void>((done) => {
        entered = done;
      });
      vi.spyOn(bucket, "get").mockImplementation(async (key) => {
        entered();
        await held;
        return get(key);
      });
      const stop = vi.fn(async () => {});
      const rt = runtime({ store: bucket });
      let settled = false;
      try {
        rt.observeNewerMain(stop, 5);
        await reading;
        const closing = rt.stop().then(() => {
          settled = true;
        });
        await new Promise<void>((done) => setImmediate(done));
        expect(settled).toBe(false);
        release();
        await closing;
        expect(stop).not.toHaveBeenCalled();
      } finally {
        release();
        await rt.stop();
      }
    });
    it("observes later evidence even while copying is off, and stops observing on shutdown", async () => {
      await configure();
      const bucket = store();
      const stopped = vi.fn(async () => {});
      const rt = runtime({ store: bucket, isPrimary: () => false });
      await rt.start();
      const duplicate = vi.fn(async () => {});
      rt.observeNewerMain(stopped, 5);
      rt.observeNewerMain(duplicate, 5);
      await publish(bucket);
      await vi.waitFor(() =>
        expect(stopped).toHaveBeenCalledWith({
          successorNodeId: "node-b",
          membershipTerm: 2,
          contactUrl: "https://new.example",
        }),
      );
      await rt.stop();
      expect(stopped).toHaveBeenCalledTimes(1);
      expect(duplicate).not.toHaveBeenCalled();
      expect(rt.status()).toEqual({ state: "off" });
    });
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

  // With nothing set up there is no copy to hold, so the log and the status say "not set up".
  it("reads plain off, not held, when no bucket is stored and a restore's first start is unfinished", async () => {
    logs = [];
    const rt = runtime({ spawn: new FakeLitestream().spawn, mayStream: () => false });
    await rt.start();
    expect(rt.status()).toEqual({ state: "off" });
    expect(logs).toContain("stream.not_configured");
    expect(logs).not.toContain("stream.first_start_pending");
  });

  it("stores an absent endpoint and an empty prefix as '-', and a present one as itself", () => {
    const settings = {
      streamId: "c0000000-0000-4000-8000-000000000002",
      bucket: {
        region: "eu-south-2",
        bucket: "b",
        prefix: "",
        accessKeyId: "A",
        secretAccessKey: "S",
      },
    };
    expect(streamSettingsPayload(settings)).toEqual({
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

  // "-" is how an empty prefix is stored, so a prefix of "-" would read back as none at all.
  it("refuses a prefix of a single hyphen, naming the field", () => {
    expect(() =>
      streamSettingsPayload({
        bucket: {
          region: "eu-south-2",
          bucket: "b",
          prefix: "-",
          accessKeyId: "A",
          secretAccessKey: "S",
        },
      }),
    ).toThrow(
      expect.objectContaining({ code: "backup.request_invalid", params: { field: "prefix" } }),
    );
  });

  it("describes an unconfigured stream service without claiming it is running", async () => {
    const rt = runtime();
    const service = streamService(rt, () => true);
    try {
      await service.start();
      expect(service.describe()).toEqual({ running: false, reason: "not_configured" });
      expect(service.applies()).toBe(true);
    } finally {
      await service.stop();
    }
  });

  describe("with a bucket stored", () => {
    beforeEach(async () => {
      await withTransaction(db, (tx) =>
        putCredential(tx, RING, { purpose: STREAM_PURPOSE, value: SETTINGS }),
      );
    });

    it("reads the settings, with `-` read as absent", async () => {
      expect(await readStreamSettings(db, RING)).toEqual({
        streamId: "c0000000-0000-4000-8000-000000000002",
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
      expect((await readStreamSettings(db, RING))?.bucket).toMatchObject({
        endpoint: "https://s3.example",
        prefix: "copies/",
      });
    });

    it.each(["endpoint", "region", "bucket", "prefix", "accessKeyId", "secretAccessKey"])(
      "refuses an older sealed bucket missing %s",
      async (field) => {
        await omitStoredStreamField(db, RING, field);
        await expect(readStreamSettings(db, RING)).rejects.toMatchObject({
          code: "server.credential_unusable",
          params: { purpose: "backup.stream", field },
        });
      },
    );

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
    // Off, but not "not set up": the settings are stored, so the reason reaches the alerts.
    it("starts nothing, and says so, before this node holds a membership document", async () => {
      logs = [];
      const litestream = new FakeLitestream();
      let resealed = false;
      const rt = runtime({
        spawn: litestream.spawn,
        store: new SwitchableStore(() => new Date()),
        now: () => AT,
        refreshSealedState: async () => {
          resealed = true;
          return "sealed";
        },
      });
      await rt.start();
      expect(rt.status()).toEqual({
        state: "off",
        reason: "no_membership",
        stateSince: AT.toISOString(),
      });
      expect(litestream.children).toHaveLength(0);
      expect(logs).toContain("stream.no_membership");
      expect(resealed).toBe(false);
    });

    // Nothing external may block the box: a vault this box cannot open is logged and reads off.
    it("never throws: settings it cannot read are logged, and the copy reads off", async () => {
      logs = [];
      const otherRing = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xe).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      });
      const rt = runtime({ ring: otherRing, spawn: new FakeLitestream().spawn, now: () => AT });
      await expect(rt.start()).resolves.toBeUndefined();
      expect(rt.status()).toEqual({
        state: "off",
        reason: "start_failed",
        stateSince: AT.toISOString(),
      });
      expect(logs).toContain("stream.start_failed");
    });

    it("forgets why it could not start once a later start has nothing to start", async () => {
      let primary = true;
      const otherRing = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xe).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      });
      const rt = runtime({
        ring: otherRing,
        spawn: new FakeLitestream().spawn,
        isPrimary: () => primary,
      });
      await rt.start();
      expect(rt.status()).toMatchObject({ state: "off", reason: "start_failed" });
      primary = false;
      await rt.reload();
      expect(rt.status()).toEqual({ state: "off" });
    });

    describe("and a membership document", () => {
      beforeEach(async () => {
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

      it("publishes bucket copy state transitions to open dashboards", async () => {
        const bus = new LiveEvents();
        const states: string[] = [];
        const rt = runtime({
          bus,
          spawn: new FakeLitestream().spawn,
          store: new SwitchableStore(() => new Date()),
        });
        bus.subscribe((event) => {
          if (event.kind === "change") {
            expect(event.change).toEqual({ resources: [{ type: "backup_status" }] });
            states.push(rt.status().state);
          }
        });
        try {
          await rt.start();
          await vi.waitFor(() => expect(rt.status().state).toBe("opening"), { timeout: 10_000 });
          expect(states).toContain("opening");
        } finally {
          await rt.stop();
        }
        expect(states.at(-1)).toBe("off");
      });

      it.each(["failed", "no_key"] as const)(
        "starts no child until resealing succeeds: %s",
        async (outcome) => {
          let sealed: "sealed" | "failed" | "no_key" = outcome;
          const litestream = new FakeLitestream();
          const rt = runtime({
            spawn: litestream.spawn,
            store: new SwitchableStore(() => new Date()),
            refreshSealedState: async () => sealed,
          });
          try {
            await rt.start();
            expect(rt.status()).toMatchObject({ state: "off", reason: "reseal_required" });
            expect(litestream.children).toHaveLength(0);
            sealed = "sealed";
            await rt.start();
            await vi.waitFor(() => expect(litestream.running()).toBeDefined());
            expect(litestream.running()!.env.WAITRON_STREAM_ENCRYPTION_KEY).toBe(
              "55OllgSkca2LtVvPZy6+4Lliqv3aCEHx9RWNW9CX89k=",
            );
            expect(Object.values(litestream.running()!.env)).not.toContain(
              "backup-key-for-test-0123456789",
            );
          } finally {
            await rt.stop();
          }
        },
      );

      it.each([false, true])(
        "discards a pending start crossing a key change, including a failed reseal: %s",
        async (fails) => {
          const litestream = new FakeLitestream();
          let rawKey = "backup-key-for-test-0123456789";
          let failReseal = false;
          let readCount = 0;
          let keyRead!: () => void;
          const reading = new Promise<void>((resolve) => {
            keyRead = resolve;
          });
          let releaseKey!: (key: string) => void;
          const oldKey = new Promise<string>((resolve) => {
            releaseKey = resolve;
          });
          let writing!: () => void;
          const writeStarted = new Promise<void>((resolve) => {
            writing = resolve;
          });
          let releaseWrite!: () => void;
          const writeHeld = new Promise<void>((resolve) => {
            releaseWrite = resolve;
          });
          const rt = runtime({
            spawn: litestream.spawn,
            store: new SwitchableStore(() => new Date()),
            refreshSealedState: async () => (failReseal ? "failed" : "sealed"),
            readRecoveryKey: async () => {
              if (++readCount === 1) {
                keyRead();
                return oldKey;
              }
              return rawKey;
            },
          });
          const started = rt.start();
          let reloading: Promise<void> | undefined;
          try {
            await reading;
            reloading = rt.reload(async () => {
              rawKey = "replacement-backup-key-0123456789";
              failReseal = fails;
              writing();
              await writeHeld;
            });
            await writeStarted;
            if (!fails) {
              releaseKey("backup-key-for-test-0123456789");
              await started;
              expect(litestream.children).toHaveLength(0);
            }
            releaseWrite();
            await reloading;
            if (fails) {
              releaseKey("backup-key-for-test-0123456789");
              await started;
              expect(rt.status()).toMatchObject({ state: "off", reason: "reseal_required" });
              expect(litestream.children).toHaveLength(0);
              failReseal = false;
              await rt.start();
            }
            await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
            expect(litestream.running()!.env.WAITRON_STREAM_ENCRYPTION_KEY).not.toBe(
              "55OllgSkca2LtVvPZy6+4Lliqv3aCEHx9RWNW9CX89k=",
            );
          } finally {
            releaseKey("backup-key-for-test-0123456789");
            releaseWrite();
            await started;
            await reloading;
            await rt.stop();
          }
        },
      );

      it("stops the old child before the key write and restarts on the old key when that write fails", async () => {
        const litestream = new FakeLitestream();
        const rt = runtime({
          spawn: litestream.spawn,
          store: new SwitchableStore(() => new Date()),
        });
        try {
          await rt.start();
          await vi.waitFor(() => expect(litestream.running()).toBeDefined());
          const old = litestream.running()!;
          let stoppedAtWrite = false;
          let childrenAtWrite = 0;
          const failure = new Error("key file refused");
          await expect(
            rt.reload(async () => {
              stoppedAtWrite = old.done;
              await rt.start();
              childrenAtWrite = litestream.children.length;
              throw failure;
            }),
          ).rejects.toBe(failure);
          expect(stoppedAtWrite).toBe(true);
          expect(childrenAtWrite).toBe(2);
          await vi.waitFor(() => expect(litestream.replicas()).toHaveLength(2), {
            timeout: 10_000,
          });
          expect(litestream.running()!.env.WAITRON_STREAM_ENCRYPTION_KEY).toBe(
            old.env.WAITRON_STREAM_ENCRYPTION_KEY,
          );
        } finally {
          await rt.stop();
        }
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

      // A restored box whose first start has not finished holds a term that may not have moved
      // (rebuild-first-start.ts), and a settings save reloads the host, so start AND reload hold it.
      it("starts nothing, on a start or a reload, while a restore's first start is unfinished", async () => {
        logs = [];
        let mayStream = false;
        const litestream = new FakeLitestream();
        const rt = runtime({
          spawn: litestream.spawn,
          store: new SwitchableStore(() => new Date()),
          mayStream: () => mayStream,
        });
        try {
          await rt.start();
          await rt.reload();
          expect(rt.status()).toEqual({
            state: "off",
            reason: "first_start_pending",
            stateSince: expect.any(String),
          });
          expect(litestream.children).toHaveLength(0);
          expect(logs.filter((event) => event === "stream.first_start_pending")).toHaveLength(2);
          mayStream = true;
          await rt.reload();
          await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
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

      it("suspends the stream service, starts it on promotion, and stops it for good", async () => {
        let primary = true;
        let now = AT;
        const litestream = new FakeLitestream();
        const rt = runtime({
          spawn: litestream.spawn,
          store: new SwitchableStore(() => now),
          now: () => now,
        });
        const service = streamService(rt, () => primary);
        try {
          await service.start();
          await vi.waitFor(() => expect(litestream.running()).toBeDefined());
          expect(service.describe()).toEqual({ running: true, reason: null });
          primary = false;
          expect(service.applies()).toBe(false);
          await service.suspend();
          expect(litestream.running()).toBeUndefined();
          expect(rt.status()).toEqual({ state: "off" });
          primary = true;
          now = new Date(AT.getTime() + 1_000);
          await service.start();
          await vi.waitFor(() => expect(litestream.running()).toBeDefined());
          expect(litestream.replicas()).toHaveLength(2);
          await service.stop();
          await service.start();
          expect(litestream.running()).toBeUndefined();
          expect(litestream.replicas()).toHaveLength(2);
        } finally {
          await service.stop();
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

      // The server's close() closes the store once this stop() settles, so Litestream must be gone
      // by then even when a reload had already begun stopping it.
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

      it.each(["", "another/"])(
        "streams at this node's term and signs the pointer with this node's membership key at prefix %s",
        async (prefix) => {
          if (prefix)
            await withTransaction(db, async (tx) => {
              await deleteCredential(tx, { purpose: STREAM_PURPOSE });
              await ensureStreamId(tx);
              await putCredential(tx, RING, {
                purpose: STREAM_PURPOSE,
                value: { ...SETTINGS, prefix },
              });
            });
          const store = new SwitchableStore(() => new Date());
          const litestream = new FakeLitestream();
          const rt = runtime({ spawn: litestream.spawn, store });
          try {
            await rt.start();
            await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
            const generation = generationOf(rt.status());
            expect(generation).toMatch(/^gen-0-node-a-\d{8}T\d{6}Z$/);
            expect(await readFile(litestream.running()!.args[2]!, "utf8")).toContain(
              `s3://venue-copies/${prefix}${generation}`,
            );
            store.upload(`${generation}/0000/0000000000000001-0000000000000001.ltx`);
            await vi.waitFor(() => expect(rt.status().state).toBe("streaming"), {
              timeout: 10_000,
            });
            const pointer = await readPointer(store, "c0000000-0000-4000-8000-000000000002");
            expect(verifyPointer(pointer!.pointer, keys.publicKey)).toBe(true);
            expect(pointer!.pointer.body).toMatchObject({
              streamId: "c0000000-0000-4000-8000-000000000002",
              nodeId: NODE_ID,
            });
          } finally {
            await rt.stop();
          }
        },
      );

      // The old supervisor's pointer write is held in flight through the reload and lands just after
      // the next supervisor has read the pointer, so the next one's conditional write is refused.
      it("keeps streaming after a reload when the old supervisor's pointer write lands late", async () => {
        const store = new SwitchableStore(() => new Date());
        const put = store.put.bind(store);
        const get = store.get.bind(store);
        const key = pointerKey();
        let release: (() => void) | undefined;
        let reloaded = false;
        store.put = async (k, body, cond) => {
          if (k === key && release === undefined) {
            await new Promise<void>((resolve) => (release = resolve));
          }
          return put(k, body, cond);
        };
        store.get = async (k) => {
          const answer = await get(k);
          if (k === key && reloaded) release?.();
          return answer;
        };
        const litestream = new FakeLitestream();
        let recoveryKey = "backup-key-for-test-0123456789";
        const rt = runtime({
          spawn: litestream.spawn,
          store,
          readRecoveryKey: async () => recoveryKey,
        });
        try {
          await rt.start();
          await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
          const first = generationOf(rt.status());
          store.upload(`${first}/0000/0000000000000001-0000000000000001.ltx`);
          await vi.waitFor(() => expect(release).toBeDefined(), { timeout: 10_000 });
          const oldKey = litestream.running()!.env.WAITRON_STREAM_ENCRYPTION_KEY;
          reloaded = true;
          recoveryKey = "replacement-backup-key-0123456789";
          await rt.reload();
          // The status names the next generation only once it is claimed and Litestream started,
          // which can trail the old write landing.
          await vi.waitFor(
            () => {
              expect(store.has(key)).toBe(true);
              expect(generationOf(rt.status())).not.toBe("");
            },
            { timeout: 10_000 },
          );
          await vi.waitFor(() => expect(litestream.replicas()).toHaveLength(2), {
            timeout: 10_000,
          });
          expect(litestream.running()!.env.WAITRON_STREAM_ENCRYPTION_KEY).not.toBe(oldKey);
          const second = generationOf(rt.status());
          expect(second).not.toBe(first);
          expect(
            (await readPointer(store, "c0000000-0000-4000-8000-000000000002"))!.pointer.body
              .generation,
          ).toBe(first);
          store.upload(`${second}/0000/0000000000000001-0000000000000001.ltx`);
          await vi.waitFor(() => expect(["streaming", "refused"]).toContain(rt.status().state), {
            timeout: 10_000,
          });
          expect(rt.status()).toMatchObject({ state: "streaming", generation: second });
          expect(
            (await readPointer(store, "c0000000-0000-4000-8000-000000000002"))!.pointer.body
              .generation,
          ).toBe(second);
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

      // Taken at this level: no case hands `startServer`'s `stream.store` seam a store.
      it("asks the store it was given whether the bucket answers, listing the level-0 folder the pause scenario names", async () => {
        const venueDir = await mkdtemp(join(tmpdir(), "waitron-stream-host-venue-"));
        const wal = join(venueDir, "venue.db-wal");
        await writeFile(wal, Buffer.alloc(64));
        const foldBack = vi.spyOn(db, "checkpointTruncate").mockImplementation(async () => {
          await writeFile(wal, "");
          return { reclaimed: true };
        });
        const store = new SwitchableStore(() => new Date());
        // Each listing asked while the stream reads paused, with the generation it is paused in.
        const whilePaused: { prefix: string; generation: string }[] = [];
        const list = store.list.bind(store);
        store.list = async (prefix, call) => {
          // Called only once `rt` below has started it.
          const view = rt.status();
          if (view.state === "paused") whilePaused.push({ prefix, generation: generationOf(view) });
          return list(prefix, call);
        };
        const rt = runtime({
          venueDir,
          spawn: new FakeLitestream().spawn,
          store,
          walLimitBytes: 64,
        });
        try {
          await rt.start();
          await vi.waitFor(() => expect(whilePaused).not.toHaveLength(0), { timeout: 10_000 });
          const [{ prefix, generation }] = whilePaused as [(typeof whilePaused)[number]];
          expect(generation).not.toBe("");
          expect(prefix).toBe(pauseListingPrefix({ prefix: "" }, generation));
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
          await vi.waitFor(() => expect(rt.status().state).toBe("opening"), { timeout: 10_000 });
        } finally {
          await rt.stop();
          await rm(venueDir, { recursive: true, force: true });
        }
      });

      // Starting never waits for a bucket that never answers, and every commit still reaches the
      // supervisor. The fake Litestream puts nothing on the commit path, so this does NOT show a sale
      // keeping its normal time against the real binary. The 1,000 ms bound catches a write that
      // takes a second or more; one that never finishes is caught by the test's timeout instead.
      it("returns from start() at once while the bucket never answers, and hears every commit", async () => {
        db.run(sql`create table if not exists stream_probe (n integer)`);
        const store = new SwitchableStore(() => new Date());
        store.hang = true;
        const rt = runtime({ spawn: new FakeLitestream().spawn, store });
        try {
          await rt.start();
          await vi.waitFor(() => expect(rt.status().state).toBe("opening"), { timeout: 10_000 });
          const durations: number[] = [];
          for (let i = 0; i < 200; i += 1) {
            const started = performance.now();
            await withTransaction(db, (tx) =>
              tx.run(sql`insert into stream_probe (n) values (${i})`),
            );
            durations.push(performance.now() - started);
          }
          expect(db.get(sql`select count(*) as n from stream_probe`)).toEqual({ n: 200 });
          expect(Math.max(...durations)).toBeLessThan(1_000);
          // The commits reached the supervisor: they wait, because nothing reached the bucket.
          await vi.waitFor(() => expect((rt.status() as StreamStatus).lagMs).toBeGreaterThan(0));
        } finally {
          await rt.stop();
        }
      });
    });
  });

  describe("paired with a spare", () => {
    const MAIN_NAME = "box-7f3a.waitron.local";
    const SPARE_NAME = "box-5c21.waitron.local";
    const PAIR = { accessKeyId: "pair-access-key", secretAccessKey: "pair-secret-key" };
    let venue: SelfSignedMaterial;
    let certDir: string;
    let upstream: Server;
    const reached: string[] = [];
    let spare: StoreListener | undefined;

    beforeAll(async () => {
      const at = new Date();
      venue = mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now: at });
      const other = mintSelfSignedServerCert({
        hostnames: ["waitron.local"],
        ipAddresses: [],
        now: at,
      });
      certDir = await mkdtemp(join(tmpdir(), "waitron-stream-host-spare-"));
      for (const [file, authority] of [
        ["spare.pem", venue],
        ["stranger.pem", other],
      ] as const) {
        const leaf = reissueServerLeaf({
          caCertPem: authority.caCertPem,
          caKeyPem: authority.caKeyPem,
          hostnames: [SPARE_NAME],
          ipAddresses: [],
          now: at,
        });
        await writeFile(join(certDir, file), leaf.serverCertPem + leaf.serverKeyPem);
      }
      await writeFile(join(certDir, "ca.crt"), venue.caCertPem);
      const client = issueClientCert({
        caCertPem: venue.caCertPem,
        caKeyPem: venue.caKeyPem,
        hostname: MAIN_NAME,
        now: at,
      });
      await mkdir(join(stateDir!, TLS_DIR), { recursive: true });
      await writeFile(caCertPath(stateDir!), venue.caCertPem);
      await writeFile(join(stateDir!, TLS_CLIENT_CERT_FILE), client.clientCertPem);
      await writeFile(join(stateDir!, TLS_CLIENT_KEY_FILE), client.clientKeyPem);
      upstream = createHttpServer((req, res) => {
        reached.push(req.url ?? "");
        res.end("stored");
      });
      await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    });

    beforeEach(async () => {
      reached.length = 0;
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

    afterEach(async () => {
      await spare?.close();
      spare = undefined;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await rm(certDir, { recursive: true, force: true });
    });

    async function startSpare(leafFile: string, peerHostname = MAIN_NAME): Promise<string> {
      spare = await startStoreListener({
        port: 0,
        host: "127.0.0.1",
        certFile: join(certDir, leafFile),
        keyFile: join(certDir, leafFile),
        caFile: join(certDir, "ca.crt"),
        peerHostname,
        upstreamPort: (upstream.address() as AddressInfo).port,
        log: () => {},
      });
      return `https://${SPARE_NAME}:${spare.port}`;
    }

    async function pair(storeUrl: string) {
      await withNodeTransaction(suite.node, (tx) =>
        writePairLinkTx(tx, RING, NODE_ID, {
          role: "streams",
          state: "streaming",
          peerNodeId: "node-b",
          peerPublicKey: "spare-public-key",
          storeUrl,
          venueId: "venue-7",
          ...PAIR,
        }),
      );
    }

    const pairedRuntime = (
      litestream: FakeLitestream,
      store = new SwitchableStore(() => new Date()),
    ) =>
      runtime({
        spawn: litestream.spawn,
        store,
        storeLookup: async (hostname) => {
          expect(hostname).toBe(SPARE_NAME);
          return { addresses: ["127.0.0.1"], remembered: false };
        },
      });

    const replicaUrl = async () =>
      (await readFile(join(stateDir!, STREAM_DIR, "litestream.yml"), "utf8")).match(
        /url: "([^"]+)"/,
      )![1]!;

    /** A request through the address Litestream is given, as Litestream sends one. */
    function getThrough(endpoint: string): Promise<string> {
      return new Promise((resolve) => {
        const req = httpRequest(`${endpoint}/waitron/probe`, { agent: false }, (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => (body += chunk.toString()));
          res.on("end", () => resolve(`${res.statusCode} ${body}`));
        });
        req.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
        req.end();
      });
    }

    it("streams to the spare's store when the pair link says streaming", async () => {
      await withTransaction(db, (tx) =>
        putCredential(tx, RING, { purpose: STREAM_PURPOSE, value: SETTINGS }),
      );
      await pair(await startSpare("spare.pem"));
      const litestream = new FakeLitestream();
      const store = new SwitchableStore(() => new Date());
      const rt = pairedRuntime(litestream, store);
      try {
        await rt.start();
        await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });

        const url = new URL(await replicaUrl());
        expect(url.host).toBe("waitron");
        expect(url.pathname).toMatch(/^\/gen-0-node-a-\d{8}T\d{6}Z$/);
        const generation = generationOf(rt.status());
        store.upload(`${generation}/0000/0000000000000001-0000000000000001.ltx`);
        await vi.waitFor(() => expect(rt.status().state).toBe("streaming"), { timeout: 10_000 });
        expect((await readPointer(store, "venue-7"))!.pointer.body.streamId).toBe("venue-7");
        expect(url.searchParams.get("region")).toBe("us-east-1");
        const endpoint = url.searchParams.get("endpoint")!;
        expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(litestream.running()!.env).toMatchObject({
          WAITRON_STREAM_ACCESS_KEY_ID: PAIR.accessKeyId,
          WAITRON_STREAM_SECRET_ACCESS_KEY: PAIR.secretAccessKey,
          WAITRON_STREAM_ENCRYPTION_KEY: deriveStreamKey(
            "backup-key-for-test-0123456789",
            "venue-7",
          ),
        });
        expect(await getThrough(endpoint)).toBe("200 stored");
        expect(reached).toEqual(["/waitron/probe"]);
        expect(rt.status()).toMatchObject({ bucketProblem: null, toSpare: true });
      } finally {
        await rt.stop();
      }
    });

    it("a copy to the spare that could not start says it was going to the spare", async () => {
      await pair(await startSpare("spare.pem"));
      const notSealed = runtime({ refreshSealedState: async () => "failed" });
      try {
        await notSealed.start();
        expect(notSealed.status()).toEqual({
          state: "off",
          reason: "reseal_required",
          stateSince: expect.any(String),
          toSpare: true,
        });
      } finally {
        await notSealed.stop();
      }
      // An address the pipe cannot parse: its start throws, after the target was read.
      await pair("not a store address");
      const broken = pairedRuntime(new FakeLitestream());
      try {
        await broken.start();
        expect(broken.status()).toEqual({
          state: "off",
          reason: "start_failed",
          stateSince: expect.any(String),
          toSpare: true,
        });
      } finally {
        await broken.stop();
      }
    });

    it("streams to the bucket when there is no pair link", async () => {
      await withTransaction(db, (tx) =>
        putCredential(tx, RING, {
          purpose: STREAM_PURPOSE,
          value: { ...SETTINGS, endpoint: "https://s3.example.test" },
        }),
      );
      const litestream = new FakeLitestream();
      const rt = pairedRuntime(litestream);
      try {
        await rt.start();
        await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });

        const url = new URL(await replicaUrl());
        expect(url.host).toBe("venue-copies");
        expect(url.pathname).toMatch(/^\/gen-0-node-a-\d{8}T\d{6}Z$/);
        expect(url.searchParams.get("endpoint")).toBe("https://s3.example.test");
        expect(litestream.running()!.env).toMatchObject({
          WAITRON_STREAM_ACCESS_KEY_ID: SETTINGS.accessKeyId,
          WAITRON_STREAM_SECRET_ACCESS_KEY: SETTINGS.secretAccessKey,
        });
        expect(rt.status()).not.toHaveProperty("toSpare");
      } finally {
        await rt.stop();
      }
    });

    it("a pipe refused by the spare's certificate puts the stream's bucket problem in its status", async () => {
      await pair(await startSpare("stranger.pem"));
      const litestream = new FakeLitestream();
      const rt = pairedRuntime(litestream);
      try {
        await rt.start();
        await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
        expect(rt.status()).toMatchObject({ bucketProblem: null });

        const endpoint = new URL(await replicaUrl()).searchParams.get("endpoint")!;
        expect(await getThrough(endpoint)).not.toBe("200 stored");

        expect(rt.status()).toMatchObject({
          bucketProblem: { reason: "CERT_SIGNATURE_FAILURE", since: expect.any(String) },
        });
        expect(reached).toEqual([]);
      } finally {
        await rt.stop();
      }
    });

    it("a pipe refused by the spare's store (wrong client certificate) puts the stream's bucket problem in its status", async () => {
      await pair(await startSpare("spare.pem", "box-9e0d.waitron.local"));
      const litestream = new FakeLitestream();
      const rt = pairedRuntime(litestream);
      try {
        await rt.start();
        await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
        expect(rt.status()).toMatchObject({ bucketProblem: null });

        const endpoint = new URL(await replicaUrl()).searchParams.get("endpoint")!;
        expect(await getThrough(endpoint)).not.toBe("200 stored");

        await vi.waitFor(() =>
          expect((rt.status() as StreamStatus).bucketProblem?.reason).toMatch(
            /^(ECONNRESET|store_closed_before_answer)$/,
          ),
        );
        expect(reached).toEqual([]);
      } finally {
        await rt.stop();
      }
    });

    it.each([false, true])(
      "preserves native refusal time only for a paired target (%s)",
      async (paired) => {
        if (paired) await pair(await startSpare("spare.pem"));
        else
          await withTransaction(db, (tx) =>
            putCredential(tx, RING, { purpose: STREAM_PURPOSE, value: SETTINGS }),
          );
        const clock = new ManualClock("2026-11-14T12:00:00.000Z");
        const opened = vi.spyOn(sparePipe, "startStorePipe");
        const Supervisor = stream.StreamSupervisor;
        let native!: InstanceType<typeof Supervisor>;
        const started = vi.spyOn(stream, "StreamSupervisor").mockImplementation(function (deps) {
          native = new Supervisor({ ...deps, sleep: clock.sleep, monotonic: clock.monotonic });
          return native;
        });
        const store = new SwitchableStore(clock.now);
        store.honoursConditions = false;
        const rt = runtime({ now: clock.now, store, spawn: new FakeLitestream().spawn });
        try {
          await rt.start();
          await clock.until(() => native.status().bucketProblem?.reason === "create_only_ignored");
          const pipe = paired ? await opened.mock.results.at(-1)!.value : undefined;
          if (paired) expect(pipe?.problem()).toBeNull();
          const first = native.status().bucketProblem!.since;
          store.denied = true;
          await clock.until(() => native.status().bucketProblem?.reason === "access_denied");
          if (paired) expect(pipe?.problem()).toBeNull();
          const changed = (rt.status() as StreamStatus).bucketProblem!.since;
          expect(changed).toBe(native.status().bucketProblem!.since);
          if (paired) expect(changed).toBe(first);
          else expect(changed).not.toBe(first);
          store.denied = false;
          store.honoursConditions = true;
          await clock.until(() => (rt.status() as StreamStatus).bucketProblem === null);
        } finally {
          await rt.stop();
          started.mockRestore();
          opened.mockRestore();
        }
      },
    );

    it("keeps the earlier active pipe outage when a later native refusal appears", async () => {
      await pair(await startSpare("spare.pem"));
      const opened = vi.spyOn(sparePipe, "startStorePipe");
      const rt = pairedRuntime(new FakeLitestream(), new SwitchableStore(() => new Date()));
      let restoreNative: (() => void) | undefined, restoreTransport: (() => void) | undefined;
      const first = "2026-11-14T12:00:00.000Z",
        later = "2026-11-14T12:01:00.000Z";
      try {
        await rt.start();
        const pipe = await opened.mock.results[0]!.value;
        const transport = vi
          .spyOn(pipe, "problem")
          .mockReturnValue({ reason: "ECONNREFUSED", since: first });
        const view: StreamStatus = {
          state: "streaming",
          reason: null,
          generation: "gen-0-node-a-20261114T120000Z",
          stateSince: first,
          lagMs: 0,
          lastConfirmedUploadAt: first,
          bucketProblem: null,
        };
        const native = vi
          .spyOn(stream.StreamSupervisor.prototype, "status")
          .mockImplementation(() => view);
        restoreNative = () => native.mockRestore();
        restoreTransport = () => transport.mockRestore();
        let observedAt = new Date("2026-11-14T12:02:00.000Z");
        const source = backupAlertSource({
          listStatus: async () => ({ configured: true, destinations: [] }),
          outcomes: { failed: new Map() },
          now: () => observedAt,
          readStream: () => rt.status(),
        });
        const alertCodes = async () =>
          (await source.read({ tx: {} as never, now: observedAt })).map((a) => a.code);
        expect(rt.status()).toMatchObject({
          bucketProblem: { reason: "ECONNREFUSED", since: first },
        });
        expect(await alertCodes()).toEqual(["backup.stream_bucket_unusable"]);
        view.bucketProblem = { reason: "access_denied", since: later };
        const merged = rt.status(),
          after = await alertCodes();
        expect((merged as StreamStatus).bucketProblem?.reason).toBe("access_denied");
        expect(after).toEqual(["backup.stream_bucket_unusable"]);
        expect(merged).toMatchObject({ bucketProblem: { reason: "access_denied", since: first } });
        transport.mockReturnValue(null);
        observedAt = new Date("2026-11-14T12:02:30.000Z");
        expect(await alertCodes()).toEqual(["backup.stream_bucket_unusable"]);
        expect(rt.status()).toMatchObject({
          bucketProblem: { reason: "access_denied", since: first },
        });
        view.bucketProblem = null;
        expect(rt.status()).toMatchObject({ bucketProblem: null });
        expect(await alertCodes()).toEqual([]);
        view.bucketProblem = { reason: "access_denied", since: observedAt.toISOString() };
        expect(rt.status()).toMatchObject({ bucketProblem: { since: "2026-11-14T12:02:30.000Z" } });
        expect(await alertCodes()).toEqual([]);
        view.bucketProblem = { reason: "access_denied", since: "2026-11-14T12:03:00.000Z" };
        await rt.reload();
        expect(rt.status()).toMatchObject({ bucketProblem: { since: "2026-11-14T12:03:00.000Z" } });
      } finally {
        restoreNative?.();
        restoreTransport?.();
        opened.mockRestore();
        await rt.stop();
      }
    });

    it("keeps the supervisor's own bucket problem over the pipe's", async () => {
      await pair(await startSpare("stranger.pem"));
      const opened = vi.spyOn(sparePipe, "startStorePipe");
      const store = new SwitchableStore(() => new Date());
      store.denied = true;
      const rt = runtime({
        spawn: new FakeLitestream().spawn,
        store,
        storeLookup: async () => ({ addresses: ["127.0.0.1"], remembered: false }),
      });
      try {
        await rt.start();
        await vi.waitFor(() => expect((rt.status() as StreamStatus).bucketProblem).not.toBeNull(), {
          timeout: 10_000,
        });
        const outageSince = (rt.status() as StreamStatus).bucketProblem!.since;
        const pipe = await opened.mock.results[0]!.value;
        expect(await getThrough(pipe.loopbackUrl)).not.toBe("200 stored");
        expect(pipe.problem()).toMatchObject({ reason: "CERT_SIGNATURE_FAILURE" });

        expect(rt.status()).toMatchObject({ bucketProblem: { reason: "access_denied" } });
        expect((rt.status() as StreamStatus).bucketProblem!.since).toBe(outageSince);
      } finally {
        opened.mockRestore();
        await rt.stop();
      }
    });

    it("closes the pipe when the stream stops", async () => {
      await pair(await startSpare("spare.pem"));
      const litestream = new FakeLitestream();
      const rt = pairedRuntime(litestream);
      await rt.start();
      await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 10_000 });
      const endpoint = new URL(await replicaUrl()).searchParams.get("endpoint")!;

      await rt.stop();

      expect(await getThrough(endpoint)).toBe("ECONNREFUSED");
    });
  });
});
