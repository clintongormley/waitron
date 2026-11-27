import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import {
  invoiceSeries,
  nextInvoiceNumberOf,
  nodes,
  openVenueDatabase,
  sales,
  settings,
  stampDeployment,
  taxpayer,
  withTransaction,
  type Database,
} from "@waitron/db";
import { seedBusinessDay, seedDevice, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  readChainHead as readFiscalChainHead,
  verifactuIdentities,
  verifactuRecords,
} from "@waitron/fiscal-verifactu";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { hashPin } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError, decodeMasterKeyCode, jobOrigin, nodeId } from "@waitron/shared";
import * as stream from "@waitron/stream";
import type { S3ObjectStore } from "@waitron/stream";
import { FakeLitestream } from "@waitron/stream/testing/fake-litestream.js";
import { SwitchableStore } from "@waitron/stream/testing/switchable-store.js";
import { appendToChain, readChain, readChainHead } from "@waitron/workforce";
import { seedModuleSettings } from "../test/module-settings.js";
import {
  assembleArchiveEntries,
  collectStateParts,
  snapshotNodeDatabase,
} from "./archive-entries.js";
import { packArchive } from "./backup-archive.js";
import { buildManifest } from "./backup-manifest.js";
import { startServer } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import { restoreFromArtifactFile, type RestoreFileDeps } from "./restore.js";
import { runRestore } from "./restore-command.js";
import { readStreamSettings, writeStreamSettings } from "./stream-host.js";
import { HELD_MASTER_KEY_DAY } from "./testing/backup-key.js";
import { mintMasterKey, WRONG_MASTER_KEY } from "./testing/master-key.js";
import { masterKeyArchiveBytes } from "./testing/master-key-archive.js";
import { nodeDumpEntry } from "./testing/node-copy.js";
import {
  retainHttpListener,
  startWithRetainedListeners,
} from "./testing/retained-http-listener.js";
import { bootEnv, boxDirs, copyMigrations } from "./testing/stream-box.js";
import { holdVenueElsewhere } from "./testing/venue-held-elsewhere.js";

const RECOVERY_KEY = "s3cr3t-recovery-key-value";
const SECRET_ACCESS_KEY = "synthetic-secret-access-key-value";
const COLD_RESTORE_NOTICE =
  "cold restore: use only when no peer (mirror or local secondary) survived — a survivor holds more history and is promoted, not overwritten";

