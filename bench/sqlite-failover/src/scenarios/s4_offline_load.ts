// S4: what a box that has been offline for days does to its own WAL, and to the cashier's wait
// (spec §4, S4; topology design §13 risk 9 and §10 finding 8).
//
// The shape being measured: topology §4.2 sets `wal_autocheckpoint = 0` so that nothing is
// checkpointed away before litestream has streamed it, which leaves litestream as the only thing
// that checkpoints. A box that cannot reach the store therefore has nobody checkpointing at all,
// and risk 9 asks what that costs — an unbounded WAL, and our own process ending up on the sale
// path.
//
// Three parts:
//   - Part A, the measurement: 30 modelled days of sales with a litestream daemon that cannot reach
//     its store, every commit timed and the WAL watched. Its two latency bars and its WAL ceiling
//     are read off the measurement into the verdict rather than asserted, because a breach here is a
//     recorded caveat and not a stop (spec §7). Its one hard assertion is a PRECONDITION — the WAL
//     really did accumulate.
//   - Part B, the control: the SAME load, round for round and pause for pause, against a REACHABLE
//     store, where the WAL has to plateau. Without it, Part A's growing WAL is equally consistent
//     with "this write volume always makes this much WAL" and both answers would look alike
//     (`CLAUDE.md` §1). The two arms differ in ONE thing, the store's reachability, and that took a
//     restructure to be true: measured 2026-09-18, an arm that drives 7500 sales back to back
//     finishes in about a second and its WAL reaches 310MB whether the store is reachable or not,
//     because litestream never gets a turn. Both arms now pause between rounds — see `IDLE_MS`.
//   - Part C, a MEASUREMENT that decides nothing, the way S3's Part C does: what it costs US to get
//     that WAL back, with the offline daemon running and again with it gone. That pair is the answer
//     to risk 9's second half and it feeds the detail alone.
//
// What this scenario is NOT evidence about: `packages/fiscal-verifactu` — every table here is the
// rig's MODEL (`model.ts`), so what a commit costs in pages is this schema's and not the product's;
// anything that turns on elapsed time, because the load is volume and not wall-clock; and whether
// litestream RETRIED the unreachable endpoint and failed or simply did nothing, which nothing here
// observes.
import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LITESTREAM_VERSION, replicate, resolveLitestream, writeConfig } from "../litestream.ts";
import { openNode, recordSale } from "../model.ts";
import type { NodeDb } from "../model.ts";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";
import type { Store } from "../store.ts";
import { createUnreachableStore } from "../unreachable-store.ts";

/** Topology §2.2 gives each venue one prefix in the store; `v1` is this rig's venue. */
const VENUE = "venues/v1";
const NODE = "box-a";
const OFFLINE_PREFIX = `${VENUE}/gen-1-${NODE}`;
const CONTROL_PREFIX = `${VENUE}/gen-2-${NODE}`;

/**
 * The volume mapping, and it is VOLUME rather than wall-clock (spec §9, "a multi-day load is
 * compressed"): 30 days of a deli's trading driven through in half a minute. So this scenario says
 * nothing about anything that turns on elapsed time — a nightly job, a retention window, a
 * clock-driven compaction.
 *
 * **250 sales a day is an ASSUMPTION, not a measurement.** Nothing in this repository records the
 * deli's real ticket count. The nearest stated figure is `bench/pglite-throughput/src/bench.ts:60-78`,
 * which models the deli's worst realistic MINUTE — 16 sales a minute across four tills — and a
 * peak-minute figure implies no daily total whatever. Every number recorded below is therefore
 * reported PER SALE as well as per run, so a reader who knows the real day rate can rescale it.
 */
const SALES_PER_DAY = 250;
const DAYS = 30;
const SALES = SALES_PER_DAY * DAYS;

/**
 * The latency bars, taken from the pglite bench rather than invented here:
 * `bench/pglite-throughput/src/bench.ts:82-83` sets `maxP95Ms: 150` and `maxP99Ms: 400`. Their
 * justification is the cashier's perceived wait, stated at
 * `bench/pglite-throughput/src/bench.ts:75-78` — the receipt cannot print until the transaction
 * commits, 150ms at p95 keeps that below the wait a person notices, and 400ms at p99 keeps the
 * worst sale of a rush from feeling like a queue. Reusing them is what spec §4's S4 asks for.
 */
