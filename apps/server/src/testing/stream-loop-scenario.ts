// The stream loop, end to end, against whichever bucket its fixture names: box A streams its
// venue, dies, box B is rebuilt with its kit, saved node key and signed allocation, sells under a fresh
// installation number and chain, streams into a generation of its own and moves the pointer, and a
// restore of B's generation holds exactly what B's database holds. `stream-loop.e2e.test.ts` runs it
// against versitygw; `aws-stream-loop.aws-rehearsal.test.ts` against Amazon S3, by opt-in only.
import { X509Certificate } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { connect as tlsConnect } from "node:tls";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  nodeSealedState,
  nodes,
  openVenueDatabase,
  readStandardSeriesId,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import {
  createPaperAllocationPreparation,
  registroSif,
  registrosFacturacion,
} from "@waitron/fiscal-verifactu";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { locationId, nodeId } from "@waitron/shared";
import { planVenue, quoteIdent } from "@waitron/provisioning";
import { mintBreakGlassSecret } from "../break-glass.js";
import {
  createRecoveryRestoreRunner,
  readRecoveryOperationFile,
} from "../recovery-module-operation.js";
import { writeAllocationInput } from "./allocation-input.js";
import {
  createS3ObjectStore,
  encodeRecoveryKit,
  probeBucket,
  readPointer,
  restoreGeneration,
  venuePrefix,
  verifyPointer,
  type BucketConfig,
  type ObjectStore,
} from "@waitron/stream";
import { recordOneSale } from "../../scripts/record-one-sale.js";
import { startServer, type StartedServer } from "../boot.js";
import { loadBoxEnv } from "../box-env.js";
import { ensureBoxSecrets } from "../box-secrets.js";
import { formatEnvFile, parseEnvFile } from "../env-file.js";
import { seedTermZeroMembership } from "../membership-seed.js";
import { ALL_MODULES } from "../modules.js";
import { establishNodeIdentity } from "../node-identity.js";
import { runRestore } from "../restore-command.js";
import { unsealNodeState } from "../sealed-state.js";
import { streamSettingsPayload } from "../stream-host.js";
import { freePort } from "./free-ports.js";
import { stageClock, waitUntil } from "./scenario-stages.js";

const RECOVERY_KEY = "stream-loop-e2e-recovery-key";
const LOCALE = "es-ES";

// `waitFor` checks each POINTER and UPLOAD wait's deadline between probes, and each restore passes
// RESTORE_MS as `restoreGeneration`'s ceiling, which it checks every five seconds.
// BOOT_MS and REBUILD_MS are budgets nothing here enforces. A caller's timeout adds this sum, which
// includes UNTIMED_MS for migrations, provisioning and closes, because Vitest's timer fails a healthy
// run that outlasts it (CLAUDE.md §4). An upload wait restores the generation once per poll, so it
// also gets one restore's worth on top.
const POINTER_WAIT_MS = 30_000;
const UPLOAD_WAIT_MS = 30_000;
/** Sales timed with the transport up, and again with it frozen (stage 8b). */
const TIMED_SALES = 10;
const RESTORE_MS = 30_000;
const REBUILD_MS = 120_000;
const BOOT_MS = 30_000;
const UNTIMED_MS = 60_000;
const POLL_MS = 500;
export const STREAM_LOOP_SCENARIO_MS =
  2 * BOOT_MS +
  3 * POINTER_WAIT_MS +
  3 * (UPLOAD_WAIT_MS + RESTORE_MS) +
  // Stage 8b: the two-second pause, and 2 × TIMED_SALES sales at the 1,000 ms bound each at worst.
  2_000 +
  2 * TIMED_SALES * 1_000 +
  REBUILD_MS +
  RESTORE_MS +
  UNTIMED_MS;

export const STREAM_LOOP_PHASES = [
  "probe",
  "pointer-a",
  "sale-a",
  "rebuild",
  "pointer-b",
  "sale-b",
  "frozen-transport",
  "restore-compare",
] as const;
export type StreamLoopPhase = (typeof STREAM_LOOP_PHASES)[number];

export interface StreamLoopEvent {
  phase: StreamLoopPhase;
  outcome: "ok" | "failed" | "skipped";
  elapsedMs: number;
}

