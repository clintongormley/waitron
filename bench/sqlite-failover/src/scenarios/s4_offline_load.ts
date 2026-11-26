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

const VENUE = "venues/v1";
const NODE = "box-a";
const OFFLINE_PREFIX = `${VENUE}/gen-1-${NODE}`;
const CONTROL_PREFIX = `${VENUE}/gen-2-${NODE}`;

const SALES_PER_DAY = 250;
const DAYS = 30;
const SALES = SALES_PER_DAY * DAYS;

const MAX_P95_MS = 150;
const MAX_P99_MS = 400;

const MAX_WAL_BYTES_PER_SALE = 64 * 1024;

const SPEC_SMALL_MULTIPLE = 10;

const MIN_WAL_BYTES_PER_SALE = 4 * 1024;

const ROUNDS = 15;
const SALES_PER_ROUND = SALES / ROUNDS;
const IDLE_MS = 1_500;

/**
 * How long the daemon is given to open the database before a load starts, watched by polling for the
 * sidecar directory litestream creates beside it. Waiting matters: a daemon that had not attached
 * yet would leave Part A measuring a database nobody was holding, which is the other arm's case.
 */
const ATTACH_DEADLINE_MS = 30_000;

const PLATEAU_FACTOR = 4;

const GIB = 1024 * 1024 * 1024;

type LatencySummary = { p50: number; p95: number; p99: number; max: number };

type Load = {
  latency: LatencySummary;
  firstDayP95: number;
  lastDayP95: number;
  peakWalBytes: number;
  endWalBytes: number;
  dbBytes: number;
  rows: number;
  checkpointRounds: number;
};

type Reclaim = {
  ms: number;
  row: { busy: number; log: number; checkpointed: number };
  walBefore: number;
  walAfter: number;
};

type OfflineArm = {
  load: Load;
  walBytesPerSale: number;
  daemonNote: string;
  attachedMs: number | null;
  daemonAliveAfterLoad: boolean;
  reclaimOffline: Reclaim | null;
  nextSaleMs: number | null;
  reclaimControl: Reclaim;
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

    assert.equal(
      offline.load.rows,
      SALES,
      `the offline arm committed ${offline.load.rows} rows in \`records\`, not the ${SALES} its load drives`,
    );

    let control: ControlArm | undefined;
    if (litestream) {
      store = await startStore();
      control = await runControlArm(litestream.bin, store, dir);
      assert.ok(
        control.load.peakWalBytes * PLATEAU_FACTOR <= offline.load.peakWalBytes,
        `with the store reachable the WAL plateaus: ${control.load.peakWalBytes} bytes against the offline arm's ${offline.load.peakWalBytes} for the same ${SALES} sales, which is under ${PLATEAU_FACTOR}x apart`,
      );
      assert.equal(
        control.load.rows,
        SALES,
        `the control arm committed ${control.load.rows} rows in \`records\` against the offline arm's ${offline.load.rows}, so the two arms did not drive the same ${SALES}-sale load`,
      );
      assert.ok(
        control.load.checkpointRounds > 0,
        `the control arm's rounds left the main database file larger in ${control.load.checkpointRounds} of ${ROUNDS}, so nothing checkpointed and its peak of ${control.load.peakWalBytes} bytes is not a plateau`,
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
        `spec-small-multiple-ceiling=${amplification <= SPEC_SMALL_MULTIPLE ? "met" : "not-met"} spec-small-multiple=${SPEC_SMALL_MULTIPLE} ` +
        `offline-days-per-gib=${offlineDaysPerGib} ` +
        `reclaim-offline=${reclaimText(offline.reclaimOffline)} reclaim-next-sale-ms=${offline.nextSaleMs ?? "n/a"} ` +
        `reclaim-control=${reclaimText(offline.reclaimControl)} ` +
        `control=${controlText(control)} ` +
        `breaches=${breaches.length === 0 ? "none" : `"${breaches.join(" ")}"`}`,
    };
  } finally {
    try {
      if (store) await store.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function runOfflineArm(bin: string | undefined, dir: string): Promise<OfflineArm> {
  const dbPath = join(dir, "offline.db");
  const node = openNode(NODE, dbPath);
  let daemon: ReturnType<typeof replicate> | undefined;
  let unreachableStore: Store | undefined;
  let daemonAlive = false;
  let daemonNote = `no-litestream-v${LITESTREAM_VERSION}`;
  let attachedMs: number | null = null;

  try {
    assertPragmas(node);

    if (bin) {
      const unreachable = await createUnreachableStore();
      unreachableStore = unreachable.store;
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
    const reclaimOffline = daemon ? reclaim(node, dbPath) : null;
    const nextSaleMs = daemon ? timeOneSale(node) : null;

    if (daemon) {
      daemon.kill();
      await daemon.exited;
      daemon = undefined;
    }
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
    try {
      if (unreachableStore) await unreachableStore.stop();
    } finally {
      node.close();
    }
  }
}

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
    rows: Number(node.get<{ n: number }>("SELECT count(*) AS n FROM records")?.n ?? -1),
    checkpointRounds,
  };
}

/**
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

function walBytes(dbPath: string): number {
  const path = `${dbPath}-wal`;
  return existsSync(path) ? statSync(path).size : 0;
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

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
