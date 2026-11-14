// The stream loop, end to end, against whichever bucket its fixture names: box A streams its
// venue, dies, box B is rebuilt with its kit, saved node key and signed allocation, sells under a fresh
// installation number and chain, streams into a generation of its own and moves the pointer, and a
// restore of B's generation holds exactly what B's database holds. `stream-loop.e2e.test.ts` runs it
// against versitygw; `aws-stream-loop.aws-rehearsal.test.ts` against Amazon S3, by opt-in only.
import { randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { connect as tlsConnect } from "node:tls";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { loadKeyRing, nodeSigningPublicKey, readNodeSigningKey } from "@waitron/credentials";
import { nodeSealedState, nodes, openVenueDatabase, readStandardSeriesId } from "@waitron/db";
import {
  createPaperAllocationPreparation,
  registroSif,
  registrosFacturacion,
} from "@waitron/fiscal-verifactu";
import { readRecoveryPackPdf } from "@waitron/recovery-pack";
import { verifySecretAsync } from "@waitron/identity";
import { readRecoveryKeyVerifier } from "@waitron/node-db";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { nodeId } from "@waitron/shared";
import {
  applyVenue as applyMinuteVenue,
  mergeModulePreparationRevisions,
  quoteIdent,
  type VenueRequest,
} from "@waitron/provisioning";
import { withOperationAuthority } from "@waitron/module";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { createHourTestClock, selectPastWaits } from "./hour-test-clock.js";
import {
  createRecoveryRestoreRunner,
  readRecoveryOperationFile,
} from "../recovery-module-operation.js";
import { writeAllocationInput } from "./allocation-input.js";
import {
  createS3ObjectStore,
  encodeRecoveryKit,
  probeBucket,
  parseRecoveryKit,
  readPointer,
  restoreGeneration,
  venuePrefix,
  verifyPointer,
  type BucketConfig,
  type ObjectStore,
} from "@waitron/stream";
import { recordFixtureSale } from "../../scripts/testing/sale.js";
import { deriveStreamKey } from "../stream-key.js";
import { startServer, type StartedServer } from "../boot.js";
import { loadBoxEnv } from "../box-env.js";
import { parseEnvFile } from "../env-file.js";
import { ALL_MODULES } from "../modules.js";
import { runRestore } from "../restore-command.js";
import { SPARE_STORE_BUCKET } from "../spare-store.js";
import { unsealNodeState } from "../sealed-state.js";
import type { StreamHostDeps } from "../stream-host.js";
import { exemptBucket } from "./aws-send-gate.js";
import { httpsVia } from "./boot-harness.js";
import { freePort } from "./free-ports.js";
import { fixturePasswordHash, fixturePinHash } from "./known-secret-hashes.js";
import { stageClock, waitUntil } from "./scenario-stages.js";
import { bootEnv, boxDirs, copyMigrations, provisionStreamBox } from "./stream-box.js";
import { STREAM_LOOP_SPARE_PHASES, runLoopSpare } from "./stream-loop-spare.js";

const RECOVERY_KEY = "stream-loop-e2e-recovery-key";
const LOCALE = "es-ES";
const VENUE: VenueRequest = {
  country: "ES",
  taxId: "74000001P",
  legalName: "Stream Loop SL",
  name: "Main room",
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
  seriesCode: "A",
  rectificativeSeriesCode: "R",
  admin: {
    displayName: "Administrator",
    firstNames: "Test",
    lastNames: "Operator",
    pinHash: fixturePinHash("1234"),
    passwordHash: fixturePasswordHash("dashPass123"),
    email: "owner@example.test",
  },
};

// `waitFor` checks each POINTER and UPLOAD wait's deadline between probes, and each restore passes
// RESTORE_MS as `restoreGeneration`'s ceiling, which it checks every five seconds.
// BOOT_MS and REBUILD_MS are budgets nothing here enforces. A caller's timeout adds this sum, which
// includes UNTIMED_MS for migrations, provisioning and closes, because Vitest's timer fails a healthy
// run that outlasts it (CLAUDE.md §4). An upload wait restores the generation once per poll, so it
// also gets one restore's worth on top.
// The sum leaves out the spare phases, which run only with `versitygwBin`; a caller that passes it
// adds STREAM_LOOP_SPARE_MS.
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
  ...STREAM_LOOP_SPARE_PHASES,
] as const;
export type StreamLoopPhase = (typeof STREAM_LOOP_PHASES)[number];

