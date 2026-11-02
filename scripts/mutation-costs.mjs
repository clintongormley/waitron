// Builds packages/<package>/mutation-costs.json, the per-file seconds scripts/mutation-shard.mjs
// packs that package's shards by, from the Stryker JSON reports of a nightly run's shards. Usage:
//   node scripts/mutation-costs.mjs <package> <out.json> <mutation.json> [<mutation.json> …]

import { readFileSync, writeFileSync } from "node:fs";

import { HEAVY_FILES } from "./mutation-shard.mjs";

// A Stryker report records no time per mutant, so a file's seconds are estimated. These three
// charges are a least-squares fit of the mutation phase of 29 db shard runs against their
// reports (2026-10-31 to 2026-11-02), error 113 s root-mean-square; the receipt is in
// docs/developers/ci-and-gates.md, "db's mutation shards are packed by estimated cost".
export const MUTANT_SECONDS = 0.694;
export const TEST_FILE_SECONDS = 0.084;
export const TIMEOUT_SECONDS = 82.2;

const UNTESTED = new Set(["NoCoverage", "Ignored", "CompileError", "RuntimeError"]);

export function fileSecondsFromReport(report) {
  const fileOfTest = new Map();
  for (const [path, { tests }] of Object.entries(report.testFiles ?? {}))
    for (const test of tests) fileOfTest.set(test.id, path);

  const seconds = new Map();
  for (const [path, { mutants }] of Object.entries(report.files)) {
    let total = 0;
    for (const mutant of mutants) {
      if (UNTESTED.has(mutant.status)) continue;
      const testFiles = new Set((mutant.coveredBy ?? []).map((id) => fileOfTest.get(id)));
      total += MUTANT_SECONDS + TEST_FILE_SECONDS * testFiles.size;
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

/** Each file's median seconds over `reports`, leaving out `splitPaths`, whose reports hold one range each. */
export function costTable(reports, splitPaths) {
  const byPath = new Map();
  for (const report of reports) {
    for (const [path, seconds] of report) {
      if (splitPaths.includes(path)) continue;
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

export function main(argv, { readFile, writeFile, stderr }) {
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
  const table = costTable(
    reports.map((path) => fileSecondsFromReport(JSON.parse(readFile(path)))),
    Object.keys(HEAVY_FILES[pkg]),
  );
  if (Object.keys(table).length === 0) {
    stderr(`no mutated files in the reports; ${out} left unchanged`);
    return 1;
  }
  writeFile(out, `${JSON.stringify(table, null, 2)}\n`);
  return 0;
}

// Ignored for coverage because nothing runs it in-process; its suite calls `main` directly.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("mutation-costs.mjs")) {
  process.exitCode = main(process.argv.slice(2), {
    readFile: (file) => readFileSync(file, "utf8"),
    writeFile: (file, text) => writeFileSync(file, text),
    stderr: (line) => console.error(line),
  });
}
/* v8 ignore stop */
