import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Splits the mutation targets across N CI shards so each fits GitHub's 6h job limit.
 *
 * Stryker over @waitron/db is ~10h on one 2-vCPU runner because it mutates ~750 database-backed
 * mutants serially-ish; sharded across a matrix, each job mutates only its slice and runs in
 * parallel. `assignShards` decides the slices, `--mutate`d one list per shard.
 *
 * The unit of a slice is usually a whole file, but a single file can dominate a shard when its
 * mutants are covered by ~the whole suite (measured: src/schema/sales.ts alone ran 186min while
 * every other N=10 shard finished <=90min). Such a file is split into line-range slices — Stryker's
 * `file.ts:startLine-endLine` mutation-range syntax — by `splitRanges`, so its cost spreads across
 * shards too. HEAVY_FILES (in the CLI below) names them and into how many parts.
 */

/**
 * Splits `path` into `parts` contiguous Stryker mutation ranges (`path:startLine-endLine`) covering
 * lines 1..`lineCount`, as evenly as possible (the first `lineCount % parts` ranges get one extra
 * line). No gaps, no overlaps — every line lands in exactly one range.
 *
 * @param {string} path
 * @param {number} lineCount
 * @param {number} parts
 * @returns {string[]}
 */
export function splitRanges(path, lineCount, parts) {
  const base = Math.floor(lineCount / parts);
  const extra = lineCount % parts;
  const ranges = [];
  let start = 1;
  for (let i = 0; i < parts; i++) {
    const end = start + base + (i < extra ? 1 : 0) - 1;
    ranges.push(`${path}:${start}-${end}`);
    start = end + 1;
  }
  return ranges;
}

/**
 * Partitions `files` into `totalShards` groups, balanced by size so no shard gets all the heavy
 * files (file size is a proxy for mutant count). Greedy bin-packing: largest file first, each onto
 * the currently-lightest shard. Deterministic — files sort by size desc then path, and each shard's
 * paths are returned sorted — so a given (files, totalShards) always yields the same split.
 *
 * @param {{path: string, size: number}[]} files
 * @param {number} totalShards
 * @returns {string[][]} one path array per shard, length === totalShards
 */
export function assignShards(files, totalShards) {
  const shards = Array.from({ length: totalShards }, () => ({ paths: [], weight: 0 }));

  const ordered = [...files].sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
  for (const file of ordered) {
    const lightest = shards.reduce((min, s) => (s.weight < min.weight ? s : min));
    lightest.paths.push(file.path);
    lightest.weight += file.size;
  }

  return shards.map((s) => s.paths.sort());
}

// CLI: `node scripts/mutation-shard.mjs <shard> <totalShards>` prints the comma-separated
// `--mutate` file list for that shard (1-based), as `src/`-relative paths a `stryker run` launched
// from `packages/db` consumes directly. Ignored for coverage because scripts/mutation-shard.test.mjs
// exercises it in a CHILD process, which the v8 provider does not see; the unit suite covers
// assignShards in-process.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("mutation-shard.mjs")) {
  const shardIndex = Number(process.argv[2]);
  const totalShards = Number(process.argv[3]);

  // Fail loudly rather than crash with a TypeError or, worse, print an empty list that would make
  // the workflow run `stryker run --mutate ""` — a confusing no-op. Raised by Copilot on PR #115.
  const die = (message) => {
    console.error(`mutation-shard: ${message}`);
    process.exit(1);
  };
  if (!Number.isInteger(totalShards) || totalShards < 1)
    die(`totalShards must be a positive integer, got "${process.argv[3]}"`);
  if (!Number.isInteger(shardIndex) || shardIndex < 1 || shardIndex > totalShards)
    die(`shard must be an integer in 1..${totalShards}, got "${process.argv[2]}"`);

  // A file whose mutants are covered by ~the whole suite dominates its shard even alone: measured on
  // run 32384997149, src/schema/sales.ts ran 186min while every other N=10 shard finished <=90min
  // (it is the most-covered fiscal table). Split it into line-range slices so its cost spreads. The
  // guard below fails loudly if a named file no longer exists — a rename must not silently un-split.
  const HEAVY_FILES = { "src/schema/sales.ts": 3 };
  const seenHeavy = new Set();

  const dbSrc = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "db", "src");
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        const path = join("src", relative(dbSrc, full));
        const parts = HEAVY_FILES[path];
        if (parts) {
          seenHeavy.add(path);
          const lineCount = readFileSync(full, "utf8").split("\n").length;
          // Weight each range by the WHOLE file's size, not its share: heavy enough that the packer
          // places the (equal-weight) ranges early, while shards are still near-empty, so each lands
          // in a distinct shard. A per-share weight is too light — the ranges get placed late and a
          // single light shard can absorb two of them (observed).
          for (const range of splitRanges(path, lineCount, parts))
            files.push({ path: range, size: statSync(full).size });
        } else {
          files.push({ path, size: statSync(full).size });
        }
      }
    }
  };
  walk(dbSrc);

  for (const heavy of Object.keys(HEAVY_FILES))
    if (!seenHeavy.has(heavy))
      die(
        `HEAVY_FILES names "${heavy}" but no such mutate-eligible file exists — renamed or removed?`,
      );

  const shard = assignShards(files, totalShards)[shardIndex - 1];
  if (shard.length === 0)
    die(
      `shard ${shardIndex}/${totalShards} selected no files — more shards than the ${files.length} mutate slices?`,
    );

  console.log(shard.join(","));
}
/* v8 ignore stop */
