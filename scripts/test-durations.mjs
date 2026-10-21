// Builds apps/server/test-durations.json, the per-file seconds the duration sequencer packs shards
// by, from `gh run view --log` output of CI's test-server shards. Usage:
//   node scripts/test-durations.mjs <out.json> <log> [<log> …]

import { readFileSync, writeFileSync } from "node:fs";

const END_LINE = /\[file-progress\] end (\S+)(?: \[[^\]]*\])? \S+ (\d+(?:\.\d+)?)s$/;

export function fileSecondsFromLog(text) {
  const seconds = new Map();
  for (const line of text.split("\n")) {
    const match = END_LINE.exec(line.trimEnd());
    if (match) seconds.set(match[1], Number(match[2]));
  }
  return seconds;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function medianTable(logs) {
  const byPath = new Map();
  for (const log of logs) {
    for (const [file, seconds] of log) {
      if (!byPath.has(file)) byPath.set(file, []);
      byPath.get(file).push(seconds);
    }
  }
  const table = {};
  for (const file of [...byPath.keys()].sort()) {
    // The reporter prints tenths, so a quick file can read 0.0s; the sequencer needs every
    // value above zero.
    table[file] = Math.max(0.1, Math.round(median(byPath.get(file)) * 10) / 10);
  }
  return table;
}

export function main(argv, { readFile, writeFile, stderr }) {
  if (argv.length < 2) {
    stderr("usage: node scripts/test-durations.mjs <out.json> <log> [<log> …]");
    return 2;
  }
  const [out, ...logs] = argv;
  const table = medianTable(logs.map((log) => fileSecondsFromLog(readFile(log))));
  writeFile(out, `${JSON.stringify(table, null, 2)}\n`);
  return 0;
}

// Ignored for coverage: the tests call `main` directly, and this block only wires it to the process.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("test-durations.mjs")) {
  process.exitCode = main(process.argv.slice(2), {
    readFile: (file) => readFileSync(file, "utf8"),
    writeFile: (file, text) => writeFileSync(file, text),
    stderr: (line) => console.error(line),
  });
}
/* v8 ignore stop */
