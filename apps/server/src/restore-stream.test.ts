import { copyFile, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  tenants,
  tills,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  generationPrefix,
  pointerKey,
  signPointer,
  writePointer,
  type BucketConfig,
  type ObjectStore,
  type RecoveryKit,
  type RestoreGenerationArgs,
  type StreamPointer,
} from "@waitron/stream";
import {
  createMemoryObjectStore,
  type MemoryObjectStore,
} from "@waitron/stream/testing/memory-store.js";
import type { ArchiveEntry } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import { formatEnvFile } from "./env-file.js";
import { REBUILD_MARKER } from "./rebuild-first-start.js";
import type { ValidatedArtifact } from "./restore.js";
import {
  LIVE_WINDOW_MS,
  checkIntegrity,
  measureBucketSkew,
  prepareStreamRestore,
  refuseIfArchiveSourceLive,
  refuseIfSourceLive,
  restoreFromStream,
  type PrepareStreamDeps,
} from "./restore-stream.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});

const T = {
  locationId: "c0000000-0000-4000-8000-000000000002",
  tillId: "c0000000-0000-4000-8000-000000000003",
  seriesId: "c0000000-0000-4000-8000-000000000004",
  nodeId: "c0000000-0000-4000-8000-000000000008",
};
const OTHER_LOCATION_ID = "c0000000-0000-4000-8000-000000000001";
const RECOVERY_KEY = "recovery-key-one-strong";
const GENERATION = `gen-0-${T.nodeId}-20260923T090000Z`;
const NOW = new Date("2026-09-23T12:00:00Z");
const VENUE = { legalName: "Waitron SL", taxId: "89890001K", locationName: "Local" };
const MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-09-23T09:00:00.000Z",
  environment: "preproduction",
  modules: {},
};
const ENTRIES: ArchiveEntry[] = [
  { name: "manifest.json", bytes: Buffer.from(JSON.stringify(MANIFEST)) },
  { name: "secrets/secrets.env", bytes: Buffer.from("WAITRON_CREDENTIALS_KEY=deadbeef\n") },
  {
    name: "secrets/trading.env",
    bytes: Buffer.from(
      formatEnvFile({
        WAITRON_TILL_TILL_ID: T.tillId,
        WAITRON_TILL_NODE_ID: T.nodeId,
        WAITRON_TILL_SERIES_ID: T.seriesId,
        WAITRON_TILL_LOCATION_ID: T.locationId,
        WAITRON_ENV: "preproduction",
      }),
    ),
  },
];

const signer = generateNodeKeyPair();
/** A real venue file, as Litestream would restore it. */
let fixtureDb: string;

