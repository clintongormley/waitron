import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LITESTREAM_VERSION,
  replicate,
  resolveLitestream,
  restore,
  syncOnce,
  writeConfig,
} from "../litestream.ts";
import { openNode, recordSale } from "../model.ts";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";
import type { Store } from "../store.ts";

const VENUE = "venues/v1";

const ONE_SHOT_NODE = "box-a";
const ONE_SHOT_PREFIX = `${VENUE}/gen-1-${ONE_SHOT_NODE}`;
const ONE_SHOT_SALES = 3;

const DAEMON_NODE = "box-b";
const DAEMON_PREFIX = `${VENUE}/gen-2-${DAEMON_NODE}`;
const DAEMON_SALES_BEFORE = 2;
const DAEMON_SALES_AFTER = 2;

const NEVER_STREAMED_PREFIX = `${VENUE}/gen-3-box-c`;

/**
 * How long the store is given to hold a write, before the wait is reported as a failure. Several
 * times `CHILD_TIMEOUT_MS` deliberately: a deadline equal to the bound on one restore is not an
 * outer deadline, because a single stalled child would consume the whole window and the poll would
 * get exactly one attempt.
 */
const STORE_DEADLINE_MS = 120_000;

type RecordedRow = { secuencia: number; payload: string };

export default async function litestreamRoundtrip({
  startStore,
}: ScenarioContext): Promise<ScenarioResult> {
  const litestream = await resolveLitestream();
  if (!litestream) {
    return {
      id: "LS",
      title: "litestream roundtrip",
      verdict: "SKIPPED",
      critical: false,
      detail: `litestream v${LITESTREAM_VERSION} not found; run \`pnpm --filter @waitron/bench-sqlite-failover setup:litestream\``,
    };
  }

  const store = await startStore();
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "waitron-ls-"));
    const oneShot = await roundtripOneShot(litestream.bin, store, dir);
    const streamed = await roundtripDaemon(litestream.bin, store, dir);
    const refusal = await restoreWithNothingStreamed(litestream.bin, store, dir);

    return {
      id: "LS",
      title: "litestream roundtrip",
      verdict: "PASS",
      critical: false,
      detail: `version=${litestream.version} one-shot-keys=${oneShot.keys} one-shot-restored=${oneShot.restored} daemon-restored=${streamed.restored} first-sync-restores=${streamed.firstSync} after-write-restores=${streamed.afterWrite} control-refused="${refusal}"`,
    };
  } finally {
    try {
      await store.stop();
    } finally {
      // The order above is unchanged; what the nesting adds is that the directory goes EITHER WAY. A
      // `stop()` that rejects would otherwise skip the removal, which is the shape
      // `s4_offline_load.ts` carried until 2026-09-18 — injecting a rejecting `stop()` there left
      // the temporary directory behind — and `s0_happy_loop.ts` states the rule.
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function roundtripOneShot(
  bin: string,
  store: Store,
  dir: string,
): Promise<{ keys: number; restored: number }> {
  const dbPath = join(dir, "one-shot.db");
  const recorded = record(dbPath, ONE_SHOT_NODE, ONE_SHOT_SALES);

  const config = writeConfig({
    dbPath,
    store,
    prefix: ONE_SHOT_PREFIX,
    configPath: join(dir, "one-shot.yml"),
  });
  await syncOnce(bin, config);

  const keys = await store.listKeys(ONE_SHOT_PREFIX);
  assert.ok(keys.length > 0, `the one-shot sync uploaded nothing under ${ONE_SHOT_PREFIX}`);

  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  assert.ok(!existsSync(dbPath), "the source database is gone before the restore");

  const outPath = join(dir, "one-shot-restored.db");
  await restore(bin, config, dbPath, outPath);

  const restored = rowsIn(outPath);
  assert.deepEqual(
    restored,
    recorded,
    "the restored database holds exactly the rows the node recorded",
  );
  return { keys: keys.length, restored: restored.length };
}

async function roundtripDaemon(
  bin: string,
  store: Store,
  dir: string,
): Promise<{ restored: number; firstSync: number; afterWrite: number }> {
  const dbPath = join(dir, "daemon.db");
  const before = record(dbPath, DAEMON_NODE, DAEMON_SALES_BEFORE);
  const config = writeConfig({
    dbPath,
    store,
    prefix: DAEMON_PREFIX,
    configPath: join(dir, "daemon.yml"),
  });

  const daemon = replicate(bin, config);
  try {
    const first = await waitForRows({
      bin,
      dir,
      config,
      dbPath,
      expected: before,
      label: "the daemon's first sync",
      tag: "first",
    });

    const after = record(dbPath, DAEMON_NODE, DAEMON_SALES_AFTER, before.length);
    const second = await waitForRows({
      bin,
      dir,
      config,
      dbPath,
      expected: [...before, ...after],
      label: "the rows written while the daemon was running",
      tag: "after",
    });

    return { restored: second.rows, firstSync: first.attempts, afterWrite: second.attempts };
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

async function waitForRows(args: {
  bin: string;
  dir: string;
  config: string;
  dbPath: string;
  expected: RecordedRow[];
  label: string;
  tag: string;
}): Promise<{ rows: number; attempts: number }> {
  const { bin, dir, config, dbPath, expected, label, tag } = args;
  const deadline = Date.now() + STORE_DEADLINE_MS;
  let attempts = 0;
  let seen: RecordedRow[] = [];
  while (Date.now() < deadline) {
    attempts += 1;
    const outPath = join(dir, `daemon-${tag}-${attempts}.db`);
    try {
      await restore(bin, config, dbPath, outPath);
      seen = rowsIn(outPath);
      if (seen.length >= expected.length) {
        assert.deepEqual(seen, expected, label);
        return { rows: seen.length, attempts };
      }
    } catch (error) {
      // Nothing uploaded yet: the restore refuses with "no matching backup files available", and a
      // refusal of THAT kind is the wait rather than the answer. Two other kinds are not, and are
      // rethrown: an assertion failure, and a restore that had to be KILLED at its bound — that one
      // would otherwise be reported at the deadline as "the store never held the rows", naming
      // replication for a failure that was really a child that stopped.
      if (error instanceof assert.AssertionError) throw error;
      if (error instanceof Error && error.message.includes("was killed after")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(
    `${label}: the store never held all ${expected.length} rows within ${STORE_DEADLINE_MS}ms (last restore saw ${seen.length})`,
  );
}

async function restoreWithNothingStreamed(bin: string, store: Store, dir: string): Promise<string> {
  const dbPath = join(dir, "never-streamed.db");
  const config = writeConfig({
    dbPath,
    store,
    prefix: NEVER_STREAMED_PREFIX,
    configPath: join(dir, "control.yml"),
  });
  const outPath = join(dir, "control-restored.db");

  const refusal = await restore(bin, config, dbPath, outPath).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.ok(refusal, "restoring a prefix nothing streamed is refused");
  assert.match(
    refusal,
    /no matching backup files available/,
    "the refusal is litestream's missing-backup answer, not a failure to run it",
  );
  assert.ok(!existsSync(outPath), "a refused restore writes no database");
  return refusal;
}

function record(dbPath: string, nodeId: string, count: number, from = 0): RecordedRow[] {
  const node = openNode(nodeId, dbPath);
  try {
    for (let i = 0; i < count; i += 1) recordSale(node, 1000 + from + i);
    return node.all<RecordedRow>(
      `SELECT secuencia, payload FROM records WHERE secuencia > ? ORDER BY secuencia`,
      from,
    );
  } finally {
    node.close();
  }
}

function rowsIn(dbPath: string): RecordedRow[] {
  const node = openNode("reader", dbPath);
  try {
    return node.all<RecordedRow>(`SELECT secuencia, payload FROM records ORDER BY secuencia`);
  } finally {
    node.close();
  }
}
