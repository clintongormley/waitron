// S3: a replica COPIED from one prefix in the store to another restores the same database as the
// prefix litestream streamed to directly — and only when the copy propagates DELETIONS (spec §4, S3).
//
// The move being modelled is a venue whose replica has to be re-homed: a second box, or a cloud
// node, holds a copy of the streaming box's replica under its own prefix, and something has to keep
// that copy faithful. "Faithful" turns out to mean a MIRROR, not an accumulation, and this scenario
// is about the difference.
//
// What Part A asserts, and what the verdict rests on:
//   - litestream really deletes replica files on this pin. The stream runs under
//     `writeConfig`'s `fastCompaction` and the part keeps selling until a key the store HELD has
//     gone, with an outer deadline rather than a sleep. Without a deletion actually happening,
//     every "propagate deletions" claim below would be a claim about a case that never arose;
//   - after `copyUp(..., { propagateDeletions: true })` the destination holds exactly the source's
//     objects and nothing else;
//   - the database restored from that destination is the database restored from the source: the
//     same file bytes (sha256), the same `records` rows compared field by field against the rows
//     box-a itself wrote, the same `chain_head` rows, and `PRAGMA integrity_check` = ok on both.
//
// What it does NOT assert, and is not evidence about:
//   - anything about `packages/fiscal-verifactu`. Every table here is the rig's MODEL (`model.ts`).
//   - that an additive copy is safe when the destination is EMPTY. Nothing here copies into an empty
//     prefix; both A and B copy into a destination that already holds objects.
//   - that copying is how a real node should re-home a replica. This measures what a copy does, not
//     whether the product should make one.
//   - a lower bound on the compaction settings, or on how long a deletion takes. The part waits for
//     the effect and reports how long it waited for nothing.
//
// Part B is the CONTROL and Part C is a MEASUREMENT that decides nothing; each carries its own
// explanation below.
import assert from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyUp } from "../copy-up.ts";
import {
  LITESTREAM_VERSION,
  replicate,
  resolveLitestream,
  restore,
  syncOnce,
  writeConfig,
} from "../litestream.ts";
import { openNode, recordSale } from "../model.ts";
import type { RecordRow } from "../model.ts";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";
import type { Store } from "../store.ts";

/** Topology §2.2 gives each venue one prefix in the store; `v1` is this rig's venue. */
const VENUE = "venues/v1";

/** The node that streams, and the node whose replica dirties both destinations. */
const BOX_A = "box-a";
const FOREIGN = "box-b";

/**
 * Four prefixes under the one venue, none of them a prefix of another — a listing is by prefix, so
 * two names where one begins the other would read as one replica.
 *
 * The generation names follow topology §2.2's `gen-<term>-<node-id>` shape so these keys sit in the
 * same space a promotion's would. Nothing here drives `promotion.ts`: no term is claimed and no
 * pointer is written, and a reader should not take these numbers for terms anybody fought over.
 */
const SOURCE_PREFIX = `${VENUE}/gen-1-${BOX_A}`;
const MIRROR_PREFIX = `${VENUE}/gen-2-${BOX_A}`;
const ADDITIVE_PREFIX = `${VENUE}/gen-3-${BOX_A}`;
const SAME_LINEAGE_PREFIX = `${VENUE}/gen-4-${BOX_A}`;

/** Sales box-a makes before its daemon starts, and how often it sells while the daemon streams. */
const SALES_BEFORE_STREAM = 3;
const WRITE_INTERVAL_MS = 250;

/**
 * Sales the foreign lineage makes, each followed by its own one-shot sync, so the dirty destination
 * holds a file per sale. The number matters only in that it must leave MORE files than box-a's
 * replica holds: an additive copy overwrites the destination objects whose names it shares and
 * leaves the rest, so a destination with fewer files than the source would be completely overwritten
 * and Part B would have nothing stale to measure. Part B asserts that it does have some.
 */
const FOREIGN_SALES = 9;