beforeAll(async () => {
  const db = suite.db;
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: VENUE.taxId, legalName: VENUE.legalName });
  // Inserted first, so a read that ignored the kit's venue would find this one.
  await db.insert(locations).values({
    id: OTHER_LOCATION_ID,
    name: "Another venue",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await db.insert(locations).values({
    id: T.locationId,
    name: VENUE.locationName,
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await db.insert(tills).values({ id: T.tillId, locationId: T.locationId, name: "Caja 1" });
  await db.insert(nodes).values({ id: T.nodeId, locationId: T.locationId, name: "Node 1" });
  await db.insert(invoiceSeries).values({ id: T.seriesId, nodeId: T.nodeId, code: "FA" });
  await writeSealedStateRow(db, T.nodeId, await sealNodeState(ENTRIES, RECOVERY_KEY), NOW);
  fixtureDb = join(await mkdtemp(join(tmpdir(), "waitron-stream-fixture-")), "venue.db");
  await db.archiveTo(fixtureDb);
  // A copy restored from the bucket carries Litestream's own two tables (plan Reconciliation L1),
  // so every check below runs over a file that has them. The column shapes are not Litestream's
  // measured ones; only the names matter to a check that enumerates tables.
  const withLitestream = new DatabaseSync(fixtureDb);
  try {
    withLitestream.exec("create table _litestream_seq (id integer primary key, seq integer)");
    withLitestream.exec("create table _litestream_lock (id integer)");
  } finally {
    withLitestream.close();
  }
});

const KIT: RecoveryKit = {
  version: 1,
  venueId: T.locationId,
  bucket: {
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "",
    accessKeyId: "AKIA",
    secretAccessKey: "secret-0123456789",
  },
  recoveryKey: RECOVERY_KEY,
  pointerSignerPublicKey: signer.publicKey,
};

const POINTER: StreamPointer = {
  venueId: T.locationId,
  term: 0,
  nodeId: T.nodeId,
  generation: GENERATION,
  writtenAt: "2026-09-23T09:00:05.000Z",
};

/**
 * A bucket holding a pointer to GENERATION signed by `signWith`, whose one change file was written
 * at `lastChangeAt` on the bucket's clock. The bucket's clock then reads NOW.
 */
async function bucket(
  opts: { lastChangeAt?: Date; signWith?: string } = {},
): Promise<MemoryObjectStore> {
  let clock = opts.lastChangeAt ?? new Date(NOW.getTime() - 60 * 60_000);
  const store = createMemoryObjectStore({ now: () => clock });
  await writePointer(
    store,
    T.locationId,
    signPointer(POINTER, opts.signWith ?? signer.privateKey),
    null,
  );
  await store.put(
    `${generationPrefix(T.locationId, GENERATION)}ltx/0/0000000000000001.ltx`,
    Uint8Array.from([1]),
  );
  clock = NOW;
  return store;
}

const copyFixture = vi.fn(async (args: RestoreGenerationArgs) => {
  await copyFile(fixtureDb, args.outPath);
});

async function prepareDeps(
  store: ObjectStore,
  overrides: Partial<PrepareStreamDeps> = {},
): Promise<PrepareStreamDeps> {
  return {
    kit: KIT,
    stateDir: await mkdtemp(join(tmpdir(), "waitron-stream-state-")),
    migrationsRoot: null,
    litestreamBin: "/unused",
    oldBoxGone: false,
    now: () => NOW,
    log: () => {},
    openStore: () => store,
    restoreGeneration: copyFixture,
    ...overrides,
  };
}

/** Nothing staged and no scratch left behind. */
async function expectStateUntouched(stateDir: string): Promise<void> {
  expect(await readdir(stateDir)).toEqual([]);
}

describe("prepareStreamRestore", () => {
  it("restores the pointer's generation and unlocks the node's secrets row", async () => {
    const deps = await prepareDeps(await bucket());
    const prepared = await prepareStreamRestore(deps);
    expect(prepared.nodeId).toBe(T.nodeId);
    expect(prepared.generation).toBe(GENERATION);
    expect(prepared.venue).toEqual(VENUE);
    expect(prepared.entries.map((e) => e.name).sort()).toEqual(ENTRIES.map((e) => e.name).sort());
    expect(copyFixture).toHaveBeenLastCalledWith(
      expect.objectContaining({
        generation: GENERATION,
        venueId: T.locationId,
        bucket: KIT.bucket,
      }),
    );
    // The checks only read, so no committed row is left in a side file beside the one staged.
    const wal = await stat(`${prepared.databasePath}-wal`).catch(() => null);
    expect(wal === null || wal.size === 0).toBe(true);
    await prepared.discard();
    await expectStateUntouched(deps.stateDir);
  });

  it("refuses a bucket with no pointer", async () => {
    const deps = await prepareDeps(createMemoryObjectStore());
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_pointer_missing",
    });
    await expectStateUntouched(deps.stateDir);
  });

  it("refuses a pointer signed by any key other than the kit's, before downloading anything", async () => {
    const restore = vi.fn();
    const deps = await prepareDeps(await bucket({ signWith: generateNodeKeyPair().privateKey }), {
      restoreGeneration: restore,
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_pointer_unverified",
      params: { reason: "signature" },
    });
    expect(restore).not.toHaveBeenCalled();
    await expectStateUntouched(deps.stateDir);
  });

  it("refuses a pointer naming another venue, before downloading anything", async () => {
    const store = await bucket();
    const other = signPointer(
      { ...POINTER, venueId: "c0000000-0000-4000-8000-0000000000ff" },
      signer.privateKey,
    );
    await store.put(pointerKey(T.locationId), Buffer.from(JSON.stringify(other)));
    const restore = vi.fn();
    const deps = await prepareDeps(store, { restoreGeneration: restore });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_pointer_unverified",
      params: { reason: "venue_mismatch" },
    });
    expect(restore).not.toHaveBeenCalled();
    await expectStateUntouched(deps.stateDir);
  });

  it("passes a malformed pointer's refusal through as it came", async () => {
    const store = await bucket();
    await store.put(pointerKey(T.locationId), Buffer.from("not json"));
    const deps = await prepareDeps(store);
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "backup.stream_pointer_invalid",
      params: { reason: "not_json" },
    });
    await expectStateUntouched(deps.stateDir);
  });

  it("asks for confirmation when the old box wrote a change in the last ten minutes", async () => {
    const recent = new Date(NOW.getTime() - LIVE_WINDOW_MS + 60_000);
    const store = await bucket({ lastChangeAt: recent });
    await store.put(
      `${generationPrefix(T.locationId, GENERATION)}ltx/0/0000000000000002.ltx`,
      Uint8Array.from([2]),
    );
    const restore = vi.fn();
    const deps = await prepareDeps(store, { restoreGeneration: restore });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_source_live",
      params: { lastChangeAt: NOW.toISOString() },
    });
    expect(restore).not.toHaveBeenCalled();
    await expectStateUntouched(deps.stateDir);
  });

  it("goes ahead on a recent change once the operator confirms the old box is gone", async () => {
    const store = await bucket({ lastChangeAt: new Date(NOW.getTime() - 60_000) });
    const deps = await prepareDeps(store, { oldBoxGone: true });
    const prepared = await prepareStreamRestore(deps);
    // Confirmed: no probe is written to measure the bucket's clock.
    expect(store.calls.filter((c) => c.operation === "put")).toHaveLength(2);
    await prepared.discard();
  });

  // The ten minutes are measured on the bucket's clock, never this box's (plan Reconciliation N19).
  // The memory bucket stamps its own clock, NOW; this box's clock is moved half an hour either way.
  it.each([
    ["runs fast", 30 * 60_000],
    ["runs slow", -30 * 60_000],
  ])("still sees a change five minutes old when this box's clock %s", async (_how, offsetMs) => {
    const restore = vi.fn();
    const deps = await prepareDeps(
      await bucket({ lastChangeAt: new Date(NOW.getTime() - 5 * 60_000) }),
      { restoreGeneration: restore, now: () => new Date(NOW.getTime() + offsetMs) },
    );
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_source_live",
    });
    expect(restore).not.toHaveBeenCalled();
  });

  // The control in the other direction: uncorrected, a slow clock would call this change live.
  it("does not call a change twenty minutes old live when this box's clock runs slow", async () => {
    const deps = await prepareDeps(
      await bucket({ lastChangeAt: new Date(NOW.getTime() - 20 * 60_000) }),
      { now: () => new Date(NOW.getTime() - 30 * 60_000) },
    );
    const prepared = await prepareStreamRestore(deps);
    await prepared.discard();
  });

  it("asks for confirmation when the bucket's clock cannot be measured", async () => {
    const store = await bucket();
    store.failNext({ operation: "put", error: new Error("denied") });
    const restore = vi.fn();
    const deps = await prepareDeps(store, { restoreGeneration: restore });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_source_unchecked",
      params: { reason: "clock" },
    });
    expect(restore).not.toHaveBeenCalled();
    await expectStateUntouched(deps.stateDir);
    const confirmed = await prepareStreamRestore({
      ...deps,
      oldBoxGone: true,
      restoreGeneration: copyFixture,
    });
    await confirmed.discard();
  });

  it("a failed integrity check stops the restore before anything changes", async () => {
    const deps = await prepareDeps(await bucket(), {
      checkIntegrity: async () => [
        "*** in database main ***",
        "Page 7: btreeInitPage() returns error code 11",
      ],
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_integrity_failed",
    });
    await expectStateUntouched(deps.stateDir);
  });

  it("refuses the wrong recovery key", async () => {
    const deps = await prepareDeps(await bucket(), {
      kit: { ...KIT, recoveryKey: "a-different-key-entirely" },
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "recovery.passphrase_invalid",
    });
    await expectStateUntouched(deps.stateDir);
  });

  // Review Focus 2: the owner supplies the wrong kit. Each is refused before anything on the box
  // changes, naming what is wrong.
  it("refuses another venue's kit — no copy of that venue in this bucket — before downloading anything", async () => {
    const restore = vi.fn();
    const deps = await prepareDeps(await bucket(), {
      kit: { ...KIT, venueId: "c0000000-0000-4000-8000-0000000000ff" },
      restoreGeneration: restore,
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_pointer_missing",
    });
    expect(restore).not.toHaveBeenCalled();
    await expectStateUntouched(deps.stateDir);
  });

  it("refuses a kit whose signing key is another venue's, before downloading anything", async () => {
    const restore = vi.fn();
    const deps = await prepareDeps(await bucket(), {
      kit: { ...KIT, pointerSignerPublicKey: generateNodeKeyPair().publicKey },
      restoreGeneration: restore,
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_pointer_unverified",
      params: { reason: "signature" },
    });
    expect(restore).not.toHaveBeenCalled();
    await expectStateUntouched(deps.stateDir);
  });

  // Review Focus 5: the disk fills during the download.
  it("says the disk is full, removes the partial download and changes nothing", async () => {
    const deps = await prepareDeps(await bucket(), {
      restoreGeneration: async (args) => {
        await writeFile(`${args.outPath}.tmp`, "partial");
        throw new AppError("backup.stream_restore_failed", { exitCode: 1, diskFull: true });
      },
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_disk_full",
    });
    await expectStateUntouched(deps.stateDir);
  });

  it("passes any other download failure through as it came, and removes the partial download", async () => {
    const deps = await prepareDeps(await bucket(), {
      restoreGeneration: async (args) => {
        await writeFile(`${args.outPath}.tmp`, "partial");
        throw new AppError("backup.stream_restore_failed", { exitCode: 1, diskFull: false });
      },
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "backup.stream_restore_failed",
      params: { diskFull: false },
    });
    await expectStateUntouched(deps.stateDir);
  });

  // Litestream refuses to restore over a non-empty output file.
  it("downloads into an empty folder even when an interrupted restore left its copy behind", async () => {
    let seen: string[] | undefined;
    const deps = await prepareDeps(await bucket(), {
      restoreGeneration: async (args) => {
        seen = await readdir(dirname(args.outPath));
        await copyFile(fixtureDb, args.outPath);
      },
    });
    await mkdir(join(deps.stateDir, "stream-restore-cutshort"));
    await writeFile(
      join(deps.stateDir, "stream-restore-cutshort", "venue.db"),
      "from a restore cut short",
    );
    const prepared = await prepareStreamRestore(deps);
    expect(seen).toEqual([]);
    await prepared.discard();
  });

  it("gives each preparation its own scratch folder, so discarding one leaves another's copy", async () => {
    const deps = await prepareDeps(await bucket());
    const first = await prepareStreamRestore(deps);
    const second = await prepareStreamRestore(deps);
    expect(second.databasePath).not.toBe(first.databasePath);
    await first.discard();
    expect((await stat(second.databasePath)).isFile()).toBe(true);
    await second.discard();
    await expectStateUntouched(deps.stateDir);
  });

  it("reports a Litestream that cannot be started as a failed download, leaving nothing behind", async () => {
    const deps = await prepareDeps(await bucket(), {
      litestreamBin: join(tmpdir(), "waitron-no-such-litestream"),
      restoreGeneration: undefined,
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "backup.stream_restore_failed",
      params: { exitCode: null, diskFull: false },
    });
    await expectStateUntouched(deps.stateDir);
  });

  it("opens the kit's bucket itself when no store is given", async () => {
    const deps = await prepareDeps(createMemoryObjectStore(), {
      kit: { ...KIT, bucket: { ...KIT.bucket, endpoint: "http://127.0.0.1:1" } },
      openStore: undefined,
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "backup.stream_request_failed",
      params: { operation: "get", status: null },
    });
    await expectStateUntouched(deps.stateDir);
  }, 30_000);

  it("refuses a copy with no locked row for the pointer's node", async () => {
    const deps = await prepareDeps(await bucket(), {
      restoreGeneration: async (args) => {
        await copyFile(fixtureDb, args.outPath);
        const store = await openVenueDatabase(dirname(args.outPath));
        await store.venue.execute(sql`delete from node_sealed_state`);
        await store.close();
      },
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_state_missing",
      params: { nodeId: T.nodeId },
    });
    await expectStateUntouched(deps.stateDir);
  });

  it("refuses a copy from before the locked-row table existed as missing the row, not with a raw error", async () => {
    const deps = await prepareDeps(await bucket(), {
      restoreGeneration: async (args) => {
        await copyFile(fixtureDb, args.outPath);
        const store = await openVenueDatabase(dirname(args.outPath));
        await store.venue.execute(sql`drop table node_sealed_state`);
        await store.close();
      },
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "restore.stream_state_missing",
    });
    await expectStateUntouched(deps.stateDir);
  });

  it("refuses a copy whose migration record is ahead of this software, leaving the box as it was", async () => {
    const core = manifestSets().find((set) => set.name === "core")!;
    const unknown = "f".repeat(64);
    const deps = await prepareDeps(await bucket(), {
      restoreGeneration: async (args) => {
        await copyFile(fixtureDb, args.outPath);
        const store = await openVenueDatabase(dirname(args.outPath));
        await store.venue.execute(
          sql`insert into ${sql.identifier(core.table)} ("hash", "created_at")
              values (${unknown}, ${Number.MAX_SAFE_INTEGER})`,
        );
        await store.close();
      },
    });
    await expect(prepareStreamRestore(deps)).rejects.toMatchObject({
      code: "provisioning.database_ahead",
      params: { set: "core", unknownMigrations: [unknown] },
    });
    await expectStateUntouched(deps.stateDir);
  });

  it("names the kit venue's location, not the first one the copy holds", async () => {
    const deps = await prepareDeps(await bucket());
    const prepared = await prepareStreamRestore(deps);
    // The control: an unfiltered read of this copy would find the other location.
    const store = await openVenueDatabase(dirname(prepared.databasePath));
    try {
      const first = await store.venue.select({ name: locations.name }).from(locations).limit(1);
      expect(first).toEqual([{ name: "Another venue" }]);
    } finally {
      await store.close();
    }
    expect(prepared.venue.locationName).toBe(VENUE.locationName);
    await prepared.discard();
  });
});