export interface StreamLoopFixture {
  bucket: BucketConfig;
  /** An existing folder the scenario may fill; the caller removes it. */
  scratch: string;
  litestreamBin: string;
  /**
   * Aborting it closes whichever of the two servers is running, at once, and ends the scenario at its
   * next wait or stage.
   */
  signal?: AbortSignal;
  /** Appended to the conditional-write probe's failure message. */
  describeTransport(): string;
  /** Hangs every bucket call until `resume`; without it stage 8b's sales run unbounded. */
  freeze?: { pause(): Promise<void>; resume(): void };
  record?(event: StreamLoopEvent): void;
}

interface BoxDirs {
  root: string;
  state: string;
  venue: string;
}

async function boxDirs(parent: string, name: string): Promise<BoxDirs> {
  const root = join(parent, name);
  const dirs = { root, state: join(root, "state"), venue: join(root, "state", "venue") };
  await mkdir(dirs.venue, { recursive: true });
  return dirs;
}

/** Keys in the bucket containing `fragment`, whether the store returns them with its prefix or without. */
async function keysContaining(store: ObjectStore, fragment: string): Promise<string[]> {
  return (await store.list("")).map(({ key }) => key).filter((key) => key.includes(fragment));
}

/** The one venue id with a pointer in this bucket, or undefined before any pointer exists. */
async function venueIdInBucket(store: ObjectStore): Promise<string | undefined> {
  const ids = new Set<string>();
  for (const key of await keysContaining(store, "venues/")) {
    const match = /(?:^|\/)venues\/([^/]+)\/current\.json$/.exec(key);
    if (match !== null) ids.add(match[1]!);
  }
  if (ids.size > 1)
    throw new Error(`expected one venue in the loop test's bucket, found ${[...ids].join(", ")}`);
  return [...ids][0];
}

/**
 * Every table's rows, serialised and sorted, keyed by table name. Litestream's own two tables are
 * left out: Litestream 0.5.17 adds `_litestream_seq` and `_litestream_lock` to the database it
 * streams (measured 2026-09-23), and their contents are its bookkeeping, not the venue's.
 */
function tableContents(path: string): Map<string, string[]> {
  const db = new DatabaseSync(path);
  try {
    const tables = db
      .prepare(
        `select name from sqlite_schema where type = 'table'
           and name not like 'sqlite\\_%' escape '\\' and name not like '\\_litestream\\_%' escape '\\'
         order by name`,
      )
      .all() as { name: string }[];
    const contents = new Map<string, string[]>();
    for (const { name } of tables) {
      const rows = db.prepare(`select * from ${quoteIdent(name)}`).all();
      contents.set(
        name,
        rows
          .map((row) =>
            JSON.stringify(row, (_key, value: unknown) =>
              value instanceof Uint8Array
                ? Buffer.from(value).toString("hex")
                : typeof value === "bigint"
                  ? value.toString()
                  : value,
            ),
          )
          .sort(),
      );
    }
    return contents;
  } finally {
    db.close();
  }
}

/** Names of the tables whose rows differ, or which only one side has. */
function differingTables(a: Map<string, string[]>, b: Map<string, string[]>): string[] {
  const names = new Set([...a.keys(), ...b.keys()]);
  return [...names]
    .filter((name) => JSON.stringify(a.get(name)) !== JSON.stringify(b.get(name)))
    .sort();
}

