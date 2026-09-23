/**
 * What the slice-2 probes share (`docs/superpowers/specs/2026-09-23-sqlite-slice2-stream-and-cold-restore-design.md`
 * §8.1). A probe is a one-off measurement, not a scenario: `../scenarios.ts` discovers only
 * `src/scenarios/`, so nothing here runs in the scenario table, the pre-push hook or CI. Each probe
 * prints exactly one result line in the table's shape, so the results note can quote it verbatim.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { restore } from "../litestream.ts";
import { recordSale } from "../model.ts";
import type { NodeDb } from "../model.ts";
import type { Store } from "../store.ts";

export type RecordedRow = { secuencia: number; payload: string };
export type StoredObject = { key: string; size: number; lastModified: Date };
export type Load = {
  peakWalBytes: number;
  walByRound: number[];
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
};

/**
 * Several times the rig's 30-second bound on one restore, so a single stalled child cannot use the
 * whole window — the reason `scenarios/s_litestream_roundtrip.ts` gives for its own deadline.
 */
export const STORE_DEADLINE_MS = 120_000;

/** How long a daemon is given to open a fresh database, watched by its sidecar directory. */
const ATTACH_DEADLINE_MS = 30_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `count` sales, one transaction each. */
export function sell(node: NodeDb, count: number): void {
  for (let i = 0; i < count; i += 1) recordSale(node, 1000 + (i % 997));
}

/** Every ledger row in a database on disk, through a read-only handle so reading changes nothing. */
export function rowsIn(dbPath: string): RecordedRow[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare("SELECT secuencia, payload FROM records ORDER BY secuencia")
      .all()
      .map((row) => ({ secuencia: Number(row.secuencia), payload: String(row.payload) }));
  } finally {
    db.close();
  }
}

export function integrityOf(dbPath: string): string {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return String(db.prepare("PRAGMA integrity_check").get()?.integrity_check);
  } finally {
    db.close();
  }
}

/** The `-wal` side file's size, or 0 when SQLite has not created it. */
export function walBytes(dbPath: string): number {
  const path = `${dbPath}-wal`;
  return existsSync(path) ? statSync(path).size : 0;
}

/**
 * Restore the store's copy into `outPath` and read its rows, or answer `"no-backup"` when litestream
 * refuses with its missing-backup words. Every other failure is rethrown: a litestream that could not
 * run must never read as one that refused (the rule `s_litestream_roundtrip.ts`'s control paid for).
 */
export async function restoredRows(
  bin: string,
  config: string,
  dbPath: string,
  outPath: string,
  extraArgs: string[] = [],
): Promise<RecordedRow[] | "no-backup"> {
  try {
    await restore(bin, config, dbPath, outPath, extraArgs);
  } catch (error) {
    if (error instanceof Error && error.message.includes("no matching backup files available")) {
      return "no-backup";
    }
    throw error;
  }
  return rowsIn(outPath);
}

/**
 * Poll the store by restoring until it holds at least `expected` rows, or the deadline passes. Each
 * attempt restores into a fresh path, because litestream refuses a non-empty output file.
 */
export async function waitForStoredRows(args: {
  bin: string;
  config: string;
  dbPath: string;
  dir: string;
  tag: string;
  expected: number;
}): Promise<{ rows: RecordedRow[]; attempts: number; reached: boolean; lastPath: string }> {
  const deadline = Date.now() + STORE_DEADLINE_MS;
  let attempts = 0;
  let rows: RecordedRow[] = [];
  let lastPath = "";
  while (Date.now() < deadline) {
    attempts += 1;
    const outPath = join(args.dir, `${args.tag}-${attempts}.db`);
    const seen = await restoredRows(args.bin, args.config, args.dbPath, outPath);
    if (seen !== "no-backup") {
      rows = seen;
      lastPath = outPath;
      if (rows.length >= args.expected) return { rows, attempts, reached: true, lastPath };
    }
    await sleep(1_000);
  }
  return { rows, attempts, reached: false, lastPath };
}

/**
 * Wait for litestream to have OPENED a fresh database, observed as the `.<name>-litestream` sidecar
 * directory it creates beside it (`scenarios/s4_offline_load.ts` records this as the pin's behaviour,
 * not a documented interface). Only meaningful for a database no daemon has opened before.
 */
export async function waitForAttach(dbPath: string): Promise<number> {
  const separator = dbPath.lastIndexOf("/");
  const marker = join(dbPath.slice(0, separator), `.${dbPath.slice(separator + 1)}-litestream`);
  const started = Date.now();
  while (Date.now() - started < ATTACH_DEADLINE_MS) {
    if (existsSync(marker)) return Date.now() - started;
    await sleep(100);
  }
  throw new Error(
    `litestream did not open ${dbPath} within ${ATTACH_DEADLINE_MS}ms (no ${marker})`,
  );
}