/**
 * How long the store is given to show a deletion. Several times `CHILD_TIMEOUT_MS`
 * (`litestream.ts`) deliberately, for the reason `s_litestream_roundtrip.ts` records: a deadline
 * equal to the bound on one litestream call is not an outer deadline.
 *
 * The recorded run reaches its deletion in well under ten seconds. This is a bound on a stall.
 */
const STORE_DEADLINE_MS = 120_000;

/** A database read back off disk, in the four ways Part A compares two of them. */
type Restored = {
  /** Of the FILE BYTES, taken before anything opened it — see `readRestored`. */
  sha256: string;
  records: RecordRow[];
  chainHead: ChainHeadRow[];
  integrity: string;
};

type ChainHeadRow = { node_id: string; last_secuencia: number; last_huella: string };

/** Everything the parts need from the streaming box, captured before its database is deleted. */
type Source = {
  /** The path the config names, which is what `restore` is asked for. */
  dbPath: string;
  /** Box-a's own records, read from BOX-A's database — the only place they exist as written. */
  boxARows: RecordRow[];
  /** Keys the store held during the stream and no longer holds: litestream's own deletions. */
  deletedKeys: string[];
  /** Keys the source prefix holds once the stream is over. */
  finalKeys: string[];
  /** Key suffixes the early same-lineage copy put under `SAME_LINEAGE_PREFIX` — Part C's setup. */
  earlyCopySuffixes: string[];
  /** How long the part waited for a deletion, recorded so the compaction settings can be read. */
  waitedMs: number;
};

