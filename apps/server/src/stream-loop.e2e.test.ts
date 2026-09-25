// The slice-2 loop, end to end, with the real pinned Litestream and a real S3-compatible server:
//   - box A streams its venue to a bucket;
//   - A dies;
//   - box B is rebuilt from the bucket with nothing but the recovery kit;
//   - B sells under a fresh installation number and chain;
//   - B streams into a generation of its own and moves the pointer;
//   - a restore of B's generation holds exactly what B's database holds.
//
// The server is versitygw, run as a plain child process (`./testing/s3-test-server.ts`). Install both
// binaries with `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`. Without
// them this case is reported SKIPPED, with the reason in its note. With CI=true (GitHub sets it on
// every job) or WAITRON_REQUIRE_STREAM_BINARIES=1, a missing binary FAILS the case instead.
import { X509Certificate } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { connect as tlsConnect } from "node:tls";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  nodeSealedState,
  nodes,
  openVenueDatabase,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { installationFloor, registroSif, registrosFacturacion } from "@waitron/fiscal-verifactu";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, quoteIdent } from "@waitron/provisioning";
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
import { recordOneSale } from "../scripts/record-one-sale.js";
import { startServer, type StartedServer } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity } from "./node-identity.js";
import { runRestore } from "./restore-command.js";
import { unsealNodeState } from "./sealed-state.js";
import { streamSettingsPayload } from "./stream-host.js";
import {
  READY_TIMEOUT_MS as S3_READY_MS,
  VERSITYGW_VERSION,
  resolveLitestream,
  resolveVersitygw,
  startS3TestServer,
  type S3TestServer,
} from "./testing/s3-test-server.js";

const INSTALL = "node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";

const RECOVERY_KEY = "stream-loop-e2e-recovery-key";
const LOCALE = "es-ES";

// `waitFor` enforces each POINTER and UPLOAD wait, the helper the S3 server's start, and each
// restore passes RESTORE_MS as `restoreGeneration`'s ceiling, which it checks every five seconds.
// BOOT_MS and REBUILD_MS are budgets nothing here enforces. The case's timeout is the sum of all of
// them plus UNTIMED_MS for migrations, provisioning and closes, because Vitest's timer fails a
// healthy run that outlasts it (CLAUDE.md §4). An upload wait restores the generation once per poll,
// so it also gets one restore's worth on top.
const POINTER_WAIT_MS = 30_000;
const UPLOAD_WAIT_MS = 30_000;
/** Sales timed with the S3 server up, and again with it stopped (stage 8b). */
const TIMED_SALES = 10;
const RESTORE_MS = 30_000;
const REBUILD_MS = 120_000;
const BOOT_MS = 30_000;
const UNTIMED_MS = 60_000;
const POLL_MS = 500;
const LOOP_TIMEOUT_MS =
  S3_READY_MS +
  2 * BOOT_MS +
  3 * POINTER_WAIT_MS +
  3 * (UPLOAD_WAIT_MS + RESTORE_MS) +
  // Stage 8b: the two-second pause, and 2 × TIMED_SALES sales at the 1,000 ms bound each at worst.
  2_000 +
  2 * TIMED_SALES * 1_000 +
  REBUILD_MS +
  RESTORE_MS +
  UNTIMED_MS;

