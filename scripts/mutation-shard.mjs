import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Splits @waitron/db's mutation targets across N CI shards so each fits GitHub's 6h job limit.
 *
 * The unit of a slice is usually a whole file, but a file whose mutants are covered by nearly the
 * whole suite can dominate a shard alone, so HEAVY_FILES (in the CLI below) names such files and
 * `splitRanges` cuts each into Stryker `file.ts:startLine-endLine` ranges.
 */

/**
 * Files under `packages/db/src` that this package's own Stryker run cannot score, as `src/`-relative
 * paths. The shard lists leave them out, so the package's merged score (scripts/mutation-aggregate.mjs)
 * measures only mutants a test written here could kill.
 *
 * `src/english-only.ts`: its suite is `scripts/english-only.test.ts` in the ROOT vitest project, and
 * nothing under `packages/db` imports it, so `packages/db`'s vitest config never loads a test that
 * touches it and every one of its mutants survives by construction.
 *
 * @type {string[]}
 */
export const NOT_MUTATED = ["src/english-only.ts"];

/** Contiguous ranges covering lines 1..`lineCount` with no gaps or overlaps. */
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
 * Greedy bin-packing by file size, a proxy for mutant count. Deterministic, because every CI shard
 * computes the whole split independently and takes only its own slice.
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
// `--mutate` list for that 1-based shard, as paths relative to `packages/db`. Ignored for coverage
// because its suite runs it in a CHILD process, which the v8 provider does not see.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("mutation-shard.mjs")) {
  const shardIndex = Number(process.argv[2]);
  const totalShards = Number(process.argv[3]);

  // An empty list would make the workflow run `stryker run --mutate ""`, a confusing no-op.
  const die = (message) => {
    console.error(`mutation-shard: ${message}`);
    process.exit(1);
  };
  if (!Number.isInteger(totalShards) || totalShards < 1)
    die(`totalShards must be a positive integer, got "${process.argv[3]}"`);
  if (!Number.isInteger(shardIndex) || shardIndex < 1 || shardIndex > totalShards)
    die(`shard must be an integer in 1..${totalShards}, got "${process.argv[2]}"`);

  // A rename must not silently un-split a file, hence the check after the walk.
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
        if (NOT_MUTATED.includes(path)) continue;
        const parts = HEAVY_FILES[path];
        if (parts) {
          seenHeavy.add(path);
          const lineCount = readFileSync(full, "utf8").split("\n").length;
          // Weight each range by the WHOLE file's size, not its share, so the packer places the
          // ranges early, while shards are still near-empty, and each lands in a distinct shard.
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
