import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, matchesGlob, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Splits a package's mutation targets across N CI shards so each fits its job's time limit.
 *
 * What is mutated comes from the package's own `stryker.config.json` `mutate` list, so a CI shard
 * and a local `pnpm --filter <package> mutation` measure the same files. The unit of a slice is
 * usually a whole file; HEAVY_FILES names the files cut into Stryker `file.ts:startLine-endLine`
 * ranges by `splitRanges`.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Per package, the files cut into that many line ranges, each range run in a shard of its own. A
 * file's bytes do not predict its cost: what costs is how many tests cover each mutant. A mutant
 * whose span crosses a range boundary is in neither range, so no shard mutates it and the merged
 * score leaves it out (instrumenter 10.0.0; 2 in db and 26 in ui at the splits of 2026-10-12).
 *
 * db: `src/schema/sales.ts` alone ran 186min while every other N=10 shard finished <=90min
 * (run 32384997149).
 * ui, run 38233718266 (30-minute limit): wt-combobox.ts alone hit the limit at 716 of 780 mutants;
 * wt-data-table.ts in 4 ranges took 4.4, 28.7, 10.3 and 19.5min; wt-dialog.ts alone hit the
 * limit at 325 of 382, 21% of its mutants static and 42 timed out.
 *
 * @type {Record<string, Record<string, number>>}
 */
export const HEAVY_FILES = {
  db: { "src/schema/sales.ts": 3 },
  ui: {
    "src/components/wt-combobox.ts": 4,
    "src/components/wt-data-table.ts": 12,
    "src/components/wt-dialog.ts": 6,
  },
};

/**
 * The files under `packageDir/src` Stryker's `mutate` list selects, as `packageDir`-relative paths,
 * sorted. The patterns apply in order, as in Stryker's `ProjectReader`: a positive pattern adds the
 * files it matches and a `!` pattern removes them, so a later pattern overrides an earlier one.
 */
export function mutateFiles(packageDir, mutatePatterns) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const path = relative(packageDir, full).split(sep).join("/");
        let selected = false;
        for (const pattern of mutatePatterns) {
          const exclude = pattern.startsWith("!");
          if (matchesGlob(path, exclude ? pattern.slice(1) : pattern)) selected = !exclude;
        }
        if (selected) out.push(path);
      }
    }
  };
  walk(join(packageDir, "src"));
  return out.sort();
}

/** The HEAVY_FILES entries `files` does not hold, so a rename cannot silently un-split a file. */
export function missingHeavyFiles(heavy, files) {
  return Object.keys(heavy).filter((path) => !files.includes(path));
}

/**
 * The 1-based `shard` of `total` for package `pkg` under `root`, as `--mutate` entries. Throws
 * on bad input rather than returning an empty list, which would make `stryker run --mutate ""` a
 * confusing no-op.
 */
export function shardFiles(pkg, shard, total, root = REPO_ROOT) {
  const heavy = Object.hasOwn(HEAVY_FILES, pkg) ? HEAVY_FILES[pkg] : undefined;
  if (heavy === undefined)
    throw new Error(
      `unknown package "${pkg}" — expected one of ${Object.keys(HEAVY_FILES).join(", ")}`,
    );
  if (!Number.isInteger(total) || total < 1)
    throw new Error(`totalShards must be a positive integer, got "${total}"`);
  if (!Number.isInteger(shard) || shard < 1 || shard > total)
    throw new Error(`shard must be an integer in 1..${total}, got "${shard}"`);

  const packageDir = join(root, "packages", pkg);
  const config = JSON.parse(readFileSync(join(packageDir, "stryker.config.json"), "utf8"));
  const paths = mutateFiles(packageDir, config.mutate);

  const missing = missingHeavyFiles(heavy, paths);
  if (missing.length > 0)
    throw new Error(
      `HEAVY_FILES names "${missing[0]}" but no such mutate-eligible file exists — renamed or removed?`,
    );

  // Shards 1..ranges.length are the heavy files' ranges, files by path and ranges by line; the
  // other files are packed by bytes into the shards after them.
  const ranges = Object.keys(heavy)
    .sort()
    .flatMap((path) => {
      const lineCount = readFileSync(join(packageDir, path), "utf8").split("\n").length;
      return splitRanges(path, lineCount, heavy[path]);
    });
  const others = paths
    .filter((path) => !Object.hasOwn(heavy, path))
    .map((path) => ({ path, size: statSync(join(packageDir, path)).size }));
  if (total < ranges.length || (total === ranges.length && others.length > 0))
    throw new Error(
      `${total} shards cannot hold the ${ranges.length} heavy ranges plus the other files — raise the shard count`,
    );

  const shards = [
    ...ranges.map((range) => [range]),
    ...assignShards(others, total - ranges.length),
  ];
  const selected = shards[shard - 1];
  if (selected.length === 0)
    throw new Error(
      `shard ${shard}/${total} selected no files — more shards than the ${ranges.length + others.length} mutate slices?`,
    );
  return selected;
}

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

// CLI: `node scripts/mutation-shard.mjs <package> <shard> <totalShards>` prints the
// comma-separated `--mutate` list for that 1-based shard, as paths relative to `packages/<package>`.
// Ignored for coverage because its suite runs it in a CHILD process, which the v8 provider does not
// see.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("mutation-shard.mjs")) {
  try {
    const [pkg, shard, total] = process.argv.slice(2);
    console.log(shardFiles(pkg, Number(shard), Number(total)).join(","));
  } catch (error) {
    console.error(`mutation-shard: ${error.message}`);
    process.exit(1);
  }
}
/* v8 ignore stop */
