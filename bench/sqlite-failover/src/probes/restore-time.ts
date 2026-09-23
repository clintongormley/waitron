// Measurement 4 (slice-2 spec §8.1 item 4): how long a rebuild's restore takes, with a day of changes
// on top of the last full copy, on a database carrying product images (they live in the database:
// `media_image_data.bytes`, packages/media/src/schema/images.ts).
//
// Sizes: the owner's figure of up to 5,000 product images (Reconciliation O2), each stored as the
// shrunk copy Task 0 makes — 171 KiB on average and 338 KB at most over ten real photos (Task 0's
// measurement) — so the count is the owner's upper figure and the sizes are measured, and the line
// says so (`sizes=owner-count-measured-size`). Run it twice: the average size, and every image at the
// largest measured size. Image bytes are random, which does not compress, the way an
// already-compressed photo does not.
//
// No pass/fail. VOID if a restored copy does not hold exactly the ledger rows, image count and image
// bytes the source holds — a fast restore of the wrong database measures nothing. The store is a
// local MinIO, so the time excludes the internet: `store-bytes` is what a real rebuild downloads,
// for the reader to divide by a venue's line speed.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  LITESTREAM_VERSION,
  replicate,
  resolveLitestream,
  restore,
  syncOnce,
  writeConfig,
} from "../litestream.ts";
import { openNode } from "../model.ts";
import { startStore } from "../store.ts";
import {
  bySegment,
  driveLoad,
  integrityOf,
  listObjects,
  report,
  sell,
  sleep,
  walBytes,
} from "./common.ts";

const PROBE = "m4-restore-time";
const PREFIX = "venues/v1/gen-1-box-a-20260923T000000Z";
/** Slice 2's production snapshot settings (spec §4.4), so the restore replays onto a daily full copy. */
const PRODUCTION_SNAPSHOT = [`snapshot:`, `  interval: 24h`, `  retention: 168h`];
/** A generous bound on one restore or upload of a gigabyte-scale database against a local store. */
const LONG_CHILD_MS = 15 * 60_000;
/** Source + side file + store copy + one restore at a time, with margin. */
const DISK_FACTOR = 6;
/** Bytes a sale adds to the model's database once folded back: S4's `checkpointed-db-bytes` over 7500 sales, rounded up. */
const DB_BYTES_PER_SALE = 600;

type Options = {
  images: number;
  imageKib: number;
  historyDays: number;
  salesPerDay: number;
  daySales: number;
  repeats: number;
};

const DEFAULTS: Options = {
  images: 5000,
  imageKib: 171,
  historyDays: 365,
  salesPerDay: 250,
  daySales: 250,
  repeats: 3,
};

function options(argv: string[]): Options {
  const chosen: Options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!.replace(/^--/, "").replace(/-([a-z])/g, (_m, c: string) =>
      c.toUpperCase(),
    );
    const value = Number(argv[i + 1]);
    if (!(flag in chosen) || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(
        `bad option ${argv[i]} ${argv[i + 1]}; flags are --images --image-kib --history-days --sales-per-day --day-sales --repeats, each a positive integer`,
      );
    }
    chosen[flag as keyof Options] = value;
  }
  return chosen;
}

