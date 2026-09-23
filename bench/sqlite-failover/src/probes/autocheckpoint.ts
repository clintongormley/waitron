// Measurement 2 (slice-2 spec §8.1 item 2): should SQLite's automatic fold-back be switched off?
//
// `packages/store` keeps SQLite's default (fold back every 1000 pages). The topology design §8.3 says
// to switch it off once Litestream runs. Four arms, one variable at a time:
//   A  default fold-back, bucket reachable      — the configuration slice 2 would ship if false
//   B  fold-back off (0), bucket reachable      — S4's control configuration, for comparison
//   C  default fold-back, bucket unreachable    — the CONTROL in the other direction: the side file
//                                                  must grow here, or this probe cannot see growth
//   D  default, unreachable, 15,000 sales       — arm 2b: past Litestream's documented emergency
//                                                  threshold, `truncate-page-n` (default 121359 pages,
//                                                  "~500MB"; litestream.io/reference/config, 2026-09-23)
//
// FAILING result for keeping the default — prints `AUTOCHECKPOINT_OFF_NEEDED=true` because arm A's
// restore is incomplete, its integrity check is not `ok`, Litestream logged a WARN/ERROR line, its
// peak side file is larger than arm B's, or it uploaded more than STORE_BYTES_FACTOR times arm B's
// bytes (the sign of repeated full copies).
// PASSING result — `AUTOCHECKPOINT_OFF_NEEDED=false` with `A-restore-complete=true A-integrity=ok
// A-log-problems=0` and A's peak at or below B's.
// VOID — arm C grew under 4096 bytes a sale (a probe that cannot see growth measured nothing), or
// arm B's own restore failed (the restore reading is broken).
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LITESTREAM_VERSION,
  replicate,
  resolveLitestream,
  syncOnce,
  writeConfig,
} from "../litestream.ts";
import { openNode } from "../model.ts";
import { startStore } from "../store.ts";
import type { Store } from "../store.ts";
import { createUnreachableStore } from "../unreachable-store.ts";
import {
  driveLoad,
  integrityOf,
  listObjects,
  problemLines,
  report,
  restoredRows,
  waitForAttach,
} from "./common.ts";

const PROBE = "m2-autocheckpoint";
const SALES = 7_500;
const THRESHOLD_SALES = 15_000;
const ROUNDS = 15;
const IDLE_MS = 1_500;
/** SQLite's documented default for `wal_autocheckpoint`, read back rather than assumed. */
const SQLITE_DEFAULT_AUTOCHECKPOINT = 1000;
/** Litestream's documented `truncate-page-n` default at SQLite's default 4096-byte page. */
const TRUNCATE_THRESHOLD_BYTES = 121_359 * 4096;
/** Below one page a sale, something folded the side file back (S4's `MIN_WAL_BYTES_PER_SALE`). */
const MIN_OFFLINE_WAL_PER_SALE = 4096;
/** How many times arm B's upload arm A may make before it reads as repeated full copies. A stated bar. */
const STORE_BYTES_FACTOR = 2;

type Arm = { name: "A" | "B" | "C" | "D"; reachable: boolean; foldBackOff: boolean; sales: number };
type ArmResult = {
  autocheckpoint: number;
  peakWalBytes: number;
  walPerSale: number;
  maxCommitMs: number;
  p99Ms: number;
  walByRound: number[];
  daemonAlive: boolean;
  restoreComplete: boolean | null;
  integrity: string | null;
  storeBytes: number | null;
  problems: string[];
};

const ARMS: Arm[] = [
  { name: "A", reachable: true, foldBackOff: false, sales: SALES },
  { name: "B", reachable: true, foldBackOff: true, sales: SALES },
  { name: "C", reachable: false, foldBackOff: false, sales: SALES },
  { name: "D", reachable: false, foldBackOff: false, sales: THRESHOLD_SALES },
];