describe("measureBucketSkew", () => {
  it("is the bucket's clock minus this box's, and leaves no probe behind", async () => {
    const store = createMemoryObjectStore({ now: () => NOW });
    const skew = await measureBucketSkew(store, () => new Date(NOW.getTime() - 90_000));
    expect(skew).toBe(90_000);
    expect(store.snapshot().size).toBe(0);
  });

  it("still answers when the probe cannot be deleted afterwards, leaving the probe behind", async () => {
    const store = createMemoryObjectStore({ now: () => NOW });
    store.failNext({ operation: "delete", error: new Error("denied") });
    expect(await measureBucketSkew(store, () => NOW)).toBe(0);
    expect(store.snapshot().size).toBe(1);
  });

  it("is null when the probe it wrote is not listed", async () => {
    const store = createMemoryObjectStore({ now: () => NOW });
    const hidden: ObjectStore = { ...store, list: async () => [] };
    expect(await measureBucketSkew(hidden, () => NOW)).toBeNull();
    expect(store.snapshot().size).toBe(0);
  });
});

describe("refuseIfSourceLive", () => {
  it("names the newest change, not the last one listed", async () => {
    let clock = NOW;
    const store = createMemoryObjectStore({ now: () => clock });
    const folder = generationPrefix(T.locationId, GENERATION);
    await store.put(`${folder}ltx/0/0000000000000001.ltx`, Uint8Array.from([1]));
    clock = new Date(NOW.getTime() - 30 * 60_000);
    await store.put(`${folder}ltx/0/0000000000000002.ltx`, Uint8Array.from([2]));
    clock = NOW;
    await expect(
      refuseIfSourceLive({
        store,
        venueId: T.locationId,
        generation: GENERATION,
        now: () => NOW,
        oldBoxGone: false,
      }),
    ).rejects.toMatchObject({
      code: "restore.stream_source_live",
      params: { lastChangeAt: NOW.toISOString() },
    });
  });

  it("goes ahead for a generation holding no change at all, without measuring the clock", async () => {
    const store = createMemoryObjectStore({ now: () => NOW });
    await refuseIfSourceLive({
      store,
      venueId: T.locationId,
      generation: GENERATION,
      now: () => NOW,
      oldBoxGone: false,
    });
    expect(store.calls.some((c) => c.operation === "put")).toBe(false);
  });
});