function facts(dbPath: string): { records: number; images: number; imageBytes: number } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const records = Number(db.prepare("SELECT count(*) AS n FROM records").get()?.n);
    const row = db
      .prepare("SELECT count(*) AS n, coalesce(sum(length(bytes)), 0) AS b FROM images")
      .get();
    return { records, images: Number(row?.n), imageBytes: Number(row?.b) };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const o = options(process.argv.slice(2));
  const estimate =
    o.images * o.imageKib * 1024 + (o.historyDays * o.salesPerDay + o.daySales) * DB_BYTES_PER_SALE;
  const disk = statfsSync(tmpdir());
  const free = disk.bavail * disk.bsize;
  if (free < DISK_FACTOR * estimate) {
    report(PROBE, "NOT-RUN", {
      reason: "not enough free disk",
      "free-bytes": free,
      "needed-bytes": DISK_FACTOR * estimate,
    });
    process.exitCode = 1;
    return;
  }
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
  const dir = mkdtempSync(join(tmpdir(), "waitron-m4-"));
  try {
    const dbPath = join(dir, "venue.db");
    const node = openNode("box-a", dbPath);
    let initialUploadMs = 0;
    let dbBytes = 0;
    try {
      node.get("PRAGMA journal_mode = WAL");
      // Only Litestream folds the side file back in this probe, so none of the day's changes can be
      // folded before Litestream reads them. What that setting does to the product is measurement 2's
      // question, not this one's; a restore's duration does not depend on it.
      node.exec("PRAGMA wal_autocheckpoint = 0");
      // Stands in for media_image_data: one row per image, the bytes whole.
      node.exec("CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY, bytes BLOB NOT NULL)");
      const insert = node.handle.prepare("INSERT INTO images (bytes) VALUES (?)");
      for (let i = 0; i < o.images; i += 20) {
        node.exec("BEGIN IMMEDIATE");
        for (let j = i; j < Math.min(o.images, i + 20); j += 1)
          insert.run(randomBytes(o.imageKib * 1024));
        node.exec("COMMIT");
      }
      sell(node, o.historyDays * o.salesPerDay);
      node.get("PRAGMA wal_checkpoint(TRUNCATE)");

      const config = writeConfig({
        dbPath,
        store,
        prefix: PREFIX,
        configPath: join(dir, "m4.yml"),
        globalLines: PRODUCTION_SNAPSHOT,
      });
      const uploadStarted = performance.now();
      await syncOnce(bin, config, LONG_CHILD_MS);
      initialUploadMs = Math.round(performance.now() - uploadStarted);

      const daemon = replicate(bin, config);
      try {
        await sleep(3_000);
        await driveLoad(node, dbPath, o.daySales, 15, 1_000);
      } finally {
        daemon.kill();
        await daemon.exited;
      }
      await syncOnce(bin, config, LONG_CHILD_MS);
      dbBytes = statSync(dbPath).size + walBytes(dbPath);
    } finally {
      node.close();
    }
    const source = facts(dbPath);

    const objects = await listObjects(store, `${PREFIX}/`);
    const restoreMs: number[] = [];
    const integrityMs: number[] = [];
    let verified = true;
    for (let r = 1; r <= o.repeats; r += 1) {
      const out = join(dir, `restore-${r}.db`);
      const started = performance.now();
      await restore(bin, join(dir, "m4.yml"), dbPath, out, [], LONG_CHILD_MS);
      restoreMs.push(Math.round(performance.now() - started));
      const checkStarted = performance.now();
      const integrity = integrityOf(out);
      integrityMs.push(Math.round(performance.now() - checkStarted));
      const restored = facts(out);
      verified &&=
        integrity === "ok" &&
        restored.records === source.records &&
        restored.images === source.images &&
        restored.imageBytes === source.imageBytes;
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${out}${suffix}`, { force: true });
    }

    report(PROBE, verified ? "MEASURED" : "VOID", {
      version: litestream.version,
      sizes: "owner-count-measured-size",
      images: o.images,
      "image-kib": o.imageKib,
      "history-days": o.historyDays,
      "sales-per-day": o.salesPerDay,
      "day-sales": o.daySales,
      "db-bytes": dbBytes,
      "image-bytes": source.imageBytes,
      records: source.records,
      "initial-upload-ms": initialUploadMs,
      "store-bytes": objects.reduce((sum, object) => sum + object.size, 0),
      "store-objects": JSON.stringify(bySegment(objects, PREFIX)),
      "restore-ms": restoreMs.join(","),
      "integrity-check-ms": integrityMs.join(","),
      verified,
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
