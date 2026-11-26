import assert from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAdditiveControl } from "../additive-control.ts";
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

const VENUE = "venues/v1";

const BOX_A = "box-a";
const FOREIGN = "box-b";

const SOURCE_PREFIX = `${VENUE}/gen-1-${BOX_A}`;
const MIRROR_PREFIX = `${VENUE}/gen-2-${BOX_A}`;
const ADDITIVE_PREFIX = `${VENUE}/gen-3-${BOX_A}`;
const SAME_LINEAGE_PREFIX = `${VENUE}/gen-4-${BOX_A}`;

const SALES_BEFORE_STREAM = 3;
const WRITE_INTERVAL_MS = 250;

const FOREIGN_SALES = 9;

const STORE_DEADLINE_MS = 120_000;

type Restored = {
  sha256: string;
  records: RecordRow[];
  chainHead: ChainHeadRow[];
  integrity: string;
};

type ChainHeadRow = { node_id: string; last_secuencia: number; last_huella: string };

type Source = {
  dbPath: string;
  boxARows: RecordRow[];
  deletedKeys: string[];
  finalKeys: string[];
  earlyCopySuffixes: string[];
  waitedMs: number;
};

export default async function copiedReplica({
  startStore,
}: ScenarioContext): Promise<ScenarioResult> {
  const litestream = await resolveLitestream();
  if (!litestream) {
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
        `control-foreign-keys=${control.foreignKeys} control-copied=${control.copied} control-stale=${control.stale} control-rows=${control.rows ?? "unreadable"} control-nodes=[${control.nodes ?? "unreadable"}] control-integrity="${control.integrity}" control-refused="${control.refusal}" ` +
        `same-lineage-stale=${sameLineage.stale} same-lineage-rows=${sameLineage.rows} same-lineage-additive="${sameLineage.outcome}"`,
    };
  } finally {
    try {
      await store.stop();
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function streamUntilDeletion(bin: string, store: Store, dir: string): Promise<Source> {
  const dbPath = join(dir, "venue.db");
  const captured = await streamAndCapture(bin, store, dir, dbPath);

  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  assert.ok(!existsSync(dbPath), "the source database is gone before any restore");

  return { dbPath, ...captured };
}

async function streamAndCapture(
  bin: string,
  store: Store,
  dir: string,
  dbPath: string,
): Promise<Omit<Source, "dbPath">> {
  const boxA = openNode(BOX_A, dbPath);
  let earlyCopySuffixes: string[] = [];
  let waitedMs: number;

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
      // The clock starts HERE, not at the top of the helper: everything before this — opening
      // box-a, three sales, the config, the daemon spawn — is setup, and folding it in would make
      // `deletion-waited-ms` a number about the scenario rather than about the deletion. It is
      // still quantised to the poll interval, and still not a latency (see `Source.waitedMs`).
      const loopStarted = Date.now();
      const deadline = loopStarted + STORE_DEADLINE_MS;
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
      waitedMs = Date.now() - loopStarted;
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
    return { boxARows, deletedKeys, finalKeys, earlyCopySuffixes, waitedMs };
  } finally {
    boxA.close();
  }
}

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
    shaEqual: copiedRestore.sha256 === direct.sha256,
  };
}

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
  rows: number | null;
  nodes: string[] | null;
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

  const controlPath = await restorePath(
    bin,
    store,
    dir,
    ADDITIVE_PREFIX,
    "restored-control",
    source,
  );
  const observed: { restored: Restored | null; corruption: string | null } = {
    restored: null,
    corruption: null,
  };
  let refusal: string | null = null;
  try {
    const result = readAdditiveControl(() =>
      assertSameDatabase(
        () => {
          observed.restored = readRestored(controlPath);
          return observed.restored;
        },
        direct,
        source.boxARows,
      ),
    );
    observed.corruption = result.corruption;
    if (result.corruption) {
      refusal = `SQLite refused to read the additive control: ${result.corruption}`;
    }
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    refusal = error.message.split("\n")[0] ?? "";
  }
  assert.ok(refusal, "Part A's comparison refuses the database the additive copy restores");

  const controlRestore = observed.restored;
  return {
    foreignKeys,
    copied,
    stale: stale.length,
    rows: controlRestore?.records.length ?? null,
    nodes: controlRestore
      ? [...new Set(controlRestore.records.map((row) => String(row.node_id)))].sort()
      : null,
    integrity: (controlRestore?.integrity ?? observed.corruption ?? "").split("\n")[0] ?? "",
    refusal,
  };
}

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

  let restored: Restored | null = null;
  let outcome: string;
  try {
    restored = await restoreFrom(
      bin,
      store,
      dir,
      SAME_LINEAGE_PREFIX,
      "restored-same-lineage",
      source,
    );
    outcome = "identical";
  } catch (error) {
    if (!isRestoreRefusal(error)) throw error;
    outcome = `refused: ${(error as Error).message.split("\n")[0] ?? ""}`;
  }

  if (restored) {
    try {
      assertSameDatabase(restored, direct, source.boxARows);
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      outcome = `diverged: ${error.message.split("\n")[0] ?? ""}`;
    }
  }
  return { copied, stale: stale.length, rows: restored?.records.length ?? 0, outcome };
}

function isRestoreRefusal(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^litestream restore exited \d+: /.test(error.message) &&
    error.message.includes("no matching backup files available")
  );
}

function assertSameDatabase(
  readCopied: Restored | (() => Restored),
  direct: Restored,
  boxARows: RecordRow[],
): void {
  // Read inside the comparison so removing it also removes the control's rejection.
  const copied = typeof readCopied === "function" ? readCopied() : readCopied;
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

async function restoreFrom(
  bin: string,
  store: Store,
  dir: string,
  prefix: string,
  label: string,
  source: Source,
): Promise<Restored> {
  return readRestored(await restorePath(bin, store, dir, prefix, label, source));
}

async function restorePath(
  bin: string,
  store: Store,
  dir: string,
  prefix: string,
  label: string,
  source: Source,
): Promise<string> {
  const config = writeConfig({
    dbPath: source.dbPath,
    store,
    prefix,
    configPath: join(dir, `${label}.yml`),
  });
  const outPath = join(dir, `${label}.db`);
  await restore(bin, config, source.dbPath, outPath);
  return outPath;
}

/**
 * The hash is taken BEFORE `openNode` touches the file, so that nothing `openNode` does can enter
 * it: it runs `CREATE TABLE IF NOT EXISTS` and its triggers (`model.ts`), and opening a database
 * litestream has restored creates the `-wal` and `-shm` sidecars beside it. The ordering is the
 * conservative one, and it is not an assertion that an open WOULD change the file.
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

function suffixesUnder(keys: string[], prefix: string): string[] {
  return keys.map((key) => {
    assert.ok(key.startsWith(prefix), `${key} is not under ${prefix}`);
    return key.slice(prefix.length);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