// Plan Reconciliation N23: an archive whose database holds bucket settings runs the same check.
describe("refuseIfArchiveSourceLive", () => {
  const VAULT_KEY = Buffer.alloc(32, 5).toString("base64");
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: VAULT_KEY,
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  const SECRETS_ENV = `WAITRON_CREDENTIALS_KEY=${VAULT_KEY}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`;

  /** An archive's validated pieces: the suite's database, with or without bucket settings. */
  async function archive(
    withSettings: boolean,
    secrets = true,
    settingsBucket: BucketConfig = KIT.bucket,
  ): Promise<ValidatedArtifact> {
    const file = join(await mkdtemp(join(tmpdir(), "waitron-archive-db-")), "venue.db");
    await suite.db.archiveTo(file);
    if (withSettings) {
      const store = await openVenueDatabase(dirname(file));
      try {
        await withTransaction(store.venue, (tx) =>
          putCredential(tx, ring, {
            purpose: STREAM_PURPOSE,
            value: streamSettingsPayload({ venueId: T.locationId, bucket: settingsBucket }),
          }),
        );
      } finally {
        await store.close();
      }
    }
    return {
      manifest: MANIFEST,
      dumpEntry: { name: "db.dump", bytes: await readFile(file) },
      secretEntries: secrets
        ? [{ name: "secrets/secrets.env", bytes: Buffer.from(SECRETS_ENV) }]
        : [],
    };
  }

  const args = async (
    validated: ValidatedArtifact,
    openStore: () => ObjectStore,
    oldBoxGone = false,
  ) => ({
    validated,
    stateDir: await mkdtemp(join(tmpdir(), "waitron-archive-state-")),
    oldBoxGone,
    now: () => NOW,
    openStore,
  });

  it("goes ahead without opening a bucket when the archive holds no bucket settings", async () => {
    const openStore = vi.fn();
    const a = await args(await archive(false), openStore);
    await refuseIfArchiveSourceLive(a);
    expect(openStore).not.toHaveBeenCalled();
    await expectStateUntouched(a.stateDir);
  });

  it("goes ahead without reading anything when the archive carries no vault key", async () => {
    const openStore = vi.fn();
    const a = await args(await archive(true, false), openStore);
    await refuseIfArchiveSourceLive(a);
    expect(openStore).not.toHaveBeenCalled();
    await expectStateUntouched(a.stateDir);
  });

  it("refuses when the bucket named in the archive's settings changed in the last ten minutes", async () => {
    const store = await bucket({ lastChangeAt: new Date(NOW.getTime() - 2 * 60_000) });
    const opened: unknown[] = [];
    const a = await args(await archive(true), () => store);
    await expect(
      refuseIfArchiveSourceLive({
        ...a,
        openStore: (b) => {
          opened.push(b);
          return store;
        },
      }),
    ).rejects.toMatchObject({ code: "restore.stream_source_live" });
    expect(opened).toEqual([KIT.bucket]);
    await expectStateUntouched(a.stateDir);
    await refuseIfArchiveSourceLive({ ...a, oldBoxGone: true });
    await expectStateUntouched(a.stateDir);
  });

  it("goes ahead when the bucket named in the archive's settings is quiet", async () => {
    const store = await bucket();
    const a = await args(await archive(true), () => store);
    await refuseIfArchiveSourceLive(a);
    await expectStateUntouched(a.stateDir);
  });

  it("goes ahead when the bucket named in the archive's settings holds no pointer", async () => {
    const a = await args(await archive(true), () => createMemoryObjectStore());
    await refuseIfArchiveSourceLive(a);
    await expectStateUntouched(a.stateDir);
  });

  it("opens the settings' bucket itself when no store is given, and one that cannot be reached asks for confirmation", async () => {
    const unreachable = { ...KIT.bucket, endpoint: "http://127.0.0.1:1" };
    const a = await args(await archive(true, true, unreachable), () => {
      throw new Error("unused");
    });
    await expect(refuseIfArchiveSourceLive({ ...a, openStore: undefined })).rejects.toMatchObject({
      code: "restore.stream_source_unchecked",
      params: { reason: "bucket" },
    });
    await expectStateUntouched(a.stateDir);
  }, 30_000);

  it("asks for confirmation when the bucket named in the archive's settings gives no answer", async () => {
    const silent = createMemoryObjectStore();
    silent.failNext({
      operation: "get",
      error: new AppError("backup.stream_request_failed", {
        operation: "get",
        key: pointerKey(T.locationId),
        status: null,
        name: "TimeoutError",
      }),
    });
    const a = await args(await archive(true), () => silent);
    await expect(refuseIfArchiveSourceLive(a)).rejects.toMatchObject({
      code: "restore.stream_source_unchecked",
      params: { reason: "bucket" },
    });
    await expectStateUntouched(a.stateDir);
  });

  it("asks for confirmation when the bucket answers for the pointer but not for the generation's listing", async () => {
    const store = await bucket();
    store.failNext({
      operation: "list",
      error: new AppError("backup.stream_request_failed", {
        operation: "list",
        key: generationPrefix(T.locationId, GENERATION),
        status: 503,
        name: "ServiceUnavailable",
      }),
    });
    const a = await args(await archive(true), () => store);
    await expect(refuseIfArchiveSourceLive(a)).rejects.toMatchObject({
      code: "restore.stream_source_unchecked",
      params: { reason: "bucket" },
    });
    await expectStateUntouched(a.stateDir);
  });

  it("passes the clock's own refusal through as it came", async () => {
    const store = await bucket({ lastChangeAt: new Date(NOW.getTime() - 2 * 60_000) });
    store.failNext({ operation: "put", error: new Error("denied") });
    const a = await args(await archive(true), () => store);
    await expect(refuseIfArchiveSourceLive(a)).rejects.toMatchObject({
      code: "restore.stream_source_unchecked",
      params: { reason: "clock" },
    });
    await expectStateUntouched(a.stateDir);
  });
});

