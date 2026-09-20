import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Merges the ten `mutation-db` shard reports into ONE score for `packages/db`.
 *
 * Each shard mutates its own slice and publishes its own report, so a `thresholds.break` in
 * `packages/db/stryker.config.json` would gate each SLICE rather than the package (a shard holding
 * the well-tested files passes while the package as a whole is far below the bar). This reads every
 * shard's json report, adds the mutants up, and gates the total.
 *
 * Status handling follows Stryker's own definition of the mutation score: killed and timed-out
 * mutants are detected, survived and never-covered ones are not, and everything else — an ignored
 * mutant, one that would not compile, one whose test run errored — is outside the ratio.
 */
const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/**
 * @param {{files: Record<string, {mutants: {id: string, mutatorName: string, status: string, replacement?: string, location: {start: {line: number, column: number}}}[]}>}[]} reports
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
        const key = `${mutant.mutatorName}@${mutant.location.start.line}:${mutant.location.start.column}=${mutant.replacement ?? ""}`;
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

/** A run with nothing to measure scores zero — never NaN, which every comparison lets through. */
function ratio(killed, valid) {
  return valid === 0 ? 0 : (100 * killed) / valid;
}

/** Every `*.json` under `dir`, at any depth. */
export function findReports(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findReports(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out.sort();
}

// CLI: `node scripts/mutation-aggregate.mjs <dir> --shards <n> --break <score>` reads every json
// report under <dir> — the directory the workflow downloads the shard artifacts into — and prints
// one score for the package, exiting 1 below `--break`. Ignored for coverage because the suite
// exercises it in a CHILD process, which the v8 provider does not see; the unit tests above cover
// `aggregate` in-process. Same arrangement, and the same reason, as mutation-shard.mjs.
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
  // A shard whose job failed uploads nothing, and the slice it holds is usually the one nobody has
  // written tests for, so scoring what did arrive reports a number that is too high.
  if (paths.length !== shards)
    die(`expected ${shards} shard reports under ${dir}, found ${paths.length} report(s)`);

  const result = aggregate(paths.map((path) => JSON.parse(readFileSync(path, "utf8"))));
  for (const file of result.files)
    if (file.score < breakAt)
      console.log(
        `${file.score.toFixed(2).padStart(7)}%  ${String(file.killed).padStart(5)}/${String(file.valid).padEnd(5)}  ${file.path}`,
      );
  console.log(
    `\n@waitron/db mutation score ${result.score.toFixed(2)}% (${result.killed} of ${result.valid} mutants detected, ${paths.length} shards)`,
  );
  if (result.score < breakAt)
    die(`score ${result.score.toFixed(2)}% is below the break threshold of ${breakAt}`);
}
/* v8 ignore stop */