export default async function copiedReplica({
  startStore,
}: ScenarioContext): Promise<ScenarioResult> {
  const litestream = await resolveLitestream();
  if (!litestream) {
    // No container is started on this path, which is the point of resolving the binary first.
    return {
      id: "S3",
      title: "a copied replica equals a direct stream",
      verdict: "SKIPPED",
      critical: true,
      detail: `litestream v${LITESTREAM_VERSION} not found; run \`pnpm --filter @waitron/bench-sqlite-failover setup:litestream\` — S3 is UNPROVEN until then`,
    };
  }

  const store = await startStore();
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "waitron-s3-"));
    const bin = litestream.bin;

    const source = await streamUntilDeletion(bin, store, dir);
    // The direct stream every copy is judged against. Box-a's own database is gone by now
    // (`streamUntilDeletion` deletes it), so this is a statement about the STORE.
    const direct = await restoreFrom(bin, store, dir, SOURCE_PREFIX, "restored-direct", source);

    const mirrored = await mirrorIntoDirtyDestination(bin, store, dir, source, direct);
    const control = await additiveIntoDirtyDestination(bin, store, dir, source, direct);
    const sameLineage = await sameLineageAdditive(bin, store, dir, source, direct);

    return {
      id: "S3",
      title: "a copied replica equals a direct stream",
      verdict: "PASS",
      critical: true,
      detail:
        `version=${litestream.version} source-keys=${source.finalKeys.length} source-deleted=${source.deletedKeys.length} deletion-waited-ms=${source.waitedMs} direct-rows=${direct.records.length} ` +
        `foreign-keys=${mirrored.foreignKeys} copied=${mirrored.copied} mirror-deleted=${mirrored.deleted} copied-rows=${mirrored.rows} copied-sha-equal=${mirrored.shaEqual} ` +
        `control-copied=${control.copied} control-stale=${control.stale} control-rows=${control.rows} control-nodes=[${control.nodes}] control-integrity="${control.integrity}" control-refused="${control.refusal}" ` +
        `same-lineage-stale=${sameLineage.stale} same-lineage-rows=${sameLineage.rows} same-lineage-additive=${sameLineage.outcome}`,
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
 * Box-a sells under a `replicate` daemon until the store has DELETED a key it previously held, then
 * the daemon is stopped, the last writes flushed, and box-a's database removed from disk.
 *
 * Waiting for the deletion rather than sleeping a guessed interval is the whole point of this
 * helper: "the copy propagates deletions" is a claim about a case, and if litestream deleted nothing
 * on this pin the case would never have arisen and Parts A and B would be comparing two copies of
 * the same complete replica. The wait is an outer deadline over a real listing, and it fails loudly
 * at the bound (`CLAUDE.md` §4).
 *
 * It also takes Part C's EARLY copy, at the first poll where the source holds anything: those are
 * the objects Part C needs the source to delete underneath it. Taking it here rather than in Part C
 * is what lets Part C use the same lineage as Part A instead of streaming a second one.
 *
 * Deleting box-a's database at the end is the other measurement in here. A restore that copied the
 * file next door would satisfy every comparison below (`s_litestream_roundtrip.ts` records the run
 * where it did).
 */
async function streamUntilDeletion(bin: string, store: Store, dir: string): Promise<Source> {
  const dbPath = join(dir, "venue.db");
  const started = Date.now();
  const captured = await streamAndCapture(bin, store, dir, dbPath);

  // Box-a's handle is closed by the time this runs, so the file is nobody's.
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  assert.ok(!existsSync(dbPath), "the source database is gone before any restore");

  return { dbPath, ...captured, waitedMs: Date.now() - started };
}

/** The stream itself, from box-a's first sale to the read of its last — the handle's whole life. */
async function streamAndCapture(
  bin: string,
  store: Store,
  dir: string,
  dbPath: string,
): Promise<Omit<Source, "dbPath" | "waitedMs">> {
  const boxA = openNode(BOX_A, dbPath);
  let earlyCopySuffixes: string[] = [];

  try {
    for (let i = 0; i < SALES_BEFORE_STREAM; i += 1) recordSale(boxA, 1000 + i);
    const config = writeConfig({
      dbPath,
      store,
      prefix: SOURCE_PREFIX,
      configPath: join(dir, "box-a.yml"),
      fastCompaction: true,
    });

    const daemon = replicate(bin, config);
    const seen = new Set<string>();
    try {
      const deadline = Date.now() + STORE_DEADLINE_MS;
      let sale = 0;
      while (Date.now() < deadline) {
        recordSale(boxA, 2000 + sale);
        sale += 1;
        await sleep(WRITE_INTERVAL_MS);

        const keys = await store.listKeys(SOURCE_PREFIX);
        for (const key of keys) seen.add(key);
        if (earlyCopySuffixes.length === 0 && keys.length > 0) {
          await copyUp(store, SOURCE_PREFIX, SAME_LINEAGE_PREFIX, { propagateDeletions: false });
          earlyCopySuffixes = suffixesUnder(
            await store.listKeys(SAME_LINEAGE_PREFIX),
            SAME_LINEAGE_PREFIX,
          );
        }
        const present = new Set(keys);
        const gone = [...seen].filter((key) => !present.has(key));
        // Both conditions, not just the first: Part C needs a key the EARLY COPY holds to be one of
        // the ones the source dropped, and breaking on any deletion at all could leave without one.
        if (gone.some((key) => earlyCopySuffixes.includes(key.slice(SOURCE_PREFIX.length)))) break;
      }
    } finally {
      daemon.kill();
      await daemon.exited;
    }

    // One last one-shot with the handle still open: the daemon is gone, and nothing else would carry
    // the sales made since its final sync. Closing box-a first would checkpoint its WAL out from
    // under a replica that had not read it.
    await syncOnce(bin, config);
    const boxARows = boxA.all<RecordRow>(
      `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
       WHERE node_id = ? ORDER BY secuencia`,
      BOX_A,
    );
    const finalKeys = await store.listKeys(SOURCE_PREFIX);
    const deletedKeys = [...seen].filter((key) => !finalKeys.includes(key));
    assert.ok(
      deletedKeys.length > 0,
      `litestream deleted none of the ${seen.size} replica files it wrote under ${SOURCE_PREFIX} within ${STORE_DEADLINE_MS}ms — nothing below is measuring a propagated deletion`,
    );
    assert.ok(
      boxARows.length > SALES_BEFORE_STREAM,
      "box-a kept selling while the daemon streamed",
    );
    return { boxARows, deletedKeys, finalKeys, earlyCopySuffixes };
  } finally {
    boxA.close();
  }
}

/**
 * Part A — the verdict. The destination already holds a FOREIGN lineage's replica; a mirroring copy
 * has to leave it holding box-a's, and nothing of box-b's.
 *
 * The dirty destination is what makes this a measurement rather than a formality. Copying into an
 * EMPTY prefix would give the same answer with the flag either way, so the two flags would look
 * alike and nothing would be under test (`CLAUDE.md` §1). Part B runs this same recipe with the flag
 * off and gets box-b's database back.
 */
async function mirrorIntoDirtyDestination(
  bin: string,
  store: Store,
  dir: string,
  source: Source,
  direct: Restored,
): Promise<{
  foreignKeys: number;
  copied: number;
  deleted: number;
  rows: number;
  shaEqual: boolean;
}> {
  const foreignKeys = await dirtyDestination(bin, store, dir, MIRROR_PREFIX, "foreign-mirror");
  const { copied, deleted } = await copyUp(store, SOURCE_PREFIX, MIRROR_PREFIX, {
    propagateDeletions: true,
  });

  const sourceSuffixes = suffixesUnder(await store.listKeys(SOURCE_PREFIX), SOURCE_PREFIX).sort();
  const destinationSuffixes = suffixesUnder(
    await store.listKeys(MIRROR_PREFIX),
    MIRROR_PREFIX,
  ).sort();
  assert.deepStrictEqual(
    destinationSuffixes,
    sourceSuffixes,
    "after the mirroring copy the destination holds exactly the source's objects and nothing else",
  );

  const copiedRestore = await restoreFrom(
    bin,
    store,
    dir,
    MIRROR_PREFIX,
    "restored-copied",
    source,
  );
  assertSameDatabase(copiedRestore, direct, source.boxARows);
  return {
    foreignKeys,
    copied,
    deleted,
    rows: copiedRestore.records.length,
    // Derived, not printed as a literal: a key written as `true` would go on saying so on the day
    // the comparison above stopped checking anything (the lesson S0's Part C records).
    shaEqual: copiedRestore.sha256 === direct.sha256,
  };
}

/**
 * Part B — the CONTROL. The identical recipe with `propagateDeletions: false`, which must reproduce
 * the opposite result, and Part A's OWN comparison must be what refuses it.
 *
 * Driving the same function is the point: a control asserting "the rows are box-b's" in words of its
 * own would stay green if Part A's comparison had stopped checking anything.
 *
 * What the additive copy leaves behind is not a litestream error: on the recorded run the restore
 * SUCCEEDS — exit 0, a database written — and hands back a different venue's ledger. So the restore
 * is expected to succeed here, and a run where litestream refused would fail this part loudly rather
 * than be read as the control working.
 *
 * WHICH of Part A's assertions refuses that database is recorded, not assumed, and on the recorded
 * run it is the integrity check rather than the row comparison: the mixed set of files restores a
 * database SQLite itself reports as damaged, while still reading back box-b's nine rows. The verdict
 * carries both `control-integrity` and the refusal's own words, because a later run refusing at the
 * row comparison instead would be a different finding and should read as one.
 */
async function additiveIntoDirtyDestination(
  bin: string,
  store: Store,
  dir: string,
  source: Source,
  direct: Restored,
): Promise<{
  foreignKeys: number;
  copied: number;
  stale: number;
  rows: number;
  nodes: string[];
  integrity: string;
  refusal: string;
}> {
  const foreignKeys = await dirtyDestination(bin, store, dir, ADDITIVE_PREFIX, "foreign-additive");
  const { copied, deleted } = await copyUp(store, SOURCE_PREFIX, ADDITIVE_PREFIX, {
    propagateDeletions: false,
  });
  assert.equal(deleted, 0, "an additive copy deletes nothing from the destination");

  const sourceSuffixes = new Set(suffixesUnder(await store.listKeys(SOURCE_PREFIX), SOURCE_PREFIX));
  const stale = suffixesUnder(await store.listKeys(ADDITIVE_PREFIX), ADDITIVE_PREFIX).filter(
    (suffix) => !sourceSuffixes.has(suffix),
  );
  assert.ok(
    stale.length > 0,
    "the additive copy leaves the foreign lineage's objects under the destination",
  );

  const controlRestore = await restoreFrom(
    bin,
    store,
    dir,
    ADDITIVE_PREFIX,
    "restored-control",
    source,
  );

  let refusal: string | null = null;
  try {
    assertSameDatabase(controlRestore, direct, source.boxARows);
  } catch (error) {
    // Only an assertion, and nothing else: a helper that threw a TypeError would otherwise be
    // recorded as Part A's comparison doing its job.
    if (!(error instanceof assert.AssertionError)) throw error;
    refusal = error.message.split("\n")[0] ?? "";
  }
  assert.ok(refusal, "Part A's comparison refuses the database the additive copy restores");

  return {
    foreignKeys,
    copied,
    stale: stale.length,
    rows: controlRestore.records.length,
    // Which venue's ledger came back, and what SQLite makes of the file it came out of — both read
    // off the restored database rather than assumed.
    nodes: [...new Set(controlRestore.records.map((row) => String(row.node_id)))].sort(),
    integrity: controlRestore.integrity.split("\n")[0] ?? "",
    refusal,
  };
}

/**
 * Part C — a MEASUREMENT, which decides nothing.
 *
 * It is the control plan Task 8 asked for and it does NOT reproduce the opposite result on this pin,
 * which is why it is recorded here instead of being Part B. The plan expected an additive copy to
 * diverge because stale compacted files would be present; the destination here holds only THIS
 * lineage's files, some of them taken before the source compacted and deleted them, and the restore
 * comes back identical. A replica file's NAME carries the transaction range it covers — a listing
 * taken on 2026-09-18 read `<prefix>/0000/0000000000000001-0000000000000001.ltx` and two like it —
 * so a file put back under the name it already had puts the same range back twice. What this part
 * did NOT test is whether litestream ever writes different bytes under a name it has used before;
 * what it measured is that on this pin, for this lineage, the redundant files changed nothing.
 *
 * The two preconditions are asserted, because without them the measurement would be of nothing: the
 * destination must hold objects the source has since dropped. The OUTCOME is computed and reported,
 * not asserted — a scenario that asserted "identical" here would be stating the conclusion of a
 * measurement it took (`CLAUDE.md` §1), and the verdict does not rest on it.
 */
async function sameLineageAdditive(
  bin: string,
  store: Store,
  dir: string,
  source: Source,
  direct: Restored,
): Promise<{ copied: number; stale: number; rows: number; outcome: string }> {
  const sourceSuffixes = new Set(suffixesUnder(await store.listKeys(SOURCE_PREFIX), SOURCE_PREFIX));
  const staleFromEarlyCopy = source.earlyCopySuffixes.filter(
    (suffix) => !sourceSuffixes.has(suffix),
  );
  assert.ok(
    staleFromEarlyCopy.length > 0,
    "the early copy holds at least one object the source has since deleted",
  );

  const { copied } = await copyUp(store, SOURCE_PREFIX, SAME_LINEAGE_PREFIX, {
    propagateDeletions: false,
  });
  const stale = suffixesUnder(
    await store.listKeys(SAME_LINEAGE_PREFIX),
    SAME_LINEAGE_PREFIX,
  ).filter((suffix) => !sourceSuffixes.has(suffix));
  assert.ok(
    stale.length > 0,
    "the second additive copy still leaves the source's deleted objects in place",
  );

  const restored = await restoreFrom(
    bin,
    store,
    dir,
    SAME_LINEAGE_PREFIX,
    "restored-same-lineage",
    source,
  );
  let outcome = "identical";
  try {
    assertSameDatabase(restored, direct, source.boxARows);
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    outcome = `diverged: ${error.message.split("\n")[0] ?? ""}`;
  }
  return { copied, stale: stale.length, rows: restored.records.length, outcome };
}

/**
 * The comparison the verdict rests on, and the one Parts B and C are judged by too.
 *
 * Every field of every row, never a count: a database of the right SIZE holding another venue's
 * ledger satisfies a count (`CLAUDE.md` §4). The rows are also compared against what BOX-A wrote,
 * not only against each other — two restores of the same wrong prefix agree with one another.
 */
function assertSameDatabase(copied: Restored, direct: Restored, boxARows: RecordRow[]): void {
  assert.equal(direct.integrity, "ok", "the directly streamed replica restores an intact database");
  assert.equal(copied.integrity, "ok", "the copied replica restores an intact database");
  assert.deepStrictEqual(
    copied.records,
    direct.records,
    "the copied replica restores the same ledger rows as the direct stream",
  );
  assert.deepStrictEqual(
    copied.records,
    boxARows,
    "those rows are the ones box-a itself wrote, field for field",
  );
  assert.deepStrictEqual(
    copied.chainHead,
    direct.chainHead,
    "the copied replica restores the same chain tips as the direct stream",
  );
  assert.equal(
    copied.sha256,
    direct.sha256,
    "the two restored files are byte for byte the same database",
  );
}

/** Stream `FOREIGN_SALES` sales of a DIFFERENT venue's ledger into `prefix`, one sync per sale. */
async function dirtyDestination(
  bin: string,
  store: Store,
  dir: string,
  prefix: string,
  label: string,
): Promise<number> {
  const dbPath = join(dir, `${label}.db`);
  const node = openNode(FOREIGN, dbPath);
  try {
    // No `fastCompaction` here, deliberately: this replica's files have to still be there when the
    // copy lands on top of them, and the default L0 retention is minutes rather than seconds.
    const config = writeConfig({
      dbPath,
      store,
      prefix,
      configPath: join(dir, `${label}.yml`),
    });
    for (let i = 0; i < FOREIGN_SALES; i += 1) {
      recordSale(node, 7000 + i);
      await syncOnce(bin, config);
    }
  } finally {
    node.close();
  }
  const keys = await store.listKeys(prefix);
  assert.ok(keys.length > 0, `the foreign lineage streamed nothing under ${prefix}`);
  return keys.length;
}

/**
 * Rebuild box-a's database from `prefix` into `<label>.db` and read it back.
 *
 * The config names box-a's own `dbPath`, whichever prefix it points at — that is the name `restore`
 * asks the replica for, and the file itself is long gone. A destination prefix holding box-b's
 * replica answers to it just the same, which is Part B's whole finding.
 */
async function restoreFrom(
  bin: string,
  store: Store,
  dir: string,
  prefix: string,
  label: string,
  source: Source,
): Promise<Restored> {
  const config = writeConfig({
    dbPath: source.dbPath,
    store,
    prefix,
    configPath: join(dir, `${label}.yml`),
  });
  const outPath = join(dir, `${label}.db`);
  await restore(bin, config, source.dbPath, outPath);
  return readRestored(outPath);
}

/**
 * A restored database, hashed and then read.
 *
 * The hash is taken BEFORE `openNode` touches the file, and that order is the measurement: `openNode`
 * runs `CREATE TABLE IF NOT EXISTS` and its triggers (`model.ts`), and opening a SQLite database
 * creates the `-wal` and `-shm` sidecars beside it — so a hash taken after an open is a hash of
 * something the restore did not produce, and two such hashes could differ for reasons that have
 * nothing to do with what the store held.
 */
function readRestored(path: string): Restored {
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  const node = openNode("reader", path);
  try {
    return {
      sha256,
      records: node.all<RecordRow>(
        `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
         ORDER BY node_id, secuencia`,
      ),
      chainHead: node.all<ChainHeadRow>(
        `SELECT node_id, last_secuencia, last_huella FROM chain_head ORDER BY node_id`,
      ),
      integrity: String(
        node.get<{ integrity_check: string }>(`PRAGMA integrity_check`)?.integrity_check,
      ),
    };
  } finally {
    node.close();
  }
}

/** Each key with its prefix taken off, so two prefixes' listings can be compared as sets. */
function suffixesUnder(keys: string[], prefix: string): string[] {
  return keys.map((key) => {
    assert.ok(key.startsWith(prefix), `${key} is not under ${prefix}`);
    return key.slice(prefix.length);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
