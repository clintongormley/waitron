/**
 * LS — the litestream foundation check. Everything S0, S3 and S4 stand on: the pinned binary is
 * found, a config points it at the store, a one-shot sync uploads, a daemon streams, and a restore
 * rebuilds the database from the store alone.
 *
 * This is not one of the spec's seven scenarios and it claims nothing about the failover loop. It
 * establishes litestream's behaviour on the pin (plan Task 6), so a later scenario that drives it
 * can read a failure as being about the loop rather than about the tool.
 */
import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openNode, recordSale } from "../model.ts";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";

type RecordedRow = { secuencia: number; payload: string };

export default async function ({ startStore }: ScenarioContext): Promise<ScenarioResult> {
  const { resolveLitestream, writeConfig, replicate, restore, syncOnce } =
    await import("../litestream.ts");
  const litestream = await resolveLitestream();
  if (!litestream) {
    return {
      id: "LS",
      title: "litestream roundtrip",
      verdict: "SKIPPED",
      critical: false,
      detail:
        "litestream v0.5.17 not found; run `pnpm --filter @waitron/bench-sqlite-failover setup:litestream`",
    };
  }

  const store = await startStore();
  const dir = mkdtempSync(join(tmpdir(), "waitron-ls-"));
  try {
    const oneShot = await roundtripOneShot({
      litestream,
      store,
      dir,
      writeConfig,
      syncOnce,
      restore,
    });
    const streamed = await roundtripDaemon({
      litestream,
      store,
      dir,
      writeConfig,
      replicate,
      restore,
    });
    const control = await restoreWithNothingStreamed({
      litestream,
      store,
      dir,
      writeConfig,
      restore,
    });

    return {
      id: "LS",
      title: "litestream roundtrip",
      verdict: "PASS",
      critical: false,
      detail: `v${litestream.version} one-shot: keys=${oneShot.keys} restored=${oneShot.restored}; daemon: restored=${streamed.restored} (first sync seen after ${streamed.firstSync} restore(s), the later rows after ${streamed.afterWrite}); control(nothing streamed): ${control}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await store.stop();
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
async function roundtripOneShot({
  litestream,
  store,
  dir,
  writeConfig,
  syncOnce,
  restore,
}: PartArgs & {
  syncOnce: (bin: string, config: string) => Promise<void>;
}): Promise<{ keys: number; restored: number }> {
  const dbPath = join(dir, "one-shot.db");
  const prefix = "venues/v1/gen-1-box-a";
  const recorded = record(dbPath, "box-a", 3);

  const config = writeConfig({ dbPath, store, prefix, configPath: join(dir, "one-shot.yml") });
  await syncOnce(litestream.bin, config);

  const keys = await store.listKeys(prefix);
  assert.ok(keys.length > 0, `the one-shot sync uploaded nothing under ${prefix}`);

  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  assert.ok(!existsSync(dbPath), "the source database is gone before the restore");

  const outPath = join(dir, "one-shot-restored.db");
  await restore(litestream.bin, config, dbPath, outPath);

  const restored = openNode("box-a", outPath);
  try {
    // Row by row, not a count: three rows carrying the wrong payloads would satisfy a count
    // (`CLAUDE.md` §4 — "there is a test" is an unfinished sentence).
    assert.deepEqual(
      restored.all<RecordedRow>(`SELECT secuencia, payload FROM records ORDER BY secuencia`),
      recorded,
      "the restored database holds exactly the rows the node recorded",
    );
    return { keys: keys.length, restored: recorded.length };
  } finally {
    restored.close();
  }
}

/**
 * Part B — a `replicate` daemon keeps streaming writes made AFTER its first sync.
 *
 * The two waits are what make that a measurement rather than a coincidence. Spawning the daemon and
 * then immediately writing proves nothing: a one-shot `replicate -once` syncs a few hundred
 * milliseconds after it starts, by which time two SQLite inserts have already landed, so it uploads
 * them too and looks exactly like a daemon. Measured on 2026-09-18 — with `replicate` mutated to
 * spawn `replicate -once`, an earlier shape of this part reported PASS with all four rows. Waiting
 * for the FIRST sync to be visible before writing again is what separates the two: the one-shot has
 * exited by then, so the later rows never arrive and the deadline below is reached.
 *
 * Each wait is an outer deadline over a restore poll, never a sleep: the thing being waited for is
 * "the store holds these rows", and restoring is how that is read (`CLAUDE.md` §4).
 */
async function roundtripDaemon({
  litestream,
  store,
  dir,
  writeConfig,
  replicate,
  restore,
}: PartArgs & {
  replicate: (bin: string, config: string) => { kill(): void; exited: Promise<number | null> };
}): Promise<{ restored: number; firstSync: number; afterWrite: number }> {
  const dbPath = join(dir, "daemon.db");
  const prefix = "venues/v1/gen-2-daemon";
  const before = record(dbPath, "box-b", 2);
  const config = writeConfig({ dbPath, store, prefix, configPath: join(dir, "daemon.yml") });

  const daemon = replicate(litestream.bin, config);
  try {
    const firstSync = await waitForRows({
      litestream,
      dir,
      config,
      dbPath,
      restore,
      expected: before,
      label: "the daemon's first sync",
      tag: "first",
    });

    const after = record(dbPath, "box-b", 2, before.length);
    const expected = [...before, ...after];
    const afterWrite = await waitForRows({
      litestream,
      dir,
      config,
      dbPath,
      restore,
      expected,
      label: "the rows written while the daemon was running",
      tag: "after",
    });

    return { restored: expected.length, firstSync, afterWrite };
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

/** Restore until the store holds exactly `expected`, or fail at the deadline. Returns the attempts. */
async function waitForRows(args: {
  litestream: { bin: string; version: string };
  dir: string;
  config: string;
  dbPath: string;
  restore: PartArgs["restore"];
  expected: RecordedRow[];
  label: string;
  tag: string;
}): Promise<number> {
  const { litestream, dir, config, dbPath, restore, expected, label, tag } = args;
  const deadline = Date.now() + 60_000;
  let attempts = 0;
  let seen: RecordedRow[] = [];
  while (Date.now() < deadline) {
    attempts += 1;
    const outPath = join(dir, `daemon-${tag}-${attempts}.db`);
    try {
      await restore(litestream.bin, config, dbPath, outPath);
      const restored = openNode("box-b", outPath);
      try {
        seen = restored.all<RecordedRow>(
          `SELECT secuencia, payload FROM records ORDER BY secuencia`,
        );
      } finally {
        restored.close();
      }
      if (seen.length >= expected.length) {
        assert.deepEqual(seen, expected, label);
        return attempts;
      }
    } catch (error) {
      // Nothing uploaded yet: the restore refuses with "no matching backup files available". A
      // refusal here is the wait, not the answer — an assertion failure is not, so it is rethrown.
      if (error instanceof assert.AssertionError) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(
    `${label}: the store never held all ${expected.length} rows within 60s (last restore saw ${seen.length})`,
  );
}

/**
 * Part C — the control. A prefix nothing ever streamed must not yield a database.
 *
 * Without it, "restore produced a database with the right rows" is a claim about a tool that has
 * never been seen to refuse anything, so a `restore` that quietly returned on any input would look
 * identical in Part A.
 */
async function restoreWithNothingStreamed({
  litestream,
  store,
  dir,
  writeConfig,
  restore,
}: PartArgs): Promise<string> {
  const dbPath = join(dir, "never-streamed.db");
  const prefix = "venues/v1/gen-3-never-streamed";
  const config = writeConfig({ dbPath, store, prefix, configPath: join(dir, "control.yml") });
  const outPath = join(dir, "control-restored.db");

  const refusal = await restore(litestream.bin, config, dbPath, outPath).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.ok(refusal, "restoring a prefix nothing streamed is refused");
  assert.ok(!existsSync(outPath), "a refused restore writes no database");
  return "refused";
}

type PartArgs = {
  litestream: { bin: string; version: string };
  store: Awaited<ReturnType<ScenarioContext["startStore"]>>;
  dir: string;
  writeConfig: (opts: {
    dbPath: string;
    store: Awaited<ReturnType<ScenarioContext["startStore"]>>;
    prefix: string;
    configPath: string;
  }) => string;
  restore: (bin: string, config: string, dbName: string, outPath: string) => Promise<void>;
};

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