/**
 * Every object under `prefix` with its size and time, however many pages the listing takes
 * (`store.ts`'s `listKeys` records the 1000-key page that makes the loop necessary).
 */
export async function listObjects(store: Store, prefix: string): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  let token: string | undefined;
  do {
    const page = await store.client.send(
      new ListObjectsV2Command({ Bucket: store.bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key === undefined) continue;
      objects.push({
        key: object.Key,
        size: object.Size ?? 0,
        lastModified: object.LastModified ?? new Date(0),
      });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

/** Objects grouped by the first path segment under `prefix` — a level directory, `opened.json`, … */
export function bySegment(
  objects: StoredObject[],
  prefix: string,
): Record<string, { count: number; bytes: number }> {
  const root = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const out: Record<string, { count: number; bytes: number }> = {};
  for (const object of objects) {
    const rest = object.key.startsWith(root) ? object.key.slice(root.length) : object.key;
    const slash = rest.indexOf("/");
    const segment = slash === -1 ? rest : rest.slice(0, slash);
    const entry = (out[segment] ??= { count: 0, bytes: 0 });
    entry.count += 1;
    entry.bytes += object.size;
  }
  return out;
}

/** The secuencias in 1..expected that `rows` lacks, as compact ranges (`21-40,61-80`), or `none`. */
export function missingRanges(expected: number, rows: RecordedRow[]): string {
  const held = new Set(rows.map((row) => row.secuencia));
  const ranges: string[] = [];
  let start: number | null = null;
  for (let s = 1; s <= expected + 1; s += 1) {
    const missing = s <= expected && !held.has(s);
    if (missing && start === null) start = s;
    if (!missing && start !== null) {
      ranges.push(start === s - 1 ? `${start}` : `${start}-${s - 1}`);
      start = null;
    }
  }
  return ranges.length === 0 ? "none" : ranges.join(",");
}

/**
 * Lines of litestream's log at WARN or ERROR, in the pin's default text format (`level=ERROR msg=…`,
 * the shape the README's S4 section quotes from the pin).
 */
export function problemLines(log: string): string[] {
  return log.split("\n").filter((line) => /level=(WARN|ERROR)/.test(line));
}

/** `PRAGMA wal_checkpoint(TRUNCATE)` from our own connection, and SQLite's three answers. */
export function checkpoint(node: NodeDb): { busy: number; log: number; checkpointed: number } {
  const row = node.get<{ busy: number; log: number; checkpointed: number }>(
    "PRAGMA wal_checkpoint(TRUNCATE)",
  );
  return {
    busy: Number(row?.busy ?? -1),
    log: Number(row?.log ?? -1),
    checkpointed: Number(row?.checkpointed ?? -1),
  };
}

/**
 * `sales` sales in `rounds` rounds with an idle pause after each — S4's cadence, so figures compare
 * with its recorded control arm. The side file is read on both sides of every pause, because a
 * checkpoint during the pause can leave the file at its high-water mark (S4's note on `driveLoad`).
 */
export async function driveLoad(
  node: NodeDb,
  dbPath: string,
  sales: number,
  rounds: number,
  idleMs: number,
): Promise<Load> {
  const latencies: number[] = [];
  const walByRound: number[] = [];
  const perRound = Math.ceil(sales / rounds);
  let peak = 0;
  let sold = 0;
  for (let round = 0; round < rounds && sold < sales; round += 1) {
    for (let i = 0; i < perRound && sold < sales; i += 1, sold += 1) {
      const started = performance.now();
      recordSale(node, 1000 + (sold % 997));
      latencies.push(performance.now() - started);
    }
    peak = Math.max(peak, walBytes(dbPath));
    await sleep(idleMs);
    const after = walBytes(dbPath);
    peak = Math.max(peak, after);
    walByRound.push(after);
  }
  const ascending = [...latencies].sort((a, b) => a - b);
  const pct = (p: number) =>
    ascending[
      Math.min(ascending.length - 1, Math.max(0, Math.ceil((p / 100) * ascending.length) - 1))
    ] ?? 0;
  return {
    peakWalBytes: peak,
    walByRound,
    p50Ms: round3(pct(50)),
    p99Ms: round3(pct(99)),
    maxMs: round3(ascending.at(-1) ?? 0),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The probe's one Markdown table row: whitespace in a string value is JSON-quoted, `|` escaped. */
export function report(
  probe: string,
  verdict: string,
  detail: Record<string, string | number | boolean | null>,
): void {
  const text = Object.entries(detail)
    .map(([key, value]) => {
      if (typeof value !== "string") return `${key}=${String(value)}`;
      const quoted = /[\s|]/.test(value) ? JSON.stringify(value) : value;
      return `${key}=${quoted.replaceAll("|", "\\|")}`;
    })
    .join(" ");
  console.log(`| ${probe} | ${verdict} | ${text} |`);
}