const litestream = await resolveLitestream(process.env);
const versitygw = await resolveVersitygw(process.env);
const missing = [litestream, versitygw].flatMap((lookup) => (lookup.ok ? [] : [lookup.reason]));
if (missing.length > 0 && !REQUIRED) {
  console.warn(`stream loop test SKIPPED: ${missing.join("; ")}. Install with: ${INSTALL}`);
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

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitFor<T>(
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline)
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
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

describe("the stream loop: stream, rebuild from the bucket, sell under a fresh chain, stream again", () => {
  let scratch: string | undefined;
  let s3: S3TestServer | undefined;
  let serverA: StartedServer | undefined;
  let serverB: StartedServer | undefined;

  afterAll(async () => {
    // Each cleanup runs even when an earlier one rejects, so a failed close cannot leave versitygw
    // running.
    const failures: unknown[] = [];
    for (const cleanup of [
      async () => {
        if (serverA !== undefined) await serverA.close();
      },
      async () => {
        if (serverB !== undefined) await serverB.close();
      },
      async () => {
        if (s3 !== undefined) await s3.stop();
      },
      async () => {
        if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
      },
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "stream loop teardown failed");
  });

  it(
    "box A streams, dies, box B is rebuilt from the kit, sells on a fresh chain and moves the pointer; B's generation restores to B's database",
    async (ctx) => {
      if (!litestream.ok || !versitygw.ok) {
        if (REQUIRED) {
          throw new Error(
            `stream loop test cannot run: ${missing.join("; ")}. CI installs both with: ${INSTALL}`,
          );
        }
        // `return` so TypeScript narrows both lookups below; `ctx.skip` throws either way.
        return ctx.skip(`${missing.join("; ")} — install with: ${INSTALL}`);
      }
      const litestreamBin = litestream.bin;

      scratch = await mkdtemp(join(tmpdir(), "waitron-stream-loop-"));
      const migrationsRoot = join(scratch, "migrations");
      const fromSource = migrationOptionsFor(manifestSets(), null);
      for (const [index, set] of manifestSets().entries()) {
        await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
          recursive: true,
        });
      }

      // 1. The bucket, and the conditional write every pointer move depends on. A server that does not
      //    refuse a stale write fails HERE, with the probe's reason, before anything streams.
      s3 = await startS3TestServer({ bin: versitygw.bin, root: join(scratch, "s3") });
      const bucket: BucketConfig = {
        endpoint: s3.endpoint,
        region: s3.region,
        bucket: s3.bucket,
        prefix: "loop/",
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
      };
      const store = createS3ObjectStore(bucket);
      expect(
        await probeBucket(store),
        `versitygw ${VERSITYGW_VERSION} failed the conditional-write probe; see testing-guide.md → "The stream loop test skips locally without its two binaries, and a skip reads as a pass". Server log: ${s3.log()}`,
      ).toEqual({ ok: true });

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
      const seeding = await openVenueDatabase(dirsA.venue);
      let a: {
        nodeId: string;
        tillId: string;
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
              taxId: "74000001K",
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
              tillName: "Caja 1",
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
        await establishNodeIdentity({ ownerDb: seeding.venue, ring }, venue.nodeId);
        await seedTermZeroMembership(
          { db: seeding.venue, ring },
          venue.nodeId,
          `https://127.0.0.1:${portA}`,
        );
        // Stored the way Task 8a's Save stores it: the venue is this node's location (N9).
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
          tillId: venue.tillId,
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
          WAITRON_TILL_TILL_ID: a.tillId,
          WAITRON_TILL_NODE_ID: a.nodeId,
          WAITRON_TILL_SERIES_ID: a.seriesId,
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
      serverA = await startServer(await loadBoxEnv(bootEnv(dirsA, portA), dirsA.state));
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
        const out = join(await mkdtemp(join(scratch!, "probe-")), "venue.db");
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
      };

      // 4. A sells, and the sale is confirmed in the bucket by RESTORING it, not by counting files.
      const saleA = await recordOneSale(
        {
          tillId: a.tillId,
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

      // 5. A dies: its server stops and its whole folder is gone. The kit is all that is left.
      await serverA.close();
      serverA = undefined;
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
      const rebuildStartedAt = new Date();
      const said: string[] = [];
      const code = await runRestore({
        argv: [
          "restore",
          "--from-bucket",
          kitPath,
          "--confirm-old-box-gone",
          "--confirm-venue",
          "74000001K",
        ],
        env: {
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
      expect(tradingB.WAITRON_TILL_SERIES_ID).not.toBe(a.seriesId);

      // 7. B's first start: a membership document one term higher, a generation of its own, and the
      //    pointer moved — still verifiable with the key the owner's kit carries.
      serverB = await startServer(await loadBoxEnv(bootEnv(dirsB, portB), dirsB.state));
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
      // Task 9a: B serves a NEW leaf, signed by the authority A had, to a client that trusts only the
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
      // Task 2b's refresh runs after Task 9a's re-issue in the same start, so the row B sealed carries
      // B's leaf, not A's.
      const sealedB = await openVenueDatabase(dirsB.venue);
      try {
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

      // 8. B sells on the series the restore opened, and the sale reaches B's generation.
      const saleB = await recordOneSale(
        {
          tillId: tradingB.WAITRON_TILL_TILL_ID!,
          nodeId: tradingB.WAITRON_TILL_NODE_ID!,
          seriesId: tradingB.WAITRON_TILL_SERIES_ID!,
          description: "Agua",
          baseAmount: "2.00",
          vatRate: "10.00",
        },
        { WAITRON_VENUE_DIR: dirsB.venue, WAITRON_ENV: "preproduction" },
      );
      await waitFor("box B's sale to reach B's generation", UPLOAD_WAIT_MS, () =>
        saleInGeneration(pointerB.pointer.body.generation, saleB.saleId),
      );

      // 8b. Sales keep their normal time with the S3 server stopped — spec §8.2, against the real
      //     Litestream (Task 7's stream-host case uses a fake one and cannot show this). The server is
      //     frozen with SIGSTOP, so every bucket call hangs rather than being refused. A sale that
      //     waited on the bucket would hang with it; the bound sits far below that and far above a
      //     healthy sale.
      const idsB = {
        tillId: tradingB.WAITRON_TILL_TILL_ID!,
        nodeId: tradingB.WAITRON_TILL_NODE_ID!,
        seriesId: tradingB.WAITRON_TILL_SERIES_ID!,
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
      s3.pause();
      let lastSaleId = "";
      try {
        // Long enough for Litestream to be part-way through calls the server will not answer.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const stopped: number[] = [];
        for (let i = 0; i < TIMED_SALES; i += 1) {
          const sale = await timedSale(TIMED_SALES + i);
          stopped.push(sale.ms);
          lastSaleId = sale.saleId;
        }
        expect(Math.max(...stopped)).toBeLessThan(Math.max(1_000, 5 * Math.max(...baseline)));
      } finally {
        s3.resume();
      }
      await waitFor(
        "the sales made while the bucket was stopped to reach B's generation",
        UPLOAD_WAIT_MS,
        () => saleInGeneration(pointerB.pointer.body.generation, lastSaleId),
      );

      // 9. B stops cleanly; a restore of its generation holds exactly what its database holds.
      await serverB.close();
      serverB = undefined;
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
          .orderBy(registroSif.numeroInstalacion);
        expect(sifs).toHaveLength(2);
        const [old, fresh] = sifs;
        expect(old!.revocadoEn).not.toBeNull();
        expect(fresh!.revocadoEn).toBeNull();
        expect(fresh!.numeroInstalacion).toBeGreaterThanOrEqual(
          installationFloor(new Date(rebuildStartedAt.getTime() - 60_000)),
        );
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
    },
    LOOP_TIMEOUT_MS,
  );
});