const MAX_P95_MS = 150;
const MAX_P99_MS = 400;

/**
 * The WAL ceiling, and it is a STATED ceiling and not a derived one. Nothing in this repository
 * records the appliance's partition size, so this is NOT a disk guarantee and must not be read as
 * one. What it tests is the SHAPE of the growth: it sits well above what a commit in this model's
 * schema costs, so a run that breaches it grew super-linearly — the unbounded case risk 9 names —
 * rather than merely growing.
 */
const MAX_WAL_BYTES_PER_SALE = 64 * 1024;

/**
 * A FLOOR on the same number, and a precondition rather than a bar on the product: below one SQLite
 * page per commit (4096 bytes is the default page size) something checkpointed the WAL, and then
 * nothing in Part A is measuring an offline WAL at all. `recordSale` writes five rows across five
 * tables and their indexes in one transaction, so a commit here touches several pages; the floor
 * sits far under that deliberately, because its job is to catch a checkpoint that happened rather
 * than to pin a page count. It bites: with `wal_autocheckpoint = 0` dropped AND no daemon running,
 * this arm measured 559 bytes a sale and the assertion is what refused the run (2026-09-18).
 */
const MIN_WAL_BYTES_PER_SALE = 4 * 1024;

/**
 * Both arms drive the load in rounds with an idle pause between them, and the pause is what makes
 * the two arms differ in ONE thing.
 *
 * It is not a model of a trading day — the load is still volume rather than wall-clock. It is there
 * because litestream checkpoints on its own schedule: driven back to back, 7500 sales finish in
 * about a second, and the WAL reaches 310MB whether the store is reachable or not (measured
 * 2026-09-18, with the offline arm pointed at a live MinIO: `peak-wal-bytes=310759272`, unchanged).
 * Both arms now get the same idle, so what separates them is reachability alone.
 *
 * 1500ms is roughly half again the longest wait the reachable arm has needed for a checkpoint —
 * 754-1009ms over fifteen rounds on the recorded run. It is a cadence this rig CHOSE, not one
 * litestream documents.
 */
const ROUNDS = 15;
const SALES_PER_ROUND = SALES / ROUNDS;
const IDLE_MS = 1_500;

/**
 * How long the daemon is given to open the database before a load starts, watched by polling for the
 * sidecar directory litestream creates beside it. Waiting matters: a daemon that had not attached
 * yet would leave Part A measuring a database nobody was holding, which is the other arm's case.
 */
const ATTACH_DEADLINE_MS = 30_000;

/**
 * Part A's peak WAL must be at least this many times Part B's for the control to have shown
 * anything. The recorded run reads about 15x. Four is the stated bar: low enough that what it tests
 * is the PLATEAU and not an exact ratio, and high enough that a control where nothing checkpointed —
 * which lands at 1x, the same load making the same WAL — fails it.
 */
const PLATEAU_FACTOR = 4;

/** Bytes in a gibibyte, for the offline-days-per-GiB figure slice 2 needs. */
const GIB = 1024 * 1024 * 1024;

type LatencySummary = { p50: number; p95: number; p99: number; max: number };

/** What driving the load measured, in whichever arm drove it. */
type Load = {
  latency: LatencySummary;
  firstDayP95: number;
  lastDayP95: number;
  peakWalBytes: number;
  endWalBytes: number;
  dbBytes: number;
  /** Rounds whose idle pause left the main database file larger — where a checkpoint moves pages. */
  checkpointRounds: number;
};

/** One `PRAGMA wal_checkpoint(TRUNCATE)` from our own connection, timed. */
type Reclaim = {
  ms: number;
  /** SQLite's own answer row: `busy` is 1 when the checkpoint could not finish. */
  row: { busy: number; log: number; checkpointed: number };
  walBefore: number;
  walAfter: number;
};