export async function runStreamLoopScenario(fixture: StreamLoopFixture): Promise<void> {
  const { bucket, scratch, litestreamBin, signal } = fixture;
  const clock = stageClock(fixture.record, signal);
  const waitFor = <T>(what: string, timeoutMs: number, probe: () => Promise<T | undefined>) =>
    waitUntil(what, timeoutMs, probe, signal, POLL_MS);
  // Each server leaves the set before it is closed, so an abort and the body never close one twice.
  const running = new Set<StartedServer>();
  const closeRunning = async (): Promise<unknown[]> => {
    const closeFailures: unknown[] = [];
    for (const server of running) {
      running.delete(server);
      try {
        await server.close();
      } catch (error) {
        closeFailures.push(error);
      }
    }
    return closeFailures;
  };
  let abortClose: Promise<unknown[]> | undefined;
  const onAbort = (): void => {
    abortClose = closeRunning();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const failures: unknown[] = [];
  try {
    clock.begin("probe");
    const migrationsRoot = join(scratch, "migrations");
    const fromSource = migrationOptionsFor(manifestSets(), null);
    for (const [index, set] of manifestSets().entries()) {
      await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }

    // 1. The bucket, and the conditional write every pointer move depends on. A server that does not
    //    refuse a stale write fails HERE, with the probe's reason, before anything streams.
    const store = createS3ObjectStore(bucket);
    expect(
      await probeBucket(store),
      `The bucket failed the conditional-write probe; see testing-guide.md → "The stream loop test skips locally without its two binaries, and a skip reads as a pass". Transport: ${fixture.describeTransport()}`,
    ).toEqual({ ok: true });

    clock.begin("pointer-a");
    // 2. Box A, provisioned the way a setup boot leaves a box: secrets and TLS in the state folder,
    //    a migrated and provisioned venue, a node key and a term-0 membership document, and streaming
    //    switched on with a recovery key.
    const dirsA = await boxDirs(scratch, "box-a");
    const portA = await freePort();
    await ensureBoxSecrets({
      stateDir: dirsA.state,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
      listIpv4: () => [],
    });
    const ring = loadKeyRing(
      parseEnvFile(await readFile(join(dirsA.state, "secrets.env"), "utf8")),
    );
    await applyMigrations(dirsA.venue, fromSource);
    let nodeSecret: string;
    const seeding = await openVenueDatabase(dirsA.venue);
    let a: {
      nodeId: string;
      seriesId: string;
      locationId: string;
      publicKey: string;
    };
    try {
      await stampDeployment(seeding.venue, "preproduction");
      const venue = await applyVenue(
        planVenue(
          {
            country: "ES",
            taxId: "74000001P",
            legalName: "Stream Loop SL",
            location: {
              name: "Sala principal",
              fiscalTerritory: "ES-common",
              invoiceLocales: [LOCALE],
              operationDescription: "Venta en establecimiento",
              addressLine1: "Calle Mayor 1",
              addressLine2: null,
              postalCode: "28013",
              city: "Madrid",
              province: "Madrid",
              timeZone: "Europe/Madrid",
              dayCutover: "05:00",
            },
            seriesCode: "A",
            rectificativeSeriesCode: "R",
            admin: {
              displayName: "Administradora",
              firstNames: "Test",
              lastNames: "Operator",
              pinHash: hashPin("1234"),
              passwordHash: hashPassword("dashPass123"),
              email: "owner@example.test",
            },
          },
          ALL_MODULES,
        ),
        { db: seeding.venue, modules: ALL_MODULES },
      );
      nodeSecret = await mintBreakGlassSecret(seeding.venue, venue.nodeId);
      await establishNodeIdentity({ ownerDb: seeding.venue, ring }, venue.nodeId);
      await seedTermZeroMembership(
        { db: seeding.venue, ring },
        venue.nodeId,
        `https://127.0.0.1:${portA}`,
      );
      await withTransaction(seeding.venue, (tx) =>
        putCredential(tx, ring, {
          purpose: "backup.stream",
          value: streamSettingsPayload({ venueId: venue.locationId, bucket }),
        }),
      );
      const [row] = await seeding.venue
        .select({ publicKey: nodes.publicKey })
        .from(nodes)
        .where(eq(nodes.id, venue.nodeId));
      a = {
        nodeId: venue.nodeId,
        seriesId: venue.seriesIds[0]!,
        locationId: venue.locationId,
        publicKey: row!.publicKey!,
      };
    } finally {
      await seeding.close();
    }
    await writeFile(
      join(dirsA.state, "trading.env"),
      formatEnvFile({
        WAITRON_TILL_NODE_ID: a.nodeId,

        WAITRON_TILL_LOCATION_ID: a.locationId,
        WAITRON_ENV: "preproduction",
      }),
    );
    await writeFile(
      join(dirsA.state, "backup.env"),
      formatEnvFile({ WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY }),
    );
    await writeFile(
      join(dirsA.state, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );

    const bootEnv = (dirs: BoxDirs, port: number): NodeJS.ProcessEnv => ({
      WAITRON_STATE_DIR: dirs.state,
      WAITRON_VENUE_DIR: dirs.venue,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_LITESTREAM_BIN: litestreamBin,
    });

    // 3. A boots, opens its generation and moves the pointer only after the first full copy landed.
    const serverA = await startServer(await loadBoxEnv(bootEnv(dirsA, portA), dirsA.state));
    running.add(serverA);
    const venueId = await waitFor("a pointer in the bucket", POINTER_WAIT_MS, () =>
      venueIdInBucket(store),
    );
    const pointerA = await waitFor(
      "the pointer to name box A's generation",
      POINTER_WAIT_MS,
      async () => {
        const read = await readPointer(store, venueId);
        return read !== null && read.pointer.body.nodeId === a.nodeId ? read : undefined;
      },
    );
    expect(verifyPointer(pointerA.pointer, a.publicKey)).toBe(true);
    expect(pointerA.pointer.body).toMatchObject({ venueId, nodeId: a.nodeId, term: 0 });
    expect(pointerA.pointer.body.generation.startsWith(`gen-0-${a.nodeId}-`)).toBe(true);

    const saleInGeneration = async (
      generation: string,
      saleId: string,
    ): Promise<true | undefined> => {
      const folder = await mkdtemp(join(scratch, "probe-"));
      try {
        const out = join(folder, "venue.db");
        await restoreGeneration({
          litestreamBin,
          bucket,
          venueId,
          generation,
          outPath: out,
          ceilingMs: RESTORE_MS,
        });
        const db = new DatabaseSync(out);
        try {
          return db.prepare("select 1 as hit from sales where id = ?").get(saleId) === undefined
            ? undefined
            : true;
        } finally {
          db.close();
        }
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    };

    clock.begin("sale-a");
    // 4. A sells, and the sale is confirmed in the bucket by RESTORING it, not by counting files.
    const saleA = await recordOneSale(
      {
        nodeId: a.nodeId,
        seriesId: a.seriesId,
        description: "Café",
        baseAmount: "1.50",
        vatRate: "10.00",
      },
      { WAITRON_VENUE_DIR: dirsA.venue, WAITRON_ENV: "preproduction" },
    );
    await waitFor("box A's sale to reach A's generation", UPLOAD_WAIT_MS, () =>
      saleInGeneration(pointerA.pointer.body.generation, saleA.saleId),
    );

    clock.begin("rebuild");
    // 5. A dies: its server stops and its whole folder is gone.
    running.delete(serverA);
    await serverA.close();
    const leafA = new X509Certificate(
      await readFile(join(dirsA.state, "tls", "server.crt"), "utf8"),
    );
    await rm(dirsA.root, { recursive: true, force: true });
    const kitPath = join(scratch, "recovery-kit.txt");
    await writeFile(
      kitPath,
      encodeRecoveryKit({
        version: 1,
        venueId,
        bucket,
        recoveryKey: RECOVERY_KEY,
        pointerSignerPublicKey: a.publicKey,
      }),
    );

    // 6. B is rebuilt from the bucket through the command line. A changed within the last ten
    //    minutes, so the owner's confirmation that it is gone is required, and given.
    const dirsB = await boxDirs(scratch, "box-b");
    const portB = await freePort();
    const recoveryFixture = allocationFixture({
      node: { nodeId: nodeId(a.nodeId), locationId: locationId(a.locationId) },
      taxpayerNif: "74000001P",
      identity: "P000042",
      recoveryKey: true,
      bases: [
        { code: "A", purpose: "standard" },
        { code: "FF", purpose: "full" },
        { code: "R", purpose: "rectificative" },
      ],
    });
    const allocationEnv = await writeAllocationInput(scratch, recoveryFixture, "restore");
    const recoveryModules = ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu"
        ? {
            ...module,
            operations: createPaperAllocationPreparation({
              custodianPath: allocationEnv.WAITRON_FISCAL_CUSTODIAN_FILE,
              confirmationPath: allocationEnv.WAITRON_FISCAL_CONFIRMATION_FILE,
              confirmedFingerprint: allocationEnv.WAITRON_FISCAL_CUSTODIAN_FINGERPRINT,
            }),
          }
        : module,
    );
    const said: string[] = [];
    const { WAITRON_RECOVERY_OPERATION_FILE: operationPath, ...paperEnv } = allocationEnv;
    const code = await runRestore({
      withModuleOperations: createRecoveryRestoreRunner(
        recoveryModules,
        await readRecoveryOperationFile(operationPath),
        nodeSecret!,
      ),
      argv: [
        "restore",
        "--from-bucket",
        kitPath,
        "--confirm-old-box-gone",
        "--confirm-venue",
        "74000001P",
      ],
      env: {
        ...paperEnv,
        WAITRON_NODE_RECOVERY_KEY: nodeSecret!,
        WAITRON_STATE_DIR: dirsB.state,
        WAITRON_VENUE_DIR: dirsB.venue,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
        WAITRON_LITESTREAM_BIN: litestreamBin,
      },
      out: (line) => said.push(line),
    });
    expect(code, said.join("\n")).toBe(0);
    const tradingB = parseEnvFile(await readFile(join(dirsB.state, "trading.env"), "utf8"));
    expect(tradingB.WAITRON_TILL_NODE_ID).toBe(a.nodeId);
    expect(tradingB).not.toHaveProperty("WAITRON_TILL_SERIES_ID");

    clock.begin("pointer-b");
    // 7. B's first start: a membership document one term higher, a generation of its own, and the
    //    pointer moved — still verifiable with the key the owner's kit carries.
    const serverB = await startServer(await loadBoxEnv(bootEnv(dirsB, portB), dirsB.state));
    running.add(serverB);
    const pointerB = await waitFor(
      "the pointer to move to box B's generation",
      POINTER_WAIT_MS,
      async () => {
        const read = await readPointer(store, venueId);
        return read !== null && read.pointer.body.generation !== pointerA.pointer.body.generation
          ? read
          : undefined;
      },
    );
    expect(verifyPointer(pointerB.pointer, a.publicKey)).toBe(true);
    expect(pointerB.pointer.body).toMatchObject({ venueId, nodeId: a.nodeId, term: 1 });
    expect(pointerB.pointer.body.generation.startsWith(`gen-1-${a.nodeId}-`)).toBe(true);
    // The old generation is still there: moving the pointer deletes nothing inside the window.
    expect(
      await keysContaining(store, `${venuePrefix(venueId)}${pointerA.pointer.body.generation}/`),
    ).not.toHaveLength(0);
    // B serves a NEW leaf, signed by the authority A had, to a client that trusts only the
    // restored ca.crt. The dead box's leaf would also verify against that authority, so the served
    // certificate is compared with both files: it must be B's re-issued one, not A's.
    const caB = await readFile(join(dirsB.state, "tls", "ca.crt"), "utf8");
    const leafB = new X509Certificate(
      await readFile(join(dirsB.state, "tls", "server.crt"), "utf8"),
    );
    expect(leafB.serialNumber).not.toBe(leafA.serialNumber);
    const served = await new Promise<string>((resolve, reject) => {
      const socket = tlsConnect(
        { host: "127.0.0.1", port: portB, ca: caB, servername: "waitron.local" },
        () => {
          const serial = socket.getPeerCertificate().serialNumber;
          socket.end();
          resolve(serial);
        },
      );
      socket.once("error", reject);
    });
    expect(served.toUpperCase()).toBe(leafB.serialNumber.toUpperCase());
    const sealedB = await openVenueDatabase(dirsB.venue);
    let seriesB: string;
    try {
      seriesB = await readStandardSeriesId(sealedB.venue, a.nodeId);
      expect(seriesB).not.toBe(a.seriesId);
      const [row] = await sealedB.venue
        .select({ sealed: nodeSealedState.sealed })
        .from(nodeSealedState)
        .where(eq(nodeSealedState.nodeId, a.nodeId));
      const leafInRow = unsealNodeState(row!.sealed, RECOVERY_KEY).find(
        (entry) => entry.name === "secrets/tls/server.crt",
      );
      expect(new X509Certificate(Buffer.from(leafInRow!.bytes)).serialNumber).toBe(
        leafB.serialNumber,
      );
    } finally {
      await sealedB.close();
    }

    clock.begin("sale-b");
    // 8. B sells on the series the restore opened, and the sale reaches B's generation.
    const saleB = await recordOneSale(
      {
        nodeId: tradingB.WAITRON_TILL_NODE_ID!,
        seriesId: seriesB,
        description: "Agua",
        baseAmount: "2.00",
        vatRate: "10.00",
      },
      { WAITRON_VENUE_DIR: dirsB.venue, WAITRON_ENV: "preproduction" },
    );
    await waitFor("box B's sale to reach B's generation", UPLOAD_WAIT_MS, () =>
      saleInGeneration(pointerB.pointer.body.generation, saleB.saleId),
    );

    clock.begin("frozen-transport");
    // 8b. Sales keep their normal time with the transport frozen — against the real Litestream.
    //     A frozen transport hangs every bucket call rather than refusing it. A sale that waited on
    //     the bucket would hang with it; the bound sits far below that and far above a healthy sale. Without a
    //     `freeze` the same sales run unfrozen and unbounded, so the record count below holds.
    const idsB = {
      nodeId: tradingB.WAITRON_TILL_NODE_ID!,
      seriesId: seriesB,
    };
    const timedSale = async (i: number): Promise<{ ms: number; saleId: string }> => {
      const started = performance.now();
      const sale = await recordOneSale(
        { ...idsB, description: `Pan ${i}`, baseAmount: "1.00", vatRate: "10.00" },
        { WAITRON_VENUE_DIR: dirsB.venue, WAITRON_ENV: "preproduction" },
      );
      return { ms: performance.now() - started, saleId: sale.saleId };
    };
    const baseline: number[] = [];
    for (let i = 0; i < TIMED_SALES; i += 1) baseline.push((await timedSale(i)).ms);
    let lastSaleId = "";
    const freeze = fixture.freeze;
    if (freeze === undefined) {
      for (let i = 0; i < TIMED_SALES; i += 1) {
        lastSaleId = (await timedSale(TIMED_SALES + i)).saleId;
      }
    } else {
      await freeze.pause();
      try {
        // Long enough for Litestream to be part-way through calls the server will not answer.
        await delay(2_000, undefined, signal ? { signal } : {});
        const stopped: number[] = [];
        for (let i = 0; i < TIMED_SALES; i += 1) {
          const sale = await timedSale(TIMED_SALES + i);
          stopped.push(sale.ms);
          lastSaleId = sale.saleId;
        }
        expect(Math.max(...stopped)).toBeLessThan(Math.max(1_000, 5 * Math.max(...baseline)));
      } finally {
        freeze.resume();
      }
    }
    await waitFor("stage 8b's sales to reach B's generation", UPLOAD_WAIT_MS, () =>
      saleInGeneration(pointerB.pointer.body.generation, lastSaleId),
    );

    clock.end(freeze === undefined ? "skipped" : "ok");
    clock.begin("restore-compare");
    // 9. B stops cleanly; a restore of its generation holds exactly what its database holds.
    running.delete(serverB);
    await serverB.close();
    const restoredB = join(await mkdtemp(join(scratch, "restored-b-")), "venue.db");
    await restoreGeneration({
      litestreamBin,
      bucket,
      venueId,
      generation: pointerB.pointer.body.generation,
      outPath: restoredB,
      ceilingMs: RESTORE_MS,
    });
    const live = tableContents(join(dirsB.venue, "venue.db"));
    expect(differingTables(live, tableContents(restoredB))).toEqual([]);
    // The comparison can see a difference: one extra table in a copy is reported, by name.
    const control = join(dirname(restoredB), "control.db");
    await copyFile(restoredB, control);
    const controlDb = new DatabaseSync(control);
    try {
      controlDb.exec("create table loop_control (x)");
    } finally {
      controlDb.close();
    }
    expect(differingTables(live, tableContents(control))).toEqual(["loop_control"]);

    // 10. A's sale is on the old installation; B's is the first record of a fresh one.
    const readB = await openVenueDatabase(dirsB.venue);
    try {
      const sifs = await readB.venue
        .select({
          id: registroSif.id,
          numeroInstalacion: registroSif.numeroInstalacion,
          revocadoEn: registroSif.revocadoEn,
        })
        .from(registroSif)
        .where(eq(registroSif.nodeId, a.nodeId))
        .orderBy(registroSif.registradoEn);
      expect(sifs).toHaveLength(2);
      const [old, fresh] = sifs;
      expect(old!.revocadoEn).not.toBeNull();
      expect(fresh!.revocadoEn).toBeNull();
      expect(fresh!.numeroInstalacion).toBe("P000042");
      expect(fresh!.numeroInstalacion).not.toBe(old!.numeroInstalacion);
      const records = await readB.venue
        .select({
          saleId: registrosFacturacion.saleId,
          sifId: registrosFacturacion.sifId,
          primerRegistro: registrosFacturacion.primerRegistro,
        })
        .from(registrosFacturacion);
      expect(records).toHaveLength(2 + 2 * TIMED_SALES); // A's, B's, and stage 8b's
      expect(records).toEqual(
        expect.arrayContaining([
          { saleId: saleA.saleId, sifId: old!.id, primerRegistro: true },
          { saleId: saleB.saleId, sifId: fresh!.id, primerRegistro: true },
        ]),
      );
    } finally {
      await readB.close();
    }
    clock.end("ok");
  } catch (error) {
    clock.end("failed");
    failures.push(error);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (abortClose !== undefined) failures.push(...(await abortClose));
    failures.push(...(await closeRunning()));
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "stream loop failed");
}
