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
 * Every job gated on one package being in the resolved scope, in the order the CLI emits them.
 *
 * `heavy` was the first, and the two mutation jobs joined it on a measurement rather than a
 * principle. Read off run 30650089655 (`gh run view 30650089655 --json createdAt,updatedAt,jobs`,
 * head 4926cf5): the run spanned 4m8s, `mutation-verifactu` was 3m26s of it, and every other job
 * had finished 1m39s in — with both mutation jobs gated on `code` alone, so both ran on any code
 * change at all, however far from `packages/verifactu` or `packages/shared`. That made mutation the
 * critical path for the common case, which is most of what the scoping was for.
 *
 * This list is the single source of truth for the gate names: ci.yml's `changes` job reads them
 * from here (including for the unscoped `main` run), so adding a gate is one edit here plus the job
 * that consumes it.
 */
export const SCOPE_GATES = [
  { output: "heavy", packageName: HEAVY_PACKAGE },
  { output: "verifactu", packageName: "@waitron/verifactu" },
  { output: "shared", packageName: "@waitron/shared" },
];

/**
 * The set of package names in the resolved scope, given the JSON output of
 * `pnpm --filter "<scope>" ls --depth -1 --json`, or `null` when that output cannot be parsed.
 *
 * `null` and the empty set are deliberately different answers. Empty is definite — `pnpm ls` emits
 * zero bytes on BOTH streams, and exits 0, when its filter matches nothing (measured on pnpm 9.15.0:
 * `pnpm --filter "@waitron/nope" ls --depth -1 --json` gives exit 0, 0 stdout bytes, 0 stderr bytes)
 * — while `null` is "we do not know", which `gateOutputs` turns into running everything.
 *
 * The input that makes the `Array.isArray` check worth writing: `pnpm ls --json` reports its OWN
 * ERRORS as valid JSON on STDOUT, not as a diagnostic on stderr. Measured on pnpm 9.15.0:
 *
 *   $ pnpm --filter "" ls --json 2>/dev/null
 *   {"error":{"code":"pnpm","message":"Unsupported package selector: …"}}
 *
 * That parses cleanly, so the shape — not the parse — is what separates a pnpm failure from a real
 * result. Getting it wrong reads a failure as "no packages in scope" and SKIPS every gated job,
 * which is the silent direction.
 *
 * Proven by deletion, on the code as it stands: remove the `Array.isArray` line and
 * `pnpm vitest run` reports `2 failed | 42 passed (44)` — the two tests naming this input. The
 * `try` wraps `JSON.parse` ONLY, so `parsed.map` on the error object throws outside it and
 * propagates as a TypeError instead of reaching `null`.
 *
 * An earlier version of this comment claimed the opposite — "expressive, not load-bearing" — from
 * an experiment that deleted the line AND moved `.map` back inside the `try`. That shape does land
 * on `null`, and did pass 42/42. Two different mutations, one of them written up as a result about
 * the other, which is the §1 shape this repository keeps paying for. State the experiment.
 */
export function packagesInScope(scopedPackagesJson) {
  const raw = scopedPackagesJson.trim();
  if (raw === "") return new Set();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  return new Set(parsed.map((pkg) => pkg.name));
}

/**
 * Renders every gate in `SCOPE_GATES` as a GitHub Actions output line, from ONE resolved scope.
 *
 * Pass `null` for "no narrowing applies": an unscoped run on `main`, or a `pnpm ls` result that
 * could not be parsed. Both fail closed to every gate running, because running a job that was not
 * needed costs runner time while skipping one that was needed ships an untested package.
 *
 * Membership of the RESOLVED SCOPE is the only formulation that is right in all three cases, and
 * the two obvious alternatives are both wrong. The design spec §3.6 measured this for
 * `@waitron/db`; the mechanism is the same whichever package a gate names, so the receipt below is
 * quoted in db's own terms rather than restated as a general claim nobody ran:
 *
 *   - a second inclusion filter (`--filter "<scope>" --filter "@waitron/db"`) is OR-ed, not
 *     intersected, so it runs the 189s suite on every code change whether or not db is involved;
 *   - `@waitron/db[<base>]` intersects with the CHANGED set rather than changed-plus-dependents,
 *     so it selects NOTHING when one of db's own dependencies changed — a false skip, which is the
 *     dangerous direction.
 *
 * The scope is changed-packages-and-their-dependents, so a gate fires when its package changed OR
 * when its package depends on something that changed. For the two mutation gates the second half is
 * inert today and will not stay that way by itself. Run in this workspace on 2026-07-31,
 * `pnpm --filter "@waitron/shared..." ls --depth -1` and
 * `pnpm --filter "@waitron/verifactu..." ls --depth -1` each print exactly one line, that package
 * itself, so neither has a workspace dependency to inherit a change from. Nothing enforces that,
 * and it is one package.json edit from being false — which is why the gate resolves membership
 * instead of matching the package name against the diff.
 */
export function gateOutputs(inScope) {
  return SCOPE_GATES.map(
    ({ output, packageName }) => `${output}=${inScope === null || inScope.has(packageName)}`,
  ).join("\n");
}

/** Renders a classification as the single GitHub Actions output line the workflow consumes. */
export function formatOutput(paths) {
  return `code=${classify(paths).code}`;
}

// CLI, two subcommands:
//   classify           — changed paths on stdin, one per line → `code=<bool>`
//   gates              — one `pnpm ls --json` result on stdin → one `<gate>=<bool>` line per gate
//   gates --unscoped   — no scope to resolve (main)           → every gate true, stdin ignored
// One `pnpm ls` invocation answers every gate, which is why `gates` emits the whole list rather than
// taking a gate name: the alternative was running the same workspace query once per gated job.
// Kept to the smallest possible body: every decision worth testing lives in the exported functions
// above. What is left is the stream split — stdout is appended verbatim to `$GITHUB_OUTPUT`, so it
// carries the output lines and nothing else, while the reason goes to stderr for whoever reads the
// job log. No exported function can show that, so changed-scope.test.mjs spawns this file with
// `spawnSync` and reads the two streams apart.
//
// Ignored for coverage because those tests run it in a CHILD process, and the v8 provider only
// measures the module graph loaded into the test process — so this block reads as 0% however
// thoroughly it is exercised. Ignored for being unmeasurable, not for being untested: delete the
// `describe("the CLI")` suite and six assertions about this block's behaviour go with it.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("changed-scope.mjs")) {
  // Read lazily. `gates --unscoped` is invoked with nothing piped into it, and its whole point is
  // that stdin is irrelevant — so it does not touch fd 0 at all rather than reading an fd whose
  // contents it would discard. (Whether reading it there would block was not tested; not reading it
  // makes the question moot.)
  const stdin = () => readFileSync(0, "utf8");

  if (process.argv[2] === "gates") {
    const unscoped = process.argv.includes("--unscoped");
    const lines = gateOutputs(unscoped ? null : packagesInScope(stdin()));
    console.error(`changed-scope: ${lines.split("\n").join(" ")}`);
    console.log(lines);
  } else {
    const paths = stdin().split("\n");
    const { code, reason } = classify(paths);
    console.error(`changed-scope: code=${code} (${reason})`);
    console.log(formatOutput(paths));
  }
}
/* v8 ignore stop */
