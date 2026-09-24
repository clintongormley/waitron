import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Merges the `mutation-db` shard reports into ONE score for `packages/db`.
 *
 * Each shard mutates its own slice and publishes its own report, so a `thresholds.break` in
 * `packages/db/stryker.config.json` would gate each SLICE rather than the package. This reads every
 * shard's json report, adds the mutants up, and gates the total.
 *
 * Status handling follows Stryker's own definition of the mutation score.
 */
const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/**
 * @param {{files: Record<string, {mutants: {id: string, mutatorName: string, status: string, replacement?: string, location: {start: {line: number, column: number}, end: {line: number, column: number}}}[]}>}[]} reports
 * @returns {{score: number, killed: number, valid: number, files: {path: string, score: number, killed: number, valid: number}[]}}
 */
export function aggregate(reports) {
  /** @type {Map<string, Map<string, string>>} one status per file per distinct mutant. */
  const byFile = new Map();
  for (const report of reports)
    for (const [path, file] of Object.entries(report.files ?? {})) {
      const mutants = byFile.get(path) ?? new Map();
      byFile.set(path, mutants);
      for (const mutant of file.mutants ?? []) {
        // Keyed by what the mutant IS rather than by its id: ids are handed out per run, so the
        // same id in two shards can mean two different mutants, and the same mutant in two shards
        // (a file split into line ranges is mutated by several) can carry two different ids.
        //
        // The END of the span is part of that identity, not decoration. `a && b` gives Stryker two
        // ConditionalExpression mutants that both replace with `true` and both START at the same
        // column — the whole condition, and its left operand. Keyed on the start alone the two
        // merge into one, and `Map.set` keeps whichever report was read last, so the package's
        // score moves with the order the shard artifacts happen to be listed in.
        const { start, end } = mutant.location;
        const key = `${mutant.mutatorName}@${start.line}:${start.column}-${end.line}:${end.column}=${mutant.replacement ?? ""}`;
        // A mutant two reports disagree about resolves the same way whichever order the shard
        // artifacts are listed in: undetected beats detected, and either beats a status outside
        // the ratio.
        //
        // The two steps are there for different reasons, and only the first is a safety property.
        // Undetected over detected is what stops a merge RAISING the score. Detected over a
        // status outside the ratio does the opposite — keeping a `Killed` over an `Ignored` adds
        // 1/1 to the ratio — and it is there because a shard that actually ran the mutant knows
        // more than one that skipped it.
        const seen = mutants.get(key);
        if (seen !== undefined && weight(seen) >= weight(mutant.status)) continue;
        mutants.set(key, mutant.status);
      }
    }

  const files = [];
  let killed = 0;
  let valid = 0;
  for (const [path, mutants] of byFile) {
    let fileKilled = 0;
    let fileValid = 0;
    for (const status of mutants.values()) {
      if (DETECTED.has(status)) fileKilled += 1;
      else if (!UNDETECTED.has(status)) continue;
      fileValid += 1;
    }
    killed += fileKilled;
    valid += fileValid;
    files.push({ path, killed: fileKilled, valid: fileValid, score: ratio(fileKilled, fileValid) });
  }
  files.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
  return { score: ratio(killed, valid), killed, valid, files };
}

/** Which status wins when two reports disagree about one mutant: undetected, then detected. */
function weight(status) {
  if (UNDETECTED.has(status)) return 2;
  if (DETECTED.has(status)) return 1;
  return 0;
}

/** A run with nothing to measure scores zero — never NaN, which every comparison lets through. */
function ratio(killed, valid) {
  return valid === 0 ? 0 : (100 * killed) / valid;
}

/** Every json under `dir` that IS a mutation report — it parses, and it carries a `files` object. */
export function findReports(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findReports(full));
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    if (typeof parsed?.files === "object" && parsed.files !== null) out.push(full);
  }
  return out.sort();
}

// CLI: `node scripts/mutation-aggregate.mjs <dir> --shards <n> --break <score>` reads every json
// report under <dir> — the directory the workflow downloads the shard artifacts into — and prints
// one score for the package, exiting 1 below `--break`. Ignored for coverage because the suite
// exercises it in a CHILD process, which the v8 provider does not see.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("mutation-aggregate.mjs")) {
  const die = (message) => {
    console.error(`mutation-aggregate: ${message}`);
    process.exit(1);
  };
  const flag = (name) => {
    const at = process.argv.indexOf(`--${name}`);
    return at === -1 ? undefined : process.argv[at + 1];
  };

  const dir = process.argv[2];
  if (dir === undefined || dir.startsWith("--"))
    die("usage: mutation-aggregate.mjs <dir> --shards <n> --break <score>");
  const shards = Number(flag("shards"));
  const breakAt = Number(flag("break"));
  if (!Number.isInteger(shards) || shards < 1) die(`--shards must be a positive integer`);
  if (!Number.isFinite(breakAt)) die(`--break must be a number`);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) die(`no such directory: ${dir}`);

  const paths = findReports(dir);
  // A shard whose job failed uploads nothing. Counted by the directory each report sits in — one
  // artifact per shard — so a second json in one shard's directory cannot stand in for a shard
  // that never arrived.
  const directories = new Set(paths.map((path) => dirname(path)));
  if (directories.size !== shards)
    die(
      `expected ${shards} shard reports under ${dir}, found ${directories.size} in ${paths.length} file(s)`,
    );

  const result = aggregate(paths.map((path) => JSON.parse(readFileSync(path, "utf8"))));
  for (const file of result.files)
    if (file.score < breakAt)
      console.log(
        `${file.score.toFixed(2).padStart(7)}%  ${String(file.killed).padStart(5)}/${String(file.valid).padEnd(5)}  ${file.path}`,
      );
  console.log(
    `\n@waitron/db mutation score ${result.score.toFixed(2)}% (${result.killed} of ${result.valid} mutants detected, ${directories.size} shards)`,
  );
  if (result.score < breakAt)
    die(`score ${result.score.toFixed(2)}% is below the break threshold of ${breakAt}`);
}
/* v8 ignore stop */