describe("checkIntegrity", () => {
  it("passes a healthy venue file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-integrity-"));
    await copyFile(fixtureDb, join(dir, "venue.db"));
    expect(await checkIntegrity(dir)).toEqual([]);
  });

  it("fails a file that is not a database, without throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-integrity-"));
    await writeFile(join(dir, "venue.db"), Buffer.alloc(8192, 0x5a));
    expect(await checkIntegrity(dir)).toEqual([
      "the file could not be opened or read as a database",
    ]);
  });

  it("reports what SQLite's check finds in a database that opens but is damaged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-integrity-"));
    const file = join(dir, "venue.db");
    await copyFile(fixtureDb, file);
    const db = new DatabaseSync(file);
    let root: number;
    let pageSize: number;
    try {
      db.exec("create table damaged (a text); create index damaged_a on damaged (a)");
      for (let i = 0; i < 20; i++) db.prepare("insert into damaged values (?)").run(`row${i}`);
      root = Number(
        (
          db.prepare("select rootpage from sqlite_master where name = 'damaged_a'").get() as {
            rootpage: number;
          }
        ).rootpage,
      );
      pageSize = Number((db.prepare("pragma page_size").get() as { page_size: number }).page_size);
    } finally {
      db.close();
    }
    // The index's one page is overwritten past its header: the file still opens, and only a full
    // check reads that page.
    const bytes = await readFile(file);
    bytes.fill(0x5a, (root - 1) * pageSize + 8, root * pageSize);
    await writeFile(file, bytes);
    const problems = await checkIntegrity(dir);
    expect(problems.some((line) => /missing from index damaged_a/.test(line))).toBe(true);
  });
});