describe("waitron-restore restore <file>, end to end", () => {
  const VAULT_KEY = Buffer.alloc(32, 5).toString("base64");
  const HUELLA = "A".repeat(64);
  const DAMAGED_LINE =
    "restore failed: the backup file is damaged, or was changed after it was made; choose another backup";
  const DISK_FULL_LINE =
    "restore failed: the disk filled during the restore; free some space and run it again";
  const IN_USE_LINE =
    "restore failed: provisioning.database_in_use — another process, usually the Waitron server, is using this venue folder; stop it first (docker compose stop app)";
  const ids = {
    node: "a5380000-0000-4000-8000-000000000002",
    series: "a5380000-0000-4000-8000-000000000003",
    sif: "a5380000-0000-4000-8000-000000000004",
    sale: "a5380000-0000-4000-8000-000000000005",
  };
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    resetPerTest: false,
    timeoutMs: 120_000,
  });

  let scratch: string;
  let artifactBytes: Buffer;
  let personId: string;
  let masterKey: string;
  let masterKeyName: string;
  /** Every line any case printed, read once at the end for secrets. */
  const printed: string[] = [];

  function sealed(plaintext: Uint8Array): Buffer {
    return masterKeyArchiveBytes(plaintext, decodeMasterKeyCode(masterKey));
  }

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "restore-command-file-"));
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(taxpayer)
        .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Archive source" });
      await seedVenueSettings(tx, { name: "Archive venue", invoiceLocales: ["es"] });
      await seedBusinessDay(tx, {});
      await tx.insert(nodes).values({ id: ids.node, name: "Archive node" });
      await tx.insert(invoiceSeries).values({
        id: ids.series,
        nodeId: ids.node,
        code: "FA",
        purpose: "standard",
      });
      await tx
        .insert(invoiceSeries)
        .values({ nodeId: ids.node, code: "RE", purpose: "corrective" });
      await tx.insert(invoiceSeries).values({ nodeId: ids.node, code: "FF", purpose: "full" });
      await tx.insert(verifactuIdentities).values({
        id: ids.sif,
        nodeId: ids.node,
        nif: "89890001K",
        idSistemaInformatico: "W1",
        numeroInstalacion: "1",
      });
      const [person] = await seedPersons(tx, { displayName: "Anna", pinHash: hashPin("1234") });
      personId = person!.id;
    });
    await stampDeployment(suite.db, "preproduction");
    ({ secret: masterKey, name: masterKeyName } = await mintMasterKey(suite.db, {
      madeAt: new Date(`${HELD_MASTER_KEY_DAY}T12:00:00Z`),
    }));
    await seedFiscalRecord(suite.db);
    for (const at of ["2026-10-01T09:00:00Z", "2026-10-01T13:00:00Z"]) {
      await suite.db.transaction((tx) =>
        appendToChain(
          tx,
          { nodeId: ids.node },
          {
            personId,
            entryKind: at.endsWith("09:00:00Z") ? "in" : "out",
            eventAt: at,
            eventOffsetMinutes: 0,
            recordedByPersonId: personId,
            origin: jobOrigin("dashboard"),
          },
        ),
      );
    }
    const database = join(scratch, "source.db");
    await suite.db.archiveTo(database);
    const manifest = await buildManifest({
      db: suite.db,
      node: suite.node,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date("2026-10-01T03:00:00Z"),
    });
    artifactBytes = sealed(
      packArchive([
        { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
        { name: "db.dump", bytes: await readFile(database) },
        await nodeDumpEntry(suite.node, scratch),
        { name: "secrets/trading.env", bytes: Buffer.from(`WAITRON_NODE_ID=${ids.node}\n`) },
        {
          name: "secrets/secrets.env",
          bytes: Buffer.from(
            `WAITRON_CREDENTIALS_KEY=${VAULT_KEY}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`,
          ),
        },
      ]),
    );
  }, 120_000);

  afterAll(async () => {
    for (const line of printed) {
      expect(line).not.toContain(masterKey);
      expect(line).not.toContain(SECRET_ACCESS_KEY);
      expect(line).not.toContain(RECOVERY_KEY);
    }
    await rm(scratch, { recursive: true, force: true });
  });

  /** One filed sale, as `restore-fiscal-e2e.test.ts` seeds them. */
  async function seedFiscalRecord(db: Database): Promise<void> {
    await seedDevice(db, {});
    const device = sql`(select id from devices)`;
    await db.insert(sales).values({
      id: ids.sale,
      source: "device",
      deviceId: device,
      nodeId: ids.node,
      seriesId: ids.series,
      invoiceNumber: 4,
      issuedAt: "2026-07-20T19:20:30+01:00",
      issuedOffsetMinutes: 60,
      total: 0,
      vatBreakdown: [],
      locale: "es",
      invoiceLocales: ["es"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
    });
    await db.insert(verifactuRecords).values({
      source: "device",
      deviceId: device,
      nodeId: ids.node,
      sifId: ids.sif,
      saleId: ids.sale,
      secuencia: 1,
      tipoRegistro: "alta",
      idEmisorFactura: "89890001K",
      numSerieFactura: "FA/4",
      fechaExpedicionFactura: "2026-07-20",
      nombreRazonEmisor: "Archive source",
      tipoFactura: "F2",
      descripcionOperacion: "Venta",
      desglose: [],
      cuotaTotal: "12.35",
      importeTotal: "123.45",
      primerRegistro: true,
      sistemaInformatico: {},
      fechaHoraHusoGenRegistro: new Date("2026-07-20T19:20:30+01:00"),
      offsetMinutos: 60,
      tipoHuella: "01",
      huella: HUELLA,
    });
  }

  async function chainHead(db: Database) {
    const { ultimaHuella, secuencia } = await withTransaction(db, (tx) =>
      readFiscalChainHead(tx, nodeId(ids.node)),
    );
    return { ultimaHuella, secuencia };
  }

  async function seriesOfNode(
    db: Database,
  ): Promise<{ code: string; retired: boolean; next: number }[]> {
    const rows = await db
      .select({
        code: invoiceSeries.code,
        retiredAt: invoiceSeries.retiredAt,
        next: nextInvoiceNumberOf(invoiceSeries.id),
      })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.nodeId, ids.node))
      .orderBy(invoiceSeries.code);
    return rows.map(({ code, retiredAt, next }) => ({ code, retired: retiredAt !== null, next }));
  }

  interface Fixture {
    root: string;
    stateDir: string;
    venueDir: string;
    artifactPath: string;
  }

  let current: Fixture | undefined;

  afterEach(async () => {
    if (current === undefined) return;
    const leftovers = await readdir(join(current.stateDir, "scratch/restore")).catch(() => []);
    expect(leftovers).toEqual([]);
    current = undefined;
  });

  async function fixture(): Promise<Fixture> {
    const root = await mkdtemp(join(scratch, "case-"));
    const f: Fixture = {
      root,
      stateDir: join(root, "state"),
      venueDir: join(root, "venue"),
      artifactPath: join(root, "backup.enc"),
    };
    await mkdir(f.stateDir);
    await writeFile(f.artifactPath, artifactBytes);
    current = f;
    return f;
  }

  /** A live venue at `venueDir`, told apart from the backup by its legal name. */
  async function liveVenue(f: Fixture): Promise<void> {
    await mkdir(f.venueDir);
    await suite.db.archiveTo(join(f.venueDir, "venue.db"));
    const live = await openVenueDatabase(f.venueDir);
    try {
      await live.venue.update(taxpayer).set({ legalName: "Live venue" });
    } finally {
      await live.close();
    }
  }

  async function venueFiles(f: Fixture): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    for (const name of (await readdir(f.venueDir)).sort()) {
      const path = join(f.venueDir, name);
      if ((await stat(path)).isFile()) files[name] = (await readFile(path)).toString("base64");
    }
    return files;
  }

  async function legalName(venueDir: string): Promise<string> {
    const opened = await openVenueDatabase(venueDir);
    try {
      return (await opened.venue.select().from(taxpayer))[0]!.legalName;
    } finally {
      await opened.close();
    }
  }

  async function run(
    f: Fixture,
    args: string[] = [],
    overrides: Partial<Parameters<typeof runRestore>[0]> = {},
  ): Promise<{ code: number; out: string[] }> {
    const out: string[] = [];
    const allocation = allocationFixture({
      node: { nodeId: nodeId(ids.node) },
      taxpayerNif: "89890001K",
      identity: "P000042",
      recoveryKey: true,
      bases: [
        { code: "FA", purpose: "standard" },
        { code: "FF", purpose: "full" },
        { code: "RE", purpose: "corrective" },
      ],
    });
    const held = allocation.request("restore");
    const modules = ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: held.preparation } : module,
    );
    const code = await runRestore({
      withModuleOperations: createRecoveryRestoreRunner(
        modules,
        { binding: held.binding, input: held.input },
        masterKey,
      ),
      argv: ["restore", f.artifactPath, ...args],
      env: {
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_MASTER_KEY: masterKey,
      },
      out: (line) => {
        out.push(line);
        printed.push(line);
      },
      restore: (deps: RestoreFileDeps) =>
        restoreFromArtifactFile({ ...deps, migrationsRoot: null }),
      ...overrides,
    });
    return { code, out };
  }

  it("keeps the replacement mark through a failed restore, and the restored box publishes with the backup's node key and stops when a later replacement publishes", async () => {
    const f = await fixture();
    const bucketConfig = {
      region: "eu-west-1",
      bucket: "owner-bucket",
      prefix: "waitron",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: SECRET_ACCESS_KEY,
    };
    const original = await boxDirs(f.root, "original");
    await suite.db.archiveTo(join(original.venue, "venue.db"));
    await suite.node.archiveTo(join(original.venue, "node.db"));
    await ensureBoxSecrets({
      stateDir: original.state,
      hostnames: ["localhost"],
      now: () => new Date(),
    });
    await writeFile(join(original.state, "trading.env"), `WAITRON_NODE_ID=${ids.node}\n`);
    await writeFile(
      join(original.state, "backup.env"),
      `WAITRON_BACKUP_RECOVERY_KEY=${RECOVERY_KEY}\n`,
    );
    const env = await loadBoxEnv({}, original.state);
    const ring = loadKeyRing(env);
    let signingKey: string;
    let streamId: string;
    const source = await openVenueDatabase(original.venue);
    try {
      await establishNodeIdentity({ ownerDb: source.venue, node: source.node, ring }, ids.node);
      signingKey = await readNodeIdentityKey(source.node, ring, ids.node);
      await seedTermZeroMembership(
        { db: source.venue, node: source.node, ring },
        ids.node,
        "https://old.example",
      );
      await seedModuleSettings(source.venue, { "fiscal-none": false });
      await withTransaction(source.venue, (tx) =>
        writeStreamSettings(tx, ring, bucketConfig, null),
      );
      streamId = (await readStreamSettings(source.venue, ring))!.streamId;
      await source.venue.archiveTo(join(f.root, "stream-source.db"));
      const manifest = await buildManifest({
        db: source.venue,
        node: source.node,
        modules: ALL_MODULES,
        environment: "preproduction",
        now: new Date("2026-10-01T03:00:00Z"),
      });
      const parts = await collectStateParts({
        stateDir: original.state,
        modules: ALL_MODULES,
        resolvers: {},
        snapshotNode: snapshotNodeDatabase(source.node, f.root),
      });
      const entries = assembleArchiveEntries(
        manifest,
        await readFile(join(f.root, "stream-source.db")),
        parts,
      );
      await writeFile(f.artifactPath, sealed(packArchive(entries)));
    } finally {
      await source.close();
    }

    const replacementMark = join(f.stateDir, "replaced.json");
    const mark = JSON.stringify({ streamId, nodeId: ids.node, term: 1 });
    await writeFile(replacementMark, mark);
    const refused = await run(f, ["--confirm-old-box-gone"], {
      restore: (deps) =>
        restoreFromArtifactFile({
          ...deps,
          migrationsRoot: null,
          beforeDatabaseMove: async () => {
            throw new AppError("storage.disk_full", {});
          },
        }),
    });
    expect(refused.code).toBe(1);
    expect(await readFile(replacementMark, "utf8")).toBe(mark);
    const restored = await run(f, ["--confirm-old-box-gone"]);
    expect(restored.code, restored.out.join("\n")).toBe(0);
    await expect(stat(replacementMark)).rejects.toMatchObject({ code: "ENOENT" });
    const bucket = Object.assign(new SwitchableStore(() => new Date()), {
      listFolders: async () => [],
    }) satisfies S3ObjectStore;
    const open = vi.spyOn(stream, "createS3FolderStore").mockReturnValue(bucket);
    const litestream = new FakeLitestream();
    const restart = vi.fn();
    const listener = await retainHttpListener();
    try {
      const migrations = await copyMigrations(f.root);
      const startup = await loadBoxEnv(
        bootEnv({ state: f.stateDir, venue: f.venueDir }, listener.port, migrations, "litestream"),
        f.stateDir,
      );
      const server = await startWithRetainedListeners([listener], () =>
        startServer(
          startup,
          {},
          { stream: { store: bucket, spawn: litestream.spawn, mainCheckIntervalMs: 5 }, restart },
        ),
      );
      try {
        await vi.waitFor(() => expect(litestream.running()).toBeDefined(), { timeout: 5_000 });
        const [claim] = await bucket.list("gen-");
        const generation = claim!.key.split("/")[0]!;
        bucket.upload(`${generation}/0000/0000000000000001-0000000000000001.ltx`);
        await vi.waitFor(
          async () => {
            const stored = await stream.readPointer(bucket, streamId);
            expect(stored?.pointer.body).toMatchObject({ nodeId: ids.node, term: 1, streamId });
          },
          { timeout: 10_000 },
        );
        const pointer = (await stream.readPointer(bucket, streamId))!.pointer;
        expect(stream.verifyPointer(pointer, nodeSigningPublicKey(signingKey))).toBe(true);
        expect(stream.verifyPointer(pointer, generateNodeKeyPair().publicKey)).toBe(false);
        const next = stream.signPointer(
          {
            ...pointer.body,
            term: 2,
            generation: `gen-2-${ids.node}-20261002T030000Z`,
          },
          signingKey,
        );
        await bucket.put(stream.pointerKey(), new TextEncoder().encode(JSON.stringify(next)));
        await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce(), { timeout: 5_000 });
        expect(JSON.parse(await readFile(replacementMark, "utf8"))).toEqual({
          streamId,
          nodeId: ids.node,
          term: 2,
        });
      } finally {
        await server.close();
      }
    } finally {
      open.mockRestore();
      if (listener.server.listening) await listener.close();
    }
  }, 60_000);

  it("restores a backup file of a venue that never streamed, with no kit anywhere", async () => {
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: VAULT_KEY,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    expect(await readStreamSettings(suite.db, ring)).toBeNull();
    const expectedTaxpayers = await suite.db.select().from(taxpayer);
    const expectedSettings = await suite.db.select().from(settings).orderBy(settings.module);
    const chainKey = { nodeId: ids.node };
    const expectedChain = await readChain(suite.db, chainKey);
    const expectedHead = await suite.db.transaction((tx) => readChainHead(tx, chainKey));
    expect(expectedChain.map((e) => e.sequenceNo)).toEqual([1, 2]);
    expect(await chainHead(suite.db)).toEqual({ ultimaHuella: HUELLA, secuencia: 1 });
    expect(await seriesOfNode(suite.db)).toEqual([
      { code: "FA", retired: false, next: 5 },
      { code: "FF", retired: false, next: 1 },
      { code: "RE", retired: false, next: 1 },
    ]);

    const f = await fixture();
    const { code, out } = await run(f);
    expect(code).toBe(0);
    expect(out[0]).toBe(COLD_RESTORE_NOTICE);
    expect(out.at(-1)).toBe(`restored ${f.artifactPath}`);

    const restored = await openVenueDatabase(f.venueDir);
    try {
      const db = restored.venue;
      expect(await db.select().from(taxpayer)).toEqual(expectedTaxpayers);
      expect(await db.select().from(settings).orderBy(settings.module)).toEqual(expectedSettings);
      const sifs = await db
        .select({
          numeroInstalacion: verifactuIdentities.numeroInstalacion,
          revocadoEn: verifactuIdentities.revocadoEn,
        })
        .from(verifactuIdentities)
        .where(eq(verifactuIdentities.nodeId, ids.node))
        .orderBy(verifactuIdentities.registradoEn);
      expect(sifs).toHaveLength(2);
      expect(sifs[0]).toMatchObject({ numeroInstalacion: "1" });
      expect(sifs[0]?.revocadoEn).not.toBeNull();
      expect(sifs[1]?.revocadoEn).toBeNull();
      expect(sifs[1]!.numeroInstalacion).toBe("P000042");
      expect(sifs[1]!.numeroInstalacion).not.toBe(sifs[0]!.numeroInstalacion);
      const n = sifs[1]!.numeroInstalacion;
      expect(await chainHead(db)).toEqual({ ultimaHuella: null, secuencia: 1 });
      expect(await seriesOfNode(db)).toEqual([
        { code: "FA", retired: true, next: 5 },
        { code: `FA-${n}`, retired: false, next: 1 },
        { code: "FF", retired: true, next: 1 },
        { code: `FF-${n}`, retired: false, next: 1 },
        { code: "RE", retired: true, next: 1 },
        { code: `RE-${n}`, retired: false, next: 1 },
      ]);
      // The working-time chain continues from the backup's head.
      expect(await readChain(db, chainKey)).toEqual(expectedChain);
      expect(await db.transaction((tx) => readChainHead(tx, chainKey))).toEqual(expectedHead);
      const appended = await db.transaction((tx) =>
        appendToChain(tx, chainKey, {
          personId,
          entryKind: "in",
          eventAt: "2026-10-02T09:00:00Z",
          eventOffsetMinutes: 0,
          recordedByPersonId: personId,
          origin: jobOrigin("dashboard"),
        }),
      );
      expect(appended.sequenceNo).toBe(3);
    } finally {
      await restored.close();
    }
  });

  it("says the disk filled when the restore runs out of space, without a path, and leaves the live venue unchanged", async () => {
    const f = await fixture();
    await liveVenue(f);
    const before = await venueFiles(f);
    const { code, out } = await run(f, ["--confirm-old-box-gone"], {
      restore: (deps) =>
        restoreFromArtifactFile({
          ...deps,
          migrationsRoot: null,
          beforeDatabaseMove: async () => {
            const target = join(deps.venueDir, "venue.db");
            throw Object.assign(new Error(`ENOSPC: no space left on device, write '${target}'`), {
              code: "ENOSPC",
            });
          },
        }),
    });
    expect({ code, last: out.at(-1) }).toEqual({ code: 1, last: DISK_FULL_LINE });
    expect(out.join("\n")).not.toContain(f.root);
    expect(await venueFiles(f)).toEqual(before);
    expect(await legalName(f.venueDir)).toBe("Live venue");
  });

  it("is refused while another process holds the venue folder, and leaves the live venue unchanged", async () => {
    const f = await fixture();
    await liveVenue(f);
    const restore = vi.fn((deps: RestoreFileDeps) =>
      restoreFromArtifactFile({ ...deps, migrationsRoot: null }),
    );
    const holder = await holdVenueElsewhere(f.venueDir);
    let before: Record<string, string>;
    let after: Record<string, string>;
    let result: { code: number; out: string[] };
    try {
      before = await venueFiles(f);
      result = await run(f, ["--confirm-old-box-gone"], { restore });
      after = await venueFiles(f);
    } finally {
      await holder.stop();
    }
    expect({ code: result.code, last: result.out.at(-1) }).toEqual({
      code: 1,
      last: IN_USE_LINE,
    });
    expect(restore).not.toHaveBeenCalled();
    expect(after).toEqual(before);
    expect(await legalName(f.venueDir)).toBe("Live venue");
  });

  it.each<[string, (f: Fixture) => Promise<NodeJS.ProcessEnv>, () => string]>([
    [
      "a file given another master key",
      async () => ({ WAITRON_MASTER_KEY: WRONG_MASTER_KEY }),
      () =>
        `restore failed: promotion.break_glass_invalid — wrong master key; use the one dated ${masterKeyName}`,
    ],
    [
      "a file with a byte changed",
      async (f) => {
        const bytes = Buffer.from(artifactBytes);
        bytes[bytes.length - 20]! ^= 1;
        await writeFile(f.artifactPath, bytes);
        return {};
      },
      () => DAMAGED_LINE,
    ],
  ])("refuses %s and leaves the live venue unchanged", async (_label, arrange, line) => {
    const f = await fixture();
    const env = await arrange(f);
    await liveVenue(f);
    const before = await venueFiles(f);
    const { code, out } = await run(f, ["--confirm-old-box-gone"], {
      env: {
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_MASTER_KEY: masterKey,
        ...env,
      },
    });
    expect(code).toBe(1);
    expect(out.at(-1)).toBe(line());
    expect(await venueFiles(f)).toEqual(before);
    expect(await legalName(f.venueDir)).toBe("Live venue");
  });
});
