// Builds packages/<package>/mutation-costs.json, the per-file seconds scripts/mutation-shard.mjs
// packs that package's shards by, from the Stryker JSON reports of a nightly run's shards. Usage:
//   node scripts/mutation-costs.mjs <package> <out.json> <mutation.json> [<mutation.json> …]

import { readFileSync, writeFileSync } from "node:fs";
import { inspect } from "node:util";

import { HEAVY_FILES, packageSelection } from "./mutation-shard.mjs";

// Fitted charges: docs/developers/ci-and-gates.md, "db's mutation shards are packed by estimated cost".
export const DURATION_FACTOR = 0.3585;
export const MUTANT_SECONDS = 0.1222;
export const TIMEOUT_SECONDS = 82.2;

const UNTESTED = new Set(["NoCoverage", "Ignored", "CompileError", "RuntimeError"]);

export function fileSecondsFromReport(report) {
  const seconds = new Map();
  for (const [path, { mutants }] of Object.entries(report.files)) {
    let total = 0;
    for (const mutant of mutants) {
      if (UNTESTED.has(mutant.status)) continue;
      const duration = mutant.duration ?? 0;
      if (!Number.isFinite(duration) || duration < 0) {
        throw new Error(
          `${path}: a tested mutant's duration is ${inspect(duration)}, not a number of milliseconds ≥ 0`,
        );
      }
      total += (DURATION_FACTOR * duration) / 1000 + MUTANT_SECONDS;
      // A timed-out mutant's `duration` is short; the wait it cost is not recorded.
      if (mutant.status === "Timeout") total += TIMEOUT_SECONDS;
    }
    seconds.set(path, total);
  }
  // A file with no mutant is absent from `files`; the shard's own `--mutate` list still names it.
  for (const entry of report.config?.mutate ?? []) {
    const path = entry.replace(/:\d+-\d+$/, "");
    if (!seconds.has(path)) seconds.set(path, 0);
  }
  return seconds;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Each file's median seconds over `reports`, for the files in `selected` (the package's current
 * mutate selection), leaving out `splitPaths`, whose reports hold one range each.
 */
export function costTable(reports, splitPaths, selected) {
  const kept = new Set(selected);
  for (const path of splitPaths) kept.delete(path);
  const byPath = new Map();
  for (const report of reports) {
    for (const [path, seconds] of report) {
      if (!kept.has(path)) continue;
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(seconds);
    }
  }
  const table = {};
  for (const path of [...byPath.keys()].sort()) {
    // The sharder needs every weight above zero.
    table[path] = Math.max(0.1, Math.round(median(byPath.get(path)) * 10) / 10);
  }
  return table;
}

export function main(argv, { selection, readFile, writeFile, stderr }) {
  if (argv.length < 3) {
    stderr(
      "usage: node scripts/mutation-costs.mjs <package> <out.json> <mutation.json> [<mutation.json> …]",
    );
    return 2;
  }
  const [pkg, out, ...reports] = argv;
  if (!Object.hasOwn(HEAVY_FILES, pkg)) {
    stderr(`unknown package "${pkg}" — expected one of ${Object.keys(HEAVY_FILES).join(", ")}`);
    return 2;
  }
  const selected = selection(pkg);
  const seconds = [];
  for (const path of reports) {
    const parsed = JSON.parse(readFile(path));
    try {
      for (const target of parsed.config?.mutate ?? []) {
        const file = target.replace(/:\d+-\d+$/, "");
        if (file !== target && selected.includes(file) && !Object.hasOwn(HEAVY_FILES[pkg], file)) {
          stderr(
            `${file} is now mutated whole; ${path} holds only a line range; use reports from later runs; ${out} left unchanged`,
          );
          return 1;
        }
      }
      seconds.push(fileSecondsFromReport(parsed));
    } catch (error) {
      stderr(`malformed report ${path}: ${error.message}; ${out} left unchanged`);
      return 1;
    }
  }
  const table = costTable(seconds, Object.keys(HEAVY_FILES[pkg]), selected);
  if (Object.keys(table).length === 0) {
    stderr(`no mutated files in the reports; ${out} left unchanged`);
    return 1;
  }
  writeFile(out, `${JSON.stringify(table, null, 2)}\n`);
  return 0;
}

// Ignored for coverage because its tests run it in a CHILD process, which the v8 provider does not
// measure.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("mutation-costs.mjs")) {
  process.exitCode = main(process.argv.slice(2), {
    selection: (pkg) => packageSelection(pkg).paths,
    readFile: (file) => readFileSync(file, "utf8"),
    writeFile: (file, text) => writeFileSync(file, text),
    stderr: (line) => console.error(line),
  });
}
/* v8 ignore stop */
