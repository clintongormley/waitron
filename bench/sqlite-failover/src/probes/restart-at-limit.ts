// Measurement 1b: measurement 1 (`restart-after-foldback.ts`) repeated at the side-file limit the
// supervisor will enforce — stop Litestream when `venue.db-wal` reaches 256 MiB, fold it back from
// our own connection, and restart Litestream against the same replica path (the same generation).
//
// FAILING result — prints `RESTART_AT_LIMIT_COMPLETE=false` with `missing=<ranges>` naming sales made
// after the first batch, or `daemon-alive=false`; and, as a separate finding rather than the verdict,
// `full-copy=false` when no level-0 file written after the restart holds every page of the database.
// PASSING result — `RESTART_AT_LIMIT_COMPLETE=true … missing=none integrity=ok daemon-alive=true`.
// CONTROL — the store read BEFORE the restart must hold only the first batch
// (`control-before-restart-rows` equal to `control-expected`), or the line reads `VOID`. The LTX
// decoder has its own control: the first batch's level-9 file starts at transaction 1, which the LTX
// format requires to carry every page, so `l9-control-pages` must equal `l9-control-expected`.
//
// `--no-restart` is the failing case on purpose: phase d starts no daemon, so nothing can upload
// after the fold-back.
import assert from "node:assert";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  LITESTREAM_VERSION,
  replicate,
  resolveLitestream,
  restore,
  writeConfig,
} from "../litestream.ts";
import { openNode, recordSale } from "../model.ts";
import { startStore } from "../store.ts";
import type { Store } from "../store.ts";
import { createUnreachableStore } from "../unreachable-store.ts";
import {
  STORE_DEADLINE_MS,
  bySegment,
  checkpoint,
  integrityOf,
  listObjects,
  missingRanges,
  problemLines,
  report,
  restoredRows,
  rowsIn,
  sell,
  sleep,
  waitForAttach,
  waitForStoredRows,
  walBytes,
} from "./common.ts";
import type { RecordedRow, StoredObject } from "./common.ts";

const PROBE = "m1b-restart-at-limit";
const GENERATION = "gen-1-box-a-20260924T000000Z";
const PREFIX = `venues/v1/${GENERATION}`;
const LEVEL0 = `${PREFIX}/0000/`;
const LIMIT_BYTES = 268_435_456;
const STREAMED = 20; // a — reachable daemon
const MAX_OFFLINE_SALES = 40_000; // b — a bound, not a target: the loop stops at LIMIT_BYTES
const PAUSED = 20; // d — nothing attached, after the fold-back
const AFTER_RESTART = 20; // d — right after the restart
const AFTER_COPY = 20; // d — once a restore holds every sale before them
/** Measurement 1's wait for an offline daemon to reopen a database it already knows. */
const OFFLINE_ATTACH_MS = 3_000;
/**
 * Phase b sells in rounds with an idle pause after each, S4's and measurement 2's cadence, so the
 * offline daemon is attached for tens of seconds while the side file grows. Unpaced, the first run
 * (2026-09-24) reached the limit in 825 ms.
 */
const OFFLINE_ROUND = 400;
const OFFLINE_IDLE_MS = 1_500;
const POLL_MS = 100;

type LtxFile = {
  key: string;
  bytes: number;
  pageSize: number;
  commit: number;
  minTxid: number;
  maxTxid: number;
  pages: number;
  /** Pages 1..commit, less SQLite's lock page when the database reaches it. */
  expectedFull: number;
};

/**
 * Walk an LTX file's page frames without decompressing them. The layout is superfly/ltx v0.5.2's
 * (the version string the pinned binary carries): a 100-byte big-endian header, then per page a
 * 4-byte page number, a 2-byte flags word and, with flag bit 0 set, a 4-byte length and that many
 * LZ4 bytes; a zero page number ends the pages, followed by a page index, its 8-byte length and a
 * 16-byte trailer. The last check refuses a walk that does not land exactly on that index.
 */
