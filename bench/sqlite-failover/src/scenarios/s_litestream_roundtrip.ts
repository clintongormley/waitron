// LS: the litestream foundation check — everything S0, S3 and S4 stand on. The pinned binary is
// found, a config points it at the store, a one-shot sync uploads, a daemon keeps streaming, and a
// restore rebuilds the database from the store alone.
//
// It is not one of the spec's seven scenarios and it claims nothing about the failover loop. It
// establishes litestream's behaviour on the pin (plan Task 6), so that a later scenario driving the
// loop can read its own failure as being about the loop rather than about the tool.
//
// Nothing here drives `promotion.ts`; the generation names below are literals that follow topology
// §2.2's `gen-<term>-<node-id>` shape, so the keys this scenario writes sit in the same space a
// promotion's would rather than in one of their own.
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

/** Topology §2.2 gives each venue one prefix in the store; `v1` is this rig's venue. */
const VENUE = "venues/v1";

const ONE_SHOT_NODE = "box-a";
const ONE_SHOT_PREFIX = `${VENUE}/gen-1-${ONE_SHOT_NODE}`;
const ONE_SHOT_SALES = 3;

const DAEMON_NODE = "box-b";
const DAEMON_PREFIX = `${VENUE}/gen-2-${DAEMON_NODE}`;
const DAEMON_SALES_BEFORE = 2;
const DAEMON_SALES_AFTER = 2;

/** A generation no node in this scenario ever opens, so nothing is ever streamed to it. */
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
    // The store is stopped FIRST, for the reason `s_smoke.ts` records: a throw ahead of `stop()`
    // would leave the MinIO container running, and `pnpm reap` ignores a container younger than two
    // hours, so nothing would clear it for the rest of the session.
    await store.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Part A — record, sync once, then restore with the local database GONE.
 *
 * Deleting the source file first is the measurement, not tidiness: a `restore` that copied the file
 * beside it would produce exactly the same three rows as one that read the store, so a scenario that
 * left the file in place would pass either way. Measured both ways on 2026-09-18, with `restore`
 * replaced by `copyFileSync(dbName, outPath)`: with these two lines in place the part fails on the
 * copy's `ENOENT`; with them removed the whole scenario reports PASS.
 */
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
  // Row by row, not a count: three rows carrying the wrong payloads would satisfy a count
  // (`CLAUDE.md` §4 — "there is a test" is an unfinished sentence).
  assert.deepEqual(
    restored,
    recorded,
    "the restored database holds exactly the rows the node recorded",
  );
  return { keys: keys.length, restored: restored.length };
}

/**
 * Part B — a `replicate` daemon keeps streaming writes made AFTER its first sync.
 *
 * The two waits are what make that a measurement rather than a coincidence. Spawning the daemon and
 * then immediately writing proves nothing: a one-shot `replicate -once` syncs a few hundred
 * milliseconds after it starts, by which time two SQLite inserts have already landed, so it uploads
 * them too and looks exactly like a daemon. Measured 2026-09-18 — with `replicate` mutated to spawn
 * `replicate -once`, an earlier shape of this part reported PASS with all four rows. Waiting for the
 * FIRST sync to be visible before writing again is what separates the two: the one-shot has exited
 * by then, so the later rows never arrive and the deadline below is reached.
 *
 * Each wait is an outer deadline over a restore poll, never a sleep: the thing being waited for is
 * "the store holds these rows", and restoring is how that is read (`CLAUDE.md` §4).
 */
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

/** Restore until the store holds exactly `expected`, or fail at the deadline. */
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

/**
 * Part C — the control. A prefix nothing ever streamed must not yield a database.
 *
 * Without it, "restore produced a database with the right rows" is a claim about a tool that has
 * never been seen to refuse anything, so a `restore` that quietly returned on any input would look
 * identical in Part A.
 *
 * The refusal is matched on its WORDS, not merely counted as an error. Measured 2026-09-18: with
 * only this part's restore replaced by `throw new Error("spawn ENOENT: binary disappeared")`, a
 * control that accepted any non-empty message reported the whole scenario PASS — a litestream that
 * could not be run at all would have been recorded as a litestream that refused.
 */
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

/** `count` sales on a node opened at `dbPath`, returned as the rows a restore must reproduce. */
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

/**
 * EVERY ledger row a database on disk holds, read back rather than assumed — not one node's rows.
 * The id below is only what the reading handle calls itself; it filters nothing, and each database
 * in this scenario carries exactly one node's chain. Tasks 7 and 8 restore a generation into a node
 * under a different id, which is where a reader would otherwise trust a parameter that does no work.
 */
function rowsIn(dbPath: string): RecordedRow[] {
  const node = openNode("reader", dbPath);
  try {
    return node.all<RecordedRow>(`SELECT secuencia, payload FROM records ORDER BY secuencia`);
  } finally {
    node.close();
  }
}