type OfflineArm = {
  load: Load;
  walBytesPerSale: number;
  /** The refusal code the unreachable endpoint's probe got back, or why no daemon ran. */
  daemonNote: string;
  attachedMs: number | null;
  /**
   * Whether the daemon was still running when the load finished, read BEFORE Part C kills it. It
   * answers one half of what an unreachable endpoint does to litestream 0.5.17 — it does not exit.
   * The other half, whether it retried the store and failed or did nothing at all, is not observed.
   */
  daemonAliveAfterLoad: boolean;
  /** Null when no litestream was found, so there was no offline daemon to be held up by. */
  reclaimOffline: Reclaim | null;
  /** A sale taken straight after the held-up checkpoint, while the daemon was still running. */
  nextSaleMs: number | null;
  reclaimControl: Reclaim;
  /** The database's size after the checkpoint that actually completed. */
  checkpointedDbBytes: number;
};

type ControlArm = { load: Load; storeKeys: number };

export default async function offlineLoad({
  startStore,
}: ScenarioContext): Promise<ScenarioResult> {
  const litestream = await resolveLitestream();
  const dir = mkdtempSync(join(tmpdir(), "waitron-s4-"));
  let store: Store | undefined;
  try {
    const offline = await runOfflineArm(litestream?.bin, dir);

    // The store is started only now, and only when there is a litestream to stream with: Part A
    // needs no container, and one held up through Part A's load and Part C's twelve-second
    // checkpoint would be a container running for nothing.
    let control: ControlArm | undefined;
    if (litestream) {
      store = await startStore();
      control = await runControlArm(litestream.bin, store, dir);
      assert.ok(
        control.load.peakWalBytes * PLATEAU_FACTOR <= offline.load.peakWalBytes,
        `with the store reachable the WAL plateaus: ${control.load.peakWalBytes} bytes against the offline arm's ${offline.load.peakWalBytes} for the same ${SALES} sales, which is under ${PLATEAU_FACTOR}x apart`,
      );
    }

    const amplification = round(offline.load.peakWalBytes / offline.checkpointedDbBytes, 1);
    const offlineDaysPerGib = round(GIB / offline.walBytesPerSale / SALES_PER_DAY, 1);
    const breaches = [
      offline.load.latency.p95 > MAX_P95_MS
        ? `p95-ms=${offline.load.latency.p95}>${MAX_P95_MS}`
        : "",
      offline.load.latency.p99 > MAX_P99_MS
        ? `p99-ms=${offline.load.latency.p99}>${MAX_P99_MS}`
        : "",
      offline.walBytesPerSale > MAX_WAL_BYTES_PER_SALE
        ? `wal-bytes-per-sale=${offline.walBytesPerSale}>${MAX_WAL_BYTES_PER_SALE}`
        : "",
    ].filter((breach) => breach !== "");

    return {
      id: "S4",
      title: "offline write load",
      // The verdict is read off the measurement rather than off a passing assertion, the way S2's
      // is — and a breached bar is a recorded caveat, never a stop (spec §7), so `critical` is false
      // on every path out of here.
      verdict: breaches.length > 0 ? "FAIL" : "MEASURED",
      critical: false,
      detail:
        `version=${litestream?.version ?? "absent"} sales=${SALES} days=${DAYS} sales-per-day=${SALES_PER_DAY} day-rate=assumed-not-measured ` +
        `rounds=${ROUNDS} idle-ms=${IDLE_MS} ` +
        `offline-daemon=${offline.daemonNote} offline-attach-ms=${offline.attachedMs ?? "n/a"} offline-daemon-alive-after-load=${offline.daemonAliveAfterLoad} ` +
        `p50-ms=${offline.load.latency.p50} p95-ms=${offline.load.latency.p95} p99-ms=${offline.load.latency.p99} max-ms=${offline.load.latency.max} ` +
        `first-day-p95-ms=${offline.load.firstDayP95} last-day-p95-ms=${offline.load.lastDayP95} ` +
        `peak-wal-bytes=${offline.load.peakWalBytes} wal-bytes-per-sale=${offline.walBytesPerSale} offline-checkpoint-rounds=${offline.load.checkpointRounds}/${ROUNDS} ` +
        `checkpointed-db-bytes=${offline.checkpointedDbBytes} wal-amplification=${amplification}x ` +
        // RECORDED, not asserted, and it is the spec's own example ceiling failing: spec §4's S4
        // offers "a small multiple of the streamed data", and this many times over is not a small
        // multiple. The bar actually used is `MAX_WAL_BYTES_PER_SALE`, and saying so here is the
        // point — a bar that passes was not substituted quietly.
        `spec-small-multiple-ceiling=not-met ` +
        `offline-days-per-gib=${offlineDaysPerGib} ` +
        `reclaim-offline=${reclaimText(offline.reclaimOffline)} reclaim-next-sale-ms=${offline.nextSaleMs ?? "n/a"} ` +
        `reclaim-control=${reclaimText(offline.reclaimControl)} ` +
        `control=${controlText(control)} ` +
        `breaches=${breaches.length === 0 ? "none" : `"${breaches.join(" ")}"`}`,
    };
  } finally {
    // The store is stopped FIRST, for the reason `s_smoke.ts` records: a throw ahead of `stop()`
    // would leave the MinIO container running, and `pnpm reap` ignores a container younger than two
    // hours, so nothing would clear it for the rest of the session. The directory goes last, and it
    // holds a few hundred megabytes of WAL.
    if (store) await store.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Parts A and C — the offline load, then the two reclaim measurements, on one node whose handle
 * stays open across all three.
 *
 * The two pragmas risk 9 is conditioned on are set AND READ BACK. A pragma that silently did not
 * take is the classic way this measurement would measure nothing: SQLite answers
 * `PRAGMA journal_mode = WAL` with the mode the database ended up in, which is not always the one
 * asked for.
 */
async function runOfflineArm(bin: string | undefined, dir: string): Promise<OfflineArm> {
  const dbPath = join(dir, "offline.db");
  const node = openNode(NODE, dbPath);
  let daemon: ReturnType<typeof replicate> | undefined;
  let daemonAlive = false;
  let daemonNote = `no-litestream-v${LITESTREAM_VERSION}`;
  let attachedMs: number | null = null;

  try {
    assertPragmas(node);

    if (bin) {
      const unreachable = await createUnreachableStore();
      daemonNote = unreachable.refusedWith;
      const config = writeConfig({
        dbPath,
        store: unreachable.store,
        prefix: OFFLINE_PREFIX,
        configPath: join(dir, "offline.yml"),
      });
      daemon = replicate(bin, config);
      daemonAlive = true;
      // A daemon that died on its own would make every reading below one about a database nobody
      // was holding, which is the case Part C contrasts with.
      daemon.exited.then(() => (daemonAlive = false)).catch(() => (daemonAlive = false));
      attachedMs = await waitForAttach(dbPath);
    }

    const load = await driveLoad(node, dbPath);
    const walBytesPerSale = Math.round(load.peakWalBytes / SALES);
    assert.ok(
      walBytesPerSale >= MIN_WAL_BYTES_PER_SALE,
      `the offline arm's WAL grew ${walBytesPerSale} bytes a sale, under one page — something checkpointed it, so nothing here is measuring an offline WAL`,
    );

    const daemonAliveAfterLoad = daemonAlive;
    // Part C, first arm: our own process asking for the WAL back while the offline daemon holds the
    // database. This is risk 9's second half — "put our own process on the sale path" — and it is
    // RECORDED whatever it says.
    const reclaimOffline = daemon ? reclaim(node, dbPath) : null;
    const nextSaleMs = daemon ? timeOneSale(node) : null;

    if (daemon) {
      daemon.kill();
      await daemon.exited;
      daemon = undefined;
    }
    // Part C, second arm: the control, with nothing holding the file.
    const reclaimControl = reclaim(node, dbPath);

    return {
      load,
      walBytesPerSale,
      daemonNote,
      attachedMs,
      daemonAliveAfterLoad,
      reclaimOffline,
      nextSaleMs,
      reclaimControl,
      // Taken after the checkpoint that actually COMPLETES: the held-up one moves almost no pages,
      // so a size read after it would describe a checkpoint that did not happen.
      checkpointedDbBytes: statSync(dbPath).size,
    };
  } finally {
    // Order: the daemon goes first and is AWAITED, then the node's handle, and only then may the
    // caller's `finally` remove the files. A litestream child left holding this database would
    // outlive the scenario.
    if (daemon) {
      daemon.kill();
      await daemon.exited;
    }
    node.close();
  }
}

/**
 * Part B — the control. The same pragmas and the same load, round for round and pause for pause,
 * with the config naming a REACHABLE store instead of a closed port.
 *
 * It asserts nothing itself: the plateau assertion lives in the caller, where both arms' numbers
 * are, which is where the sentence being tested is.
 */
async function runControlArm(bin: string, store: Store, dir: string): Promise<ControlArm> {
  const dbPath = join(dir, "control.db");
  const node = openNode(NODE, dbPath);
  let daemon: ReturnType<typeof replicate> | undefined;

  try {
    assertPragmas(node);
    const config = writeConfig({
      dbPath,
      store,
      prefix: CONTROL_PREFIX,
      configPath: join(dir, "control.yml"),
    });
    daemon = replicate(bin, config);
    await waitForAttach(dbPath);

    const load = await driveLoad(node, dbPath);
    return { load, storeKeys: (await store.listKeys(CONTROL_PREFIX)).length };
  } finally {
    if (daemon) {
      daemon.kill();
      await daemon.exited;
    }
    node.close();
  }
}

/**
 * The load both arms drive: `ROUNDS` rounds of `SALES_PER_ROUND` sales, every commit timed, an idle
 * pause after each round, and the WAL read on both sides of that pause.
 */
async function driveLoad(node: NodeDb, dbPath: string): Promise<Load> {
  const latencies: number[] = [];
  let peakWalBytes = 0;
  let checkpointRounds = 0;

  for (let round = 0; round < ROUNDS; round += 1) {
    const dbBefore = statSync(dbPath).size;
    for (let i = 0; i < SALES_PER_ROUND; i += 1) {
      const started = performance.now();
      recordSale(node, 1000 + (i % 997));
      latencies.push(performance.now() - started);
    }
    // Both readings are outside the timed region. The second one matters: a checkpoint during the
    // idle can leave the WAL file at its high-water mark while reusing the space inside it, so the
    // peak has to be read before the pause as well as after.
    peakWalBytes = Math.max(peakWalBytes, walBytes(dbPath));
    await sleep(IDLE_MS);
    peakWalBytes = Math.max(peakWalBytes, walBytes(dbPath));
    // The main database file growing is where a checkpoint moves pages TO, so it is the cheapest
    // evidence that one happened at all. It counts rounds and decides nothing.
    if (statSync(dbPath).size > dbBefore) checkpointRounds += 1;
  }

  return {
    latency: summarise(latencies),
    // Bucketed by modelled DAY so drift is visible: a commit cost that grew with the WAL would show
    // as the last day's p95 above the first day's, and an overall percentile would hide it.
    firstDayP95: round(percentile(sorted(latencies.slice(0, SALES_PER_DAY)), 95), 3),
    lastDayP95: round(percentile(sorted(latencies.slice(SALES - SALES_PER_DAY)), 95), 3),
    peakWalBytes,
    endWalBytes: walBytes(dbPath),
    dbBytes: statSync(dbPath).size,
    checkpointRounds,
  };
}

/**
 * One `PRAGMA wal_checkpoint(TRUNCATE)` from OUR connection, timed, with the WAL read either side.
 *
 * `TRUNCATE` rather than `PASSIVE` because the question is whether we can get the disk back: a
 * passive checkpoint that restarts the WAL leaves the file at its high-water mark, so its size alone
 * would not say whether anything was reclaimed.
 */
function reclaim(node: NodeDb, dbPath: string): Reclaim {
  const walBefore = walBytes(dbPath);
  const started = performance.now();
  const row = node.get<{ busy: number; log: number; checkpointed: number }>(
    "PRAGMA wal_checkpoint(TRUNCATE)",
  );
  const ms = round(performance.now() - started, 1);
  return {
    ms,
    row: {
      busy: Number(row?.busy ?? -1),
      log: Number(row?.log ?? -1),
      checkpointed: Number(row?.checkpointed ?? -1),
    },
    walBefore,
    walAfter: walBytes(dbPath),
  };
}

function timeOneSale(node: NodeDb): number {
  const started = performance.now();
  recordSale(node, 4242);
  return round(performance.now() - started, 3);
}

/**
 * Wait for litestream to have OPENED the database, observed as the sidecar directory it creates
 * beside the file — `.<name>-litestream` on this pin, which a listing taken 1.5s after the daemon
 * spawned showed and one taken at 1.0s did not (2026-09-18, litestream 0.5.17). It is an
 * implementation detail of the pin and not a documented interface, which is why not seeing it is
 * reported rather than assumed away.
 */
async function waitForAttach(dbPath: string): Promise<number> {
  const separator = dbPath.lastIndexOf("/");
  const marker = join(dbPath.slice(0, separator), `.${dbPath.slice(separator + 1)}-litestream`);
  const started = Date.now();
  while (Date.now() - started < ATTACH_DEADLINE_MS) {
    if (existsSync(marker)) return Date.now() - started;
    await sleep(100);
  }
  throw new Error(
    `litestream did not open ${dbPath} within ${ATTACH_DEADLINE_MS}ms — no ${marker}, so the daemon never attached and nothing below is measuring a database it holds`,
  );
}

/**
 * Both pragmas, set and read back. `journal_mode` is answered with the mode the database is in, so
 * the readback is the only thing separating "asked for WAL" from "is in WAL".
 */
function assertPragmas(node: NodeDb): void {
  const mode = node.get<{ journal_mode: string }>("PRAGMA journal_mode = WAL");
  assert.equal(String(mode?.journal_mode), "wal", "the database is in WAL journal mode");
  node.exec("PRAGMA wal_autocheckpoint = 0");
  const auto = node.get<{ wal_autocheckpoint: number }>("PRAGMA wal_autocheckpoint");
  assert.equal(
    Number(auto?.wal_autocheckpoint),
    0,
    "automatic checkpointing is off, which is the condition risk 9 is about",
  );
}

function reclaimText(value: Reclaim | null): string {
  if (!value) return `no-litestream-v${LITESTREAM_VERSION}`;
  const shrank = value.walAfter < value.walBefore;
  return `"ms=${value.ms} busy=${value.row.busy} log=${value.row.log} checkpointed=${value.row.checkpointed} wal=${value.walBefore}->${value.walAfter} shrank=${shrank}"`;
}

function controlText(value: ControlArm | undefined): string {
  if (!value) return `no-litestream-v${LITESTREAM_VERSION}`;
  return `"peak-wal=${value.load.peakWalBytes} end-wal=${value.load.endWalBytes} db=${value.load.dbBytes} store-keys=${value.storeKeys} checkpoint-rounds=${value.load.checkpointRounds}/${ROUNDS} p95-ms=${value.load.latency.p95} p99-ms=${value.load.latency.p99}"`;
}

/** The `-wal` sidecar's size, or 0 when SQLite has not created it. */
function walBytes(dbPath: string): number {
  const path = `${dbPath}-wal`;
  return existsSync(path) ? statSync(path).size : 0;
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Nearest-rank, over an ascending list. */
function percentile(ascending: number[], p: number): number {
  const rank = Math.ceil((p / 100) * ascending.length);
  return ascending[Math.min(ascending.length - 1, Math.max(0, rank - 1))] ?? 0;
}

function summarise(values: number[]): LatencySummary {
  const ascending = sorted(values);
  return {
    p50: round(percentile(ascending, 50), 3),
    p95: round(percentile(ascending, 95), 3),
    p99: round(percentile(ascending, 99), 3),
    max: round(ascending[ascending.length - 1] ?? 0, 3),
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