describe("restoreFromStream (the command line's whole path)", () => {
  it("a failed integrity check leaves the box's own database and identity exactly as they were", async () => {
    const venueDir = await mkdtemp(join(tmpdir(), "waitron-stream-venue-"));
    await writeFile(join(venueDir, "venue.db"), "the box's own database");
    const deps = await prepareDeps(await bucket(), { checkIntegrity: async () => ["corrupt"] });
    await writeFile(join(deps.stateDir, "trading.env"), "WAITRON_TILL_NODE_ID=someone-else\n");
    await expect(
      restoreFromStream({
        ...deps,
        venueDir,
        stagingDir: join(deps.stateDir, "restore-staging"),
        environment: "preproduction",
        modules: [],
        confirmVenue: () => true,
      }),
    ).rejects.toMatchObject({ code: "restore.stream_integrity_failed" });
    expect(await readFile(join(venueDir, "venue.db"), "utf8")).toBe("the box's own database");
    expect(await readFile(join(deps.stateDir, "trading.env"), "utf8")).toBe(
      "WAITRON_TILL_NODE_ID=someone-else\n",
    );
    expect(await readdir(deps.stateDir)).toEqual(["trading.env"]);
  });

  it("places the restored database, writes the identity and leaves the first-start marker naming the stream", async () => {
    const venueDir = await mkdtemp(join(tmpdir(), "waitron-stream-venue-"));
    const deps = await prepareDeps(await bucket());
    await restoreFromStream({
      ...deps,
      venueDir,
      stagingDir: join(deps.stateDir, "restore-staging"),
      environment: "preproduction",
      modules: [],
      migrate: vi.fn(async () => {}),
      openDb: async () => ({ db: suite.db, close: async () => {} }),
      confirmVenue: () => true,
    });
    const placed = await openVenueDatabase(venueDir);
    try {
      const rows = await placed.venue.execute<{ taxId: string }>(
        sql`select tax_id as "taxId" from tenants`,
      );
      expect(rows.rows).toEqual([{ taxId: VENUE.taxId }]);
    } finally {
      await placed.close();
    }
    expect(await readFile(join(deps.stateDir, "trading.env"), "utf8")).toContain(T.nodeId);
    expect(JSON.parse(await readFile(join(deps.stateDir, REBUILD_MARKER), "utf8"))).toEqual({
      version: 1,
      source: "stream",
    });
    expect(
      (await readdir(deps.stateDir)).filter((name) => name.startsWith("stream-restore")),
    ).toEqual([]);
  });

  // Plan Reconciliation N26: the operator sees whose copy this is before anything changes.
  it("shows the restored venue and changes nothing when the operator does not confirm it", async () => {
    const venueDir = await mkdtemp(join(tmpdir(), "waitron-stream-venue-"));
    await writeFile(join(venueDir, "venue.db"), "the box's own database");
    const deps = await prepareDeps(await bucket());
    const seen: unknown[] = [];
    await expect(
      restoreFromStream({
        ...deps,
        venueDir,
        stagingDir: join(deps.stateDir, "restore-staging"),
        environment: "preproduction",
        modules: [],
        confirmVenue: (venue) => {
          seen.push(venue);
          return false;
        },
      }),
    ).rejects.toMatchObject({ code: "restore.stream_venue_unconfirmed", params: VENUE });
    expect(seen).toEqual([VENUE]);
    expect(await readFile(join(venueDir, "venue.db"), "utf8")).toBe("the box's own database");
    await expectStateUntouched(deps.stateDir);
  });
});