function decodeLtx(key: string, data: Uint8Array): LtxFile {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = new TextDecoder().decode(data.subarray(0, 4));
  if (magic !== "LTX1") throw new Error(`${key}: magic ${JSON.stringify(magic)}, not LTX1`);
  const pageSize = view.getUint32(8);
  const commit = view.getUint32(12);
  const minTxid = Number(view.getBigUint64(16));
  const maxTxid = Number(view.getBigUint64(24));
  let offset = 100;
  const pgnos = new Set<number>();
  for (;;) {
    const pgno = view.getUint32(offset);
    const flags = view.getUint16(offset + 4);
    offset += 6;
    if (pgno === 0) break;
    if ((flags & 1) === 0) throw new Error(`${key}: page ${pgno} has no length field`);
    offset += 4 + view.getUint32(offset);
    pgnos.add(pgno);
  }
  const indexBytes = Number(view.getBigUint64(data.byteLength - 16 - 8));
  if (offset + indexBytes + 8 + 16 !== data.byteLength) {
    throw new Error(`${key}: page walk ended at ${offset}, the index says it should not`);
  }
  const lockPgno = Math.floor(1_073_741_824 / pageSize) + 1;
  return {
    key,
    bytes: data.byteLength,
    pageSize,
    commit,
    minTxid,
    maxTxid,
    pages: pgnos.size,
    expectedFull: commit >= lockPgno ? commit - 1 : commit,
  };
}

async function fetchLtx(store: Store, object: StoredObject): Promise<LtxFile> {
  const output = await store.client.send(
    new GetObjectCommand({ Bucket: store.bucket, Key: object.key }),
  );
  if (!output.Body) throw new Error(`no body for ${object.key}`);
  return decodeLtx(object.key, await output.Body.transformToByteArray());
}

function dirBytes(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += statSync(join(entry.parentPath, entry.name)).size;
  }
  return total;
}

/** Restores back to back until one holds `expected` rows; each attempt gets a fresh path. */
async function pollRestore(args: {
  bin: string;
  config: string;
  dbPath: string;
  dir: string;
  tag: string;
  expected: number;
}): Promise<{ rows: RecordedRow[]; attempts: number; reached: boolean; lastRestoreMs: number }> {
  const deadline = Date.now() + STORE_DEADLINE_MS;
  let attempts = 0;
  let rows: RecordedRow[] = [];
  let lastRestoreMs = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const started = performance.now();
    const seen = await restoredRows(
      args.bin,
      args.config,
      args.dbPath,
      join(args.dir, `${args.tag}-${attempts}.db`),
    );
    lastRestoreMs = Math.round(performance.now() - started);
    if (seen !== "no-backup") {
      rows = seen;
      if (rows.length >= args.expected) return { rows, attempts, reached: true, lastRestoreMs };
    }
    await sleep(POLL_MS);
  }
  return { rows, attempts, reached: false, lastRestoreMs };
}