async function runArm(bin: string, arm: Arm, store: Store, dir: string): Promise<ArmResult> {
  const dbPath = join(dir, `${arm.name}.db`);
  const prefix = `venues/v1/gen-1-arm${arm.name.toLowerCase()}-20260923T000000Z`;
  const node = openNode("box-a", dbPath);
  const offline = arm.reachable ? undefined : await createUnreachableStore();
  let daemon: ReturnType<typeof replicate> | undefined;
  let log = "";
  try {
    const mode = node.get<{ journal_mode: string }>("PRAGMA journal_mode = WAL");
    assert.equal(
      String(mode?.journal_mode),
      "wal",
      "the database is in WAL mode, as packages/store opens it",
    );
    if (arm.foldBackOff) node.exec("PRAGMA wal_autocheckpoint = 0");
    const autocheckpoint = Number(
      node.get<{ wal_autocheckpoint: number }>("PRAGMA wal_autocheckpoint")?.wal_autocheckpoint,
    );
    assert.equal(
      autocheckpoint,
      arm.foldBackOff ? 0 : SQLITE_DEFAULT_AUTOCHECKPOINT,
      `arm ${arm.name}'s fold-back setting read back`,
    );

    const config = writeConfig({
      dbPath,
      store: offline ? offline.store : store,
      prefix,
      configPath: join(dir, `${arm.name}.yml`),
    });
    const state = { alive: true };
    daemon = replicate(bin, config, (chunk) => {
      log += chunk;
    });
    daemon.exited.then(
      () => (state.alive = false),
      () => (state.alive = false),
    );
    await waitForAttach(dbPath);
    const load = await driveLoad(node, dbPath, arm.sales, ROUNDS, IDLE_MS);
    const daemonAlive = state.alive;
    daemon.kill();
    await daemon.exited;
    daemon = undefined;

    let restoreComplete: boolean | null = null;
    let integrity: string | null = null;
    let storeBytes: number | null = null;
    if (arm.reachable) {
      await syncOnce(bin, config);
      const out = join(dir, `${arm.name}-restored.db`);
      const rows = await restoredRows(bin, config, dbPath, out);
      restoreComplete =
        rows !== "no-backup" &&
        rows.length === arm.sales &&
        rows.every((row, i) => row.secuencia === i + 1);
      integrity = rows === "no-backup" ? "no-restore" : integrityOf(out);
      storeBytes = (await listObjects(store, prefix)).reduce((sum, object) => sum + object.size, 0);
    }
    return {
      autocheckpoint,
      peakWalBytes: load.peakWalBytes,
      walPerSale: Math.round(load.peakWalBytes / arm.sales),
      maxCommitMs: load.maxMs,
      p99Ms: load.p99Ms,
      walByRound: load.walByRound,
      daemonAlive,
      restoreComplete,
      integrity,
      storeBytes,
      problems: problemLines(log),
    };
  } finally {
    if (daemon) {
      daemon.kill();
      await daemon.exited;
    }
    try {
      if (offline) await offline.store.stop();
    } finally {
      node.close();
    }
  }
}

async function main(): Promise<void> {
  const litestream = await resolveLitestream();
  if (!litestream) {
    report(PROBE, "NOT-RUN", {
      reason: `litestream ${LITESTREAM_VERSION} not found; run setup:litestream`,
    });
    process.exitCode = 1;
    return;
  }
  const store = await startStore();
  const dir = mkdtempSync(join(tmpdir(), "waitron-m2-"));
  try {
    const results: Record<Arm["name"], ArmResult> = {} as Record<Arm["name"], ArmResult>;
    for (const arm of ARMS) results[arm.name] = await runArm(litestream.bin, arm, store, dir);
    const { A, B, C, D } = results;

    const voided =
      C.walPerSale < MIN_OFFLINE_WAL_PER_SALE || B.restoreComplete !== true || B.integrity !== "ok";
    const offNeeded =
      A.restoreComplete !== true ||
      A.integrity !== "ok" ||
      A.problems.length > 0 ||
      A.peakWalBytes > B.peakWalBytes ||
      (A.storeBytes ?? 0) > STORE_BYTES_FACTOR * (B.storeBytes ?? 0);
    const crossed = D.walByRound.findIndex((bytes) => bytes >= TRUNCATE_THRESHOLD_BYTES);
    const shrankAfterThreshold =
      crossed !== -1 &&
      D.walByRound.slice(crossed + 1).some((bytes, i) => bytes < D.walByRound[crossed + i]!);

    report(PROBE, voided ? "VOID" : `AUTOCHECKPOINT_OFF_NEEDED=${offNeeded}`, {
      version: litestream.version,
      sales: SALES,
      rounds: ROUNDS,
      "idle-ms": IDLE_MS,
      "A-autocheckpoint": A.autocheckpoint,
      "A-peak-wal": A.peakWalBytes,
      "A-restore-complete": A.restoreComplete,
      "A-integrity": A.integrity,
      "A-store-bytes": A.storeBytes,
      "A-log-problems": A.problems.length,
      "A-first-problem": A.problems[0] ?? "none",
      "A-p99-ms": A.p99Ms,
      "B-autocheckpoint": B.autocheckpoint,
      "B-peak-wal": B.peakWalBytes,
      "B-restore-complete": B.restoreComplete,
      "B-integrity": B.integrity,
      "B-store-bytes": B.storeBytes,
      "B-log-problems": B.problems.length,
      "C-wal-per-sale": C.walPerSale,
      "C-daemon-alive": C.daemonAlive,
      "D-sales": THRESHOLD_SALES,
      "D-peak-wal": D.peakWalBytes,
      "D-threshold-bytes": TRUNCATE_THRESHOLD_BYTES,
      "D-crossed-threshold": crossed !== -1,
      "D-shrank-after-threshold": shrankAfterThreshold,
      "D-max-commit-ms": D.maxCommitMs,
      "D-p99-ms": D.p99Ms,
      "D-daemon-alive": D.daemonAlive,
      "D-log-problems": D.problems.length,
      "D-wal-by-round": D.walByRound.join(","),
    });
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
