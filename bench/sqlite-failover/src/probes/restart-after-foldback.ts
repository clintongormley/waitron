// Measurement 1 (slice-2 spec §8.1 item 1): restart after an outside fold-back.
//
// Spec §4.5's plan for a bucket outage: stop Litestream, fold the side file back into the database
// from our own connection, restart Litestream when the bucket answers. Sales Litestream saw but could
// not upload, and sales made while it was stopped, are then only in the database FILE — the fold-back
// moved them out of the side file Litestream reads. The question is whether a restarted Litestream
// notices and uploads them.
//
// FAILING result — prints `RESTART_RESYNCS=false` with `restore-complete=false missing=<ranges>`
// naming sales from phases 2-3, or `daemon-alive=false daemon-exit=<code>`.
// PASSING result — prints `RESTART_RESYNCS=true … restore-complete=true missing=none integrity=ok
// daemon-alive=true`.
// CONTROL, the other direction — the same restore taken BEFORE the restart must LACK phases 2-3
// (`control-before-restart-rows=20`). If it already holds them, the restore is not reading what this
// probe thinks it is, and the line reads `VOID`.
//
// It also records whether a foreign object at the generation's root (`opened.json`, the marker slice
// 2 writes before Litestream starts — spec §4.4) disturbs Litestream or survives it.
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LITESTREAM_VERSION, replicate, resolveLitestream, writeConfig } from "../litestream.ts";
import { openNode } from "../model.ts";
import { startStore } from "../store.ts";
import { createUnreachableStore } from "../unreachable-store.ts";
import {
  bySegment,
  checkpoint,
  integrityOf,
  listObjects,
  missingRanges,
  problemLines,
  report,
  restoredRows,
  sell,
  sleep,
  waitForAttach,
  waitForStoredRows,
  walBytes,
} from "./common.ts";

const PROBE = "m1-restart-after-foldback";
const GENERATION = "gen-1-box-a-20260923T000000Z";
const PREFIX = `venues/v1/${GENERATION}`;
/** Small batches on purpose: the question is WHICH sales arrive, not how fast. */
const STREAMED = 20; // phase 1 — reachable daemon
const HELD_OFFLINE = 20; // phase 2 — daemon attached, its store unreachable
const WHILE_STOPPED = 20; // phase 3 — no daemon at all
const AFTER_RESTART = 20; // phase 4 — daemon restarted against the reachable store
const TOTAL = STREAMED + HELD_OFFLINE + WHILE_STOPPED + AFTER_RESTART;
/**
 * The offline daemon reopens a database it already knows, so its sidecar directory exists and
 * cannot signal the attach. S4 measured attach at 1024-1114ms; three seconds is that with margin, and
 * the busy checkpoint in phase 2 is what shows the daemon really held the file.
 */
const OFFLINE_ATTACH_MS = 3_000;

async function main(): Promise<void> {
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
  const dir = mkdtempSync(join(tmpdir(), "waitron-m1-"));
  let log = "";
  const onLog = (chunk: string) => {
    log += chunk;
  };
  try {
    const dbPath = join(dir, "venue.db");
    await store.putJson(`${PREFIX}/opened.json`, { generation: GENERATION });
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
    try {
      // Phase 1: stream, and see the store hold it.
      let daemon = replicate(bin, reachable, onLog);
      await waitForAttach(dbPath);
      sell(node, STREAMED);
      const phase1 = await waitForStoredRows({
        bin,
        config: reachable,
        dbPath,
        dir,
        tag: "phase1",
        expected: STREAMED,
      });
      assert.ok(phase1.reached, `precondition: the store never held the first ${STREAMED} sales`);
      daemon.kill();
      await daemon.exited;

      // Phase 2: attached but offline. Our checkpoint is expected to be refused here (S4's finding).
      daemon = replicate(bin, unreachable, onLog);
      await sleep(OFFLINE_ATTACH_MS);
      sell(node, HELD_OFFLINE);
      const heldCheckpoint = checkpoint(node);
      daemon.kill();
      await daemon.exited;

      // Phase 3: the fold-back, sales with nothing attached, and a second fold-back.
      const foldBack = checkpoint(node);
      assert.equal(
        foldBack.busy,
        0,
        "precondition: with Litestream stopped, our own checkpoint completes",
      );
      sell(node, WHILE_STOPPED);
      const secondFoldBack = checkpoint(node);
      assert.equal(
        walBytes(dbPath),
        0,
        "precondition: the side file is empty before the restart, so every sale since phase 1 lives only in the database file",
      );

      // The control: the store, read before the restart, must lack phases 2 and 3.
      const before = await restoredRows(bin, reachable, dbPath, join(dir, "control.db"));
      const beforeRows = before === "no-backup" ? 0 : before.length;
      const objectsBefore = await listObjects(store, PREFIX);

      // Phase 4: restart against the reachable store, sell, and wait for everything.
      const state: { exit: number | null | "alive" } = { exit: "alive" };
      daemon = replicate(bin, reachable, onLog);
      daemon.exited.then(
        (code) => (state.exit = code),
        () => (state.exit = null),
      );
      sell(node, AFTER_RESTART);
      const after = await waitForStoredRows({
        bin,
        config: reachable,
        dbPath,
        dir,
        tag: "after",
        expected: TOTAL,
      });
      const objectsAfter = await listObjects(store, PREFIX);
      const daemonAlive = state.exit === "alive";
      daemon.kill();
      await daemon.exited;

      const complete =
        after.reached &&
        after.rows.length === TOTAL &&
        after.rows.every((row, i) => row.secuencia === i + 1);
      const integrity = after.lastPath === "" ? "no-restore" : integrityOf(after.lastPath);
      const voided = beforeRows !== STREAMED;
      const resyncs = !voided && complete && daemonAlive && integrity === "ok";
      const problems = problemLines(log);
      report(PROBE, voided ? "VOID" : `RESTART_RESYNCS=${resyncs}`, {
        version: litestream.version,
        offline: offline.refusedWith,
        "held-checkpoint-busy": heldCheckpoint.busy,
        "fold-back-busy": foldBack.busy,
        "second-fold-back-busy": secondFoldBack.busy,
        "control-before-restart-rows": beforeRows,
        "control-expected": STREAMED,
        "restore-complete": complete,
        "restored-rows": after.rows.length,
        expected: TOTAL,
        missing: missingRanges(TOTAL, after.rows),
        "restore-attempts": after.attempts,
        integrity,
        "daemon-alive": daemonAlive,
        "daemon-exit": state.exit === "alive" ? "none" : String(state.exit),
        "objects-before": JSON.stringify(bySegment(objectsBefore, PREFIX)),
        "objects-after": JSON.stringify(bySegment(objectsAfter, PREFIX)),
        "marker-survived": objectsAfter.some((object) => object.key === `${PREFIX}/opened.json`),
        "log-problems": problems.length,
        "first-problem": problems[0] ?? "none",
      });
    } finally {
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