export interface StreamLoopEvent {
  phase: StreamLoopPhase;
  outcome: "ok" | "failed" | "skipped";
  elapsedMs: number;
}

export interface StreamLoopFixture {
  bucket: BucketConfig;
  /** Rotate the bucket key and rebuild from the production PDF instead of a text kit. */
  useRecoveryPack?: boolean;
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
  /** Handed to every server's stream, so a caller can learn of each Litestream they start. */
  serverSeams?: Pick<StreamHostDeps, "spawn">;
  /** The versitygw a spare runs its store on; without it the spare's phases are skipped. */
  versitygwBin?: string;
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

function applyWithFirstSetup(stateDir: string): typeof applyMinuteVenue {
  return async (actions, deps) => {
    // Leave room for selection's minute wait before the real-time sales.
    const clock = createHourTestClock(Date.now() - 10 * 60_000);
    const taxpayer = actions.find((action) => action.kind === "ensure-tenant")!;
    const initialNodeId = randomUUID();
    const initialAdministratorId = randomUUID();
    const binding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: randomUUID(),
      sourceId: randomUUID(),
      targetNodeId: initialNodeId,
    } as const;
    let kept: unknown = null;
    const preparation = createHourPreparation({
      monotonicNow: () => clock.monotonic(),
      withState: async (_binding, run) =>
        run({
          get value() {
            return structuredClone(kept);
          },
          history: [],
          async replace(next) {
            kept = structuredClone(next);
          },
        }),
      read: async () => ({
        scope: { taxpayerNif: taxpayer.taxId, environment: "preproduction" },
        bases: actions
          .filter((action) => action.kind === "create-series")
          .map(({ code, purpose }) => ({ code, purpose })),
        contextKey: "first",
        history: [{ reference: "empty", complete: true, records: [] }],
        clock: compareHourClocks(
          ["box", "browser"].map((source) => ({
            source: source as "box" | "browser",
            result: "usable",
            instantMs: clock.wall(),
            uncertaintyMs: 0,
            wallStartedMs: clock.wall(),
            wallFinishedMs: clock.wall(),
            monotonicStartedMs: clock.monotonic(),
            monotonicFinishedMs: clock.monotonic(),
          })),
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      }),
    });
    const held = await selectPastWaits(clock, () =>
      withOperationAuthority(binding, initialAdministratorId, (authority) =>
        preparation.select({ binding, authority, comparisonId: "comparison" }),
      ),
    );
    if (held.status !== "selected") throw new Error(`first setup answered ${held.status}`);
    const result = await applyMinuteVenue(actions, {
      ...deps,
      initialNodeId,
      initialAdministratorId,
      moduleInputs: new Map([
        [
          "fiscal-verifactu",
          { eventId: binding.eventId, sourceId: binding.sourceId, input: held.input },
        ],
      ]),
      modules: deps.modules.map((module) =>
        module.name === "fiscal-verifactu" ? { ...module, operations: preparation } : module,
      ),
    });
    await mergeModulePreparationRevisions({ stateDir }, [{ binding, value: kept }]);
    return result;
  };
}

export async function runStreamLoopScenario(fixture: StreamLoopFixture): Promise<void> {
  const { bucket, scratch, litestreamBin, signal } = fixture;
  let recoveryKey = RECOVERY_KEY;
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
    const migrationsRoot = await copyMigrations(scratch);

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
    const { nodeSecret: mintedSecret, ...a } = await provisionStreamBox({
      dirs: dirsA,
      advertisedOrigin: `https://127.0.0.1:${portA}`,
      streaming: { bucket, recoveryKey: RECOVERY_KEY },
      modulesJson: { modules: { "fiscal-none": false } },
      venue: { request: VENUE, modules: ALL_MODULES },
      ...(fixture.useRecoveryPack ? { apply: applyWithFirstSetup(dirsA.state) } : {}),
    });
    let nodeSecret = mintedSecret;

    // 3. A boots, opens its generation and moves the pointer only after the first full copy landed.
    const serverA = await startServer(
      await loadBoxEnv(bootEnv(dirsA, portA, migrationsRoot, litestreamBin), dirsA.state),
      {},
      { stream: { ...fixture.serverSeams } },
    );
    running.add(serverA);
    const venueId = await waitFor("a pointer in the bucket", POINTER_WAIT_MS, () =>
      venueIdInBucket(store),
    );
    let pointerA = await waitFor(
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
      serverSecret?: string,
    ): Promise<true | undefined> => {
      const folder = await mkdtemp(join(scratch, "probe-"));
      try {
        const out = join(folder, "venue.db");
        await restoreGeneration({
          litestreamBin,
          bucket,
          streamKey: deriveStreamKey(recoveryKey, venueId),
          venueId,
          generation,
          outPath: out,
          ceilingMs: RESTORE_MS,
        });
        const db = new DatabaseSync(out);
        try {
          if (db.prepare("select 1 as hit from sales where id = ?").get(saleId) === undefined)
            return undefined;
          if (serverSecret === undefined) return true;
          const row = db
            .prepare("select sealed from node_sealed_state where node_id = ?")
            .get(a.nodeId) as { sealed: Uint8Array } | undefined;
          if (row === undefined) return undefined;
          const nodeCopy = unsealNodeState(row.sealed, recoveryKey).find(
            (entry) => entry.name === "node.dump",
          );
          if (nodeCopy === undefined) return undefined;
          const nodePath = join(folder, "node.db");
          await writeFile(nodePath, nodeCopy.bytes);
          const node = new DatabaseSync(nodePath, { readOnly: true });
          try {
            const held = node
              .prepare("select verifier from node_recovery_key where node_id = ?")
              .get(a.nodeId) as { verifier: string } | undefined;
            return held !== undefined && (await verifySecretAsync(serverSecret, held.verifier))
              ? true
              : undefined;
          } finally {
            node.close();
          }
        } finally {
          db.close();
        }
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    };

    clock.begin("sale-a");
    // 4. A sells, and the sale is confirmed in the bucket by RESTORING it, not by counting files.
    const fixtureSale = async (venueDir: string, args: Parameters<typeof recordFixtureSale>[1]) => {
      const store = await openVenueDatabase(venueDir, { exclusive: false });
      try {
        return await recordFixtureSale(store.venue, args);
      } finally {
        await store.close();
      }
    };
    const saleA = await fixtureSale(dirsA.venue, {
      nodeId: a.nodeId,
      seriesId: a.seriesId,
      description: "Café",
      baseAmount: "1.50",
      vatRate: "10.00",
    });
    await waitFor("box A's sale to reach A's generation", UPLOAD_WAIT_MS, () =>
      saleInGeneration(pointerA.pointer.body.generation, saleA.saleId),
    );

    const kitPath = join(
      scratch,
      fixture.useRecoveryPack ? "rotated-recovery-pack.pdf" : "recovery-kit.txt",
    );
    if (fixture.useRecoveryPack) {
      const originalGeneration = pointerA.pointer.body.generation;
      const { via, close } = httpsVia(await readFile(join(dirsA.state, "tls", "ca.crt")));
      const origin = `https://127.0.0.1:${portA}`;
      try {
        const login = await fetch(`${origin}/management-api/session`, {
          ...via,
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ email: "owner@example.test", password: "dashPass123" }),
        });
        expect(login.status).toBe(200);
        await login.arrayBuffer();
        const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
        const headers = { "content-type": "application/json", origin, cookie };
        const proof = await fetch(`${origin}/management-api/session/me/fresh-sign-in`, {
          ...via,
          method: "POST",
          headers,
          body: JSON.stringify({ method: "password", password: "dashPass123" }),
        });
        expect(proof.status).toBe(204);
        await proof.arrayBuffer();
        recoveryKey = randomBytes(32).toString("base64");
        const rotated = await fetch(`${origin}/api/backup/rotate`, {
          ...via,
          method: "POST",
          headers,
          body: JSON.stringify({ recoveryKey }),
        });
        expect(rotated.status).toBe(200);
        await rotated.arrayBuffer();
        pointerA = await waitFor("the rotated generation's pointer", POINTER_WAIT_MS, async () => {
          const read = await readPointer(store, venueId);
          return read !== null && read.pointer.body.generation !== originalGeneration
            ? read
            : undefined;
        });
        await waitFor("the sale in the rotated generation", UPLOAD_WAIT_MS, () =>
          saleInGeneration(pointerA.pointer.body.generation, saleA.saleId),
        );
        const checkFolder = await mkdtemp(join(scratch, "rotation-control-"));
        try {
          const restore = (generation: string, key: string, file: string) =>
            restoreGeneration({
              litestreamBin,
              bucket,
              venueId,
              generation,
              streamKey: deriveStreamKey(key, venueId),
              outPath: join(checkFolder, file),
              ceilingMs: RESTORE_MS,
            });
          await expect(
            restore(pointerA.pointer.body.generation, RECOVERY_KEY, "wrong.db"),
          ).rejects.toMatchObject({
            code: "backup.stream_request_failed",
            params: { operation: "get", status: 403 },
          });
          await restore(originalGeneration, RECOVERY_KEY, "old.db");
          const old = new DatabaseSync(join(checkFolder, "old.db"));
          try {
            expect(
              old.prepare("select 1 as hit from sales where id = ?").get(saleA.saleId),
            ).toBeDefined();
          } finally {
            old.close();
          }
        } finally {
          await rm(checkFolder, { recursive: true, force: true });
        }
        const made = await fetch(`${origin}/api/backup/recovery-pack`, {
          ...via,
          method: "POST",
          headers,
          body: JSON.stringify({
            locale: "es",
            newServerKey: true,
          }),
        });
        expect(made.status).toBe(200);
        const pdf = new Uint8Array(await made.arrayBuffer());
        const pack = await readRecoveryPackPdf(pdf);
        expect(parseRecoveryKit(pack.bucketCode!).recoveryKey === recoveryKey).toBe(true);
        nodeSecret = (pack.serverKey as { nodeKey: { secret: string } }).nodeKey.secret;
        await writeFile(kitPath, pdf);
        await waitFor("the PDF's server key to reach the bucket", UPLOAD_WAIT_MS, () =>
          saleInGeneration(pointerA.pointer.body.generation, saleA.saleId, nodeSecret),
        );
      } finally {
        await close();
      }
    }

