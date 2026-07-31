import { readFileSync } from "node:fs";

// Decides whether a change can affect anything but prose, so CI can skip the expensive jobs when it
// cannot. Design: docs/superpowers/specs/2026-07-31-scoped-ci-design.md §3.4.
//
// The rule is an ALLOWLIST OF PATHS, never a file extension. A `**/*.md` rule looks equivalent and
// is not: packages/verifactu/schemas/README.md holds the SHA-256 of every AEAT schema file, and
// packages/verifactu/src/schemas.test.ts:40-48 asserts they match — a test whose stated purpose is
// catching someone editing a primary source to make a test pass. Extension-matching would let
// exactly that edit skip exactly that test.

/**
 * True when a change to `path` cannot affect any test, build or type-check result.
 *
 * Inert means: anywhere under `docs/`, or a Markdown file at the repository root. Everything else —
 * including Markdown inside a package — is code.
 */
export function isInertPath(path) {
  if (path.startsWith("docs/")) return true;
  // No slash means repository root. CLAUDE.md, README.md, CONTRIBUTING.md.
  if (path.endsWith(".md") && !path.includes("/")) return true;
  return false;
}

/**
 * Classifies a list of changed paths.
 *
 * Fails closed: an empty list means the diff could not be worked out (a force-push, a new branch,
 * an all-zero `github.event.before`), which is a reason to run everything rather than nothing.
 */
export function classify(paths) {
  const meaningful = paths.map((p) => p.trim()).filter((p) => p.length > 0);

  if (meaningful.length === 0) {
    return { code: true, reason: "no changed paths could be determined — running everything" };
  }

  const firstCodePath = meaningful.find((p) => !isInertPath(p));

  return firstCodePath === undefined
    ? { code: false, reason: `all ${meaningful.length} changed path(s) are documentation` }
    : { code: true, reason: `${firstCodePath} is not documentation` };
}

/** The package the heavy shard exists for: 189s of the old 387s test step, on its own runner. */
export const HEAVY_PACKAGE = "@waitron/db";

/**
 * True when the heavy shard has work to do, given the JSON output of
 * `pnpm --filter "<scope>" ls --depth -1 --json`.
 *
 * Membership of the RESOLVED SCOPE is the only formulation that is right in all three cases, and
 * the two obvious alternatives are both wrong — measured, see the design spec §3.6:
 *
 *   - a second inclusion filter (`--filter "<scope>" --filter "@waitron/db"`) is OR-ed, not
 *     intersected, so it runs the 189s suite on every code change whether or not db is involved;
 *   - `@waitron/db[<base>]` intersects with the CHANGED set rather than changed-plus-dependents,
 *     so it selects NOTHING when one of db's own dependencies changed — a false skip, which is the
 *     dangerous direction.
 *
 * Fails closed on unparseable input: running a shard that was not needed costs 189s, while skipping
 * one that was needed ships an untested packages/db.
 */
export function needsHeavyShard(scopedPackagesJson) {
  const raw = scopedPackagesJson.trim();
  if (raw === "") return false;

  let packages;
  try {
    packages = JSON.parse(raw);
  } catch {
    return true;
  }

  return packages.some((pkg) => pkg.name === HEAVY_PACKAGE);
}

/** Renders a classification as the single GitHub Actions output line the workflow consumes. */
export function formatOutput(paths) {
  return `code=${classify(paths).code}`;
}

// CLI, two subcommands, both reading stdin:
//   classify  — changed paths, one per line   → `code=<bool>`
//   heavy     — `pnpm ls --json` output       → `heavy=<bool>`
// Kept to the smallest possible body: every decision worth testing lives in the exported functions
// above. What is left is the stream split — stdout is appended verbatim to `$GITHUB_OUTPUT`, so it
// carries the `code=`/`heavy=` line and nothing else, while the reason goes to stderr for whoever
// reads the job log. No exported function can show that, so changed-scope.test.mjs spawns this file
// with `spawnSync` and reads the two streams apart.
//
// Ignored for coverage because those tests run it in a CHILD process, and the v8 provider only
// measures the module graph loaded into the test process — so this block reads as 0% however
// thoroughly it is exercised. Ignored for being unmeasurable, not for being untested: delete the
// `describe("the CLI")` suite and six assertions about this block's behaviour go with it.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("changed-scope.mjs")) {
  const stdin = readFileSync(0, "utf8");

  if (process.argv[2] === "heavy") {
    const heavy = needsHeavyShard(stdin);
    console.error(`changed-scope: heavy=${heavy}`);
    console.log(`heavy=${heavy}`);
  } else {
    const paths = stdin.split("\n");
    const { code, reason } = classify(paths);
    console.error(`changed-scope: code=${code} (${reason})`);
    console.log(formatOutput(paths));
  }
}
/* v8 ignore stop */