async function main(): Promise<void> {
  const noRestart = process.argv.includes("--no-restart");
  const litestream = await resolveLitestream();
  if (!litestream) {
    report(PROBE, "NOT-RUN", {
      reason: `litestream ${LITESTREAM_VERSION} not found; run setup:litestream`,
    });
    process.exitCode = 1;
    return;
  }
  const bin = litestream.bin;
  const store = await startStore();
  const dir = mkdtempSync(join(tmpdir(), "waitron-m1b-"));
  let offlineLog = "";
  let log = "";
  try {
    const dbPath = join(dir, "venue.db");
    const reachable = writeConfig({
      dbPath,
      store,
      prefix: PREFIX,
      configPath: join(dir, "reachable.yml"),
    });
    const offline = await createUnreachableStore();
    const unreachable = writeConfig({
      dbPath,
      store: offline.store,
      prefix: PREFIX,
      configPath: join(dir, "unreachable.yml"),
    });
    const node = openNode("box-a", dbPath);
    let daemon: ReturnType<typeof replicate> | undefined;
    try {
      const journalMode = node.get<{ journal_mode: string }>("PRAGMA journal_mode = WAL");
      assert.equal(journalMode?.journal_mode, "wal", "precondition: the database is in WAL mode");

      // a — stream, and see the store hold it.
      daemon = replicate(bin, reachable);
      await waitForAttach(dbPath);
      sell(node, STREAMED);
      const phaseA = await waitForStoredRows({
        bin,
        config: reachable,
        dbPath,
        dir,
        tag: "a",
        expected: STREAMED,
      });
      assert.ok(phaseA.reached, `precondition: the store never held the first ${STREAMED} sales`);
      daemon.kill();
      await daemon.exited;
      daemon = undefined;

      // b — attached but offline, selling until the side file reaches the limit.
      const offlineState: { exit: number | null | "alive" } = { exit: "alive" };
      daemon = replicate(bin, unreachable, (chunk) => (offlineLog += chunk));
      daemon.exited.then(
        (code) => (offlineState.exit = code),
        () => (offlineState.exit = null),
      );
      await sleep(OFFLINE_ATTACH_MS);
      let offlineSales = 0;
      let maxCommitMs = 0;
      const offlineStarted = performance.now();
      let offlineRounds = 0;
      while (walBytes(dbPath) < LIMIT_BYTES && offlineSales < MAX_OFFLINE_SALES) {
        if (offlineSales > 0 && offlineSales % OFFLINE_ROUND === 0) {
          await sleep(OFFLINE_IDLE_MS);
          offlineRounds += 1;
        }
        const started = performance.now();
        recordSale(node, 1000 + (offlineSales % 997));
        maxCommitMs = Math.max(maxCommitMs, performance.now() - started);
        offlineSales += 1;
      }
      const offlineSellMs = Math.round(performance.now() - offlineStarted);
      const walAtStop = walBytes(dbPath);
      if (walAtStop < LIMIT_BYTES) {
        report(PROBE, "VOID", {
          reason: `side file ${walAtStop} bytes after ${offlineSales} sales; the limit was never reached`,
        });
        return;
      }
      const offlineAliveAtLimit = offlineState.exit === "alive";

      // c — the supervisor's action at the limit: stop Litestream, fold back.
      const stopStarted = performance.now();
      daemon.kill();
      const offlineExit = await daemon.exited;
      const offlineStopMs = Math.round(performance.now() - stopStarted);
      daemon = undefined;
      const foldStarted = performance.now();
      const foldBack = checkpoint(node);
      const foldBackMs = Math.round(performance.now() - foldStarted);
      const walAfterFold = walBytes(dbPath);
      const dbBytes = statSync(dbPath).size;
      const pageSize = Number(node.get<{ page_size: number }>("PRAGMA page_size")?.page_size);
      const sidecarBytes = dirBytes(join(dir, ".venue.db-litestream"));
      assert.equal(
        foldBack.busy,
        0,
        "precondition: with Litestream stopped, the fold-back completes",
      );

      // d — the paused window, then the control: the store must hold only phase a.
      sell(node, PAUSED);
      const before = await restoredRows(bin, reachable, dbPath, join(dir, "control.db"));
      const beforeRows = before === "no-backup" ? 0 : before.length;
      const objectsBefore = await listObjects(store, PREFIX);
      const keysBefore = new Set(objectsBefore.map((object) => object.key));
      const l9 = objectsBefore.find((object) => object.key.startsWith(`${PREFIX}/0009/`));
      const l9Control = l9 ? await fetchLtx(store, l9) : undefined;

      // d — restart against the reachable store, same config, same replica path.
      const state: { exit: number | null | "alive" } = { exit: noRestart ? null : "alive" };
      const restartStarted = performance.now();
      if (!noRestart) {
        daemon = replicate(bin, reachable, (chunk) => (log += chunk));
        daemon.exited.then(
          (code) => (state.exit = code),
          () => (state.exit = null),
        );
      }
      sell(node, AFTER_RESTART);
      const throughRestart = STREAMED + offlineSales + PAUSED + AFTER_RESTART;

      let firstNewL0Ms: number | "none" = "none";
      const listDeadline = Date.now() + STORE_DEADLINE_MS;
      while (Date.now() < listDeadline) {
        const now = await listObjects(store, LEVEL0);
        if (now.some((object) => !keysBefore.has(object.key))) {
          firstNewL0Ms = Math.round(performance.now() - restartStarted);
          break;
        }
        await sleep(POLL_MS);
      }
      const caughtUp = await pollRestore({
        bin,
        config: reachable,
        dbPath,
        dir,
        tag: "upload",
        expected: throughRestart,
      });
      const uploadMs = caughtUp.reached ? Math.round(performance.now() - restartStarted) : "never";

      sell(node, AFTER_COPY);
      const total = throughRestart + AFTER_COPY;
      const tailStarted = performance.now();
      const tail = await pollRestore({
        bin,
        config: reachable,
        dbPath,
        dir,
        tag: "tail",
        expected: total,
      });
      const tailMs = tail.reached ? Math.round(performance.now() - tailStarted) : "never";

      const objectsAfter = await listObjects(store, PREFIX);
      const daemonAlive = state.exit === "alive";
      const newL0 = objectsAfter.filter(
        (object) => object.key.startsWith(LEVEL0) && !keysBefore.has(object.key),
      );
      const decoded: LtxFile[] = [];
      for (const object of newL0) decoded.push(await fetchLtx(store, object));

      // e — stop, restore to a fresh path, check every sale.
      if (daemon) {
        daemon.kill();
        await daemon.exited;
        daemon = undefined;
      }
      const finalPath = join(dir, "final.db");
      let finalRows: RecordedRow[] = [];
      let integrity = "no-backup";
      const finalStarted = performance.now();
      try {
        await restore(bin, reachable, dbPath, finalPath, [], STORE_DEADLINE_MS);
        finalRows = rowsIn(finalPath);
        integrity = integrityOf(finalPath);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes("no matching backup files"))) {
          throw error;
        }
      }
      const finalRestoreMs = Math.round(performance.now() - finalStarted);

      const complete =
        finalRows.length === total && finalRows.every((row, i) => row.secuencia === i + 1);
      const full = decoded.filter(
        (file) => file.pages === file.expectedFull && file.commit * file.pageSize >= dbBytes,
      );
      const largest = [...decoded].sort((a, b) => b.bytes - a.bytes)[0];
      const voided = beforeRows !== STREAMED;
      const verdict = !voided && complete && daemonAlive && integrity === "ok";
      const problems = problemLines(log);
      report(PROBE, voided ? "VOID" : `RESTART_AT_LIMIT_COMPLETE=${verdict}`, {
        version: litestream.version,
        mode: noRestart ? "no-restart" : "restart",
        offline: offline.refusedWith,
        "sales-streamed": STREAMED,
        "sales-offline": offlineSales,
        "sales-paused": PAUSED,
        "sales-after-restart": AFTER_RESTART,
        "sales-after-copy": AFTER_COPY,
        "offline-sell-ms": offlineSellMs,
        "offline-pauses": offlineRounds,
        "max-commit-ms": Math.round(maxCommitMs * 1000) / 1000,
        "wal-limit": LIMIT_BYTES,
        "wal-at-stop": walAtStop,
        "offline-alive-at-limit": offlineAliveAtLimit,
        "offline-stop-ms": offlineStopMs,
        "offline-exit": String(offlineExit),
        "fold-back-busy": foldBack.busy,
        "fold-back-log": foldBack.log,
        "fold-back-checkpointed": foldBack.checkpointed,
        "fold-back-ms": foldBackMs,
        "wal-after-fold": walAfterFold,
        "db-bytes": dbBytes,
        "page-size": pageSize,
        "db-pages": dbBytes / pageSize,
        "sidecar-bytes-at-stop": sidecarBytes,
        "control-before-restart-rows": beforeRows,
        "control-expected": STREAMED,
        "l9-control-pages": l9Control?.pages ?? "none",
        "l9-control-expected": l9Control?.expectedFull ?? "none",
        "restored-rows": finalRows.length,
        expected: total,
        missing: missingRanges(total, finalRows),
        integrity,
        "final-restore-ms": finalRestoreMs,
        "daemon-alive": daemonAlive,
        "objects-before": JSON.stringify(bySegment(objectsBefore, PREFIX)),
        "objects-after": JSON.stringify(bySegment(objectsAfter, PREFIX)),
        "post-restart-l0-files": decoded.length,
        "post-restart-l0-bytes": decoded.reduce((sum, file) => sum + file.bytes, 0),
        "post-restart-l0-largest-bytes": largest?.bytes ?? "none",
        "post-restart-l0-largest-pages": largest?.pages ?? "none",
        "post-restart-l0-largest-commit": largest?.commit ?? "none",
        "post-restart-l0-largest-txids": largest ? `${largest.minTxid}-${largest.maxTxid}` : "none",
        "post-restart-l0": JSON.stringify(
          decoded.map(
            (file) =>
              `${file.minTxid}-${file.maxTxid}:${file.bytes}b:${file.pages}/${file.commit}p`,
          ),
        ),
        "full-copy": full.length > 0,
        "first-new-l0-ms": firstNewL0Ms,
        "upload-ms": uploadMs,
        "upload-restore-attempts": caughtUp.attempts,
        "upload-last-restore-ms": caughtUp.lastRestoreMs,
        "tail-ms": tailMs,
        "log-problems": problems.length,
        "first-problem": problems[0] ?? "none",
        "offline-log-problems": problemLines(offlineLog).length,
      });
    } finally {
      if (daemon) {
        daemon.kill();
        await daemon.exited;
      }
      node.close();
      await offline.store.stop();
    }
  } finally {
    try {
      await store.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

await main().catch((error: unknown) => {
  report(PROBE, "VOID", { reason: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