    clock.begin("rebuild");
    // 5. A dies: its server stops and its whole folder is gone.
    running.delete(serverA);
    await serverA.close();
    const leafA = new X509Certificate(
      await readFile(join(dirsA.state, "tls", "server.pem"), "utf8"),
    );
    await rm(dirsA.root, { recursive: true, force: true });
    if (!fixture.useRecoveryPack)
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
      node: { nodeId: nodeId(a.nodeId) },
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
    expect(tradingB.WAITRON_NODE_ID).toBe(a.nodeId);
    expect(tradingB).not.toHaveProperty("WAITRON_TILL_SERIES_ID");

    clock.begin("pointer-b");
    // 7. B's first start: a membership document one term higher, a generation of its own, and the
    //    pointer moved — still verifiable with the key the owner's kit carries.
    const serverB = await startServer(
      await loadBoxEnv(bootEnv(dirsB, portB, migrationsRoot, litestreamBin), dirsB.state),
      {},
      { stream: { ...fixture.serverSeams } },
    );
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
      await readFile(join(dirsB.state, "tls", "server.pem"), "utf8"),
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
      const leafInRow = unsealNodeState(row!.sealed, recoveryKey).find(
        (entry) => entry.name === "secrets/tls/server.pem",
      );
      expect(new X509Certificate(Buffer.from(leafInRow!.bytes)).serialNumber).toBe(
        leafB.serialNumber,
      );
      const ringB = loadKeyRing(
        parseEnvFile(await readFile(join(dirsB.state, "secrets.env"), "utf8")),
      );
      const signingKey = await readNodeSigningKey(sealedB.node, ringB, a.nodeId);
      expect(signingKey).not.toBeNull();
      expect(nodeSigningPublicKey(signingKey!)).toBe(a.publicKey);
      const [nodeRow] = await sealedB.venue
        .select({ publicKey: nodes.publicKey })
        .from(nodes)
        .where(eq(nodes.id, a.nodeId));
      expect(nodeRow!.publicKey).toBe(a.publicKey);
      const verifier = await readRecoveryKeyVerifier(sealedB.node, a.nodeId);
      expect(await verifySecretAsync(nodeSecret!, verifier!)).toBe(true);
    } finally {
      await sealedB.close();
    }

    clock.begin("sale-b");
    // 8. B sells on the series the restore opened, and the sale reaches B's generation.
    const saleB = await fixtureSale(dirsB.venue, {
      nodeId: tradingB.WAITRON_NODE_ID!,
      seriesId: seriesB,
      description: "Agua",
      baseAmount: "2.00",
      vatRate: "10.00",
    });
    await waitFor("box B's sale to reach B's generation", UPLOAD_WAIT_MS, () =>
      saleInGeneration(pointerB.pointer.body.generation, saleB.saleId),
    );

    clock.begin("frozen-transport");
    // 8b. Sales keep their normal time with the transport frozen — against the real Litestream.
    //     A frozen transport hangs every bucket call rather than refusing it. A sale that waited on
    //     the bucket would hang with it; the bound sits far below that and far above a healthy sale. Without a
    //     `freeze` the same sales run unfrozen and unbounded, so the record count below holds.
    const idsB = {
      nodeId: tradingB.WAITRON_NODE_ID!,
      seriesId: seriesB,
    };
    const timedSale = async (i: number): Promise<{ ms: number; saleId: string }> => {
      const started = performance.now();
      const sale = await fixtureSale(dirsB.venue, {
        ...idsB,
        description: `Pan ${i}`,
        baseAmount: "1.00",
        vatRate: "10.00",
      });
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
      streamKey: deriveStreamKey(recoveryKey, venueId),
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

    // 11. B adds a spare (`stream-loop-spare.ts`).
    const { versitygwBin } = fixture;
    if (versitygwBin === undefined) {
      for (const phase of STREAM_LOOP_SPARE_PHASES) {
        clock.begin(phase);
        clock.end("skipped");
      }
    } else {
      // B's pair stream writes to C's own store, a bucket no rehearsal plan names.
      await exemptBucket(SPARE_STORE_BUCKET, () =>
        runLoopSpare({
          scratch,
          migrationsRoot,
          litestreamBin,
          versitygwBin,
          dirsB,
          portB,
          nodeIdB: a.nodeId,
          saleIds: [saleA.saleId, saleB.saleId, lastSaleId],
          ...(fixture.serverSeams === undefined ? {} : { serverSeams: fixture.serverSeams }),
          ...(signal === undefined ? {} : { signal }),
          begin: (phase) => clock.begin(phase),
        }),
      );
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
