import { readFileSync } from "node:fs";

// Two jobs, both of them answers ABOUT a scope rather than derivations OF one (that is
// changed-packages.mjs, which imports `classify` and `isInertPath` from here):
//
//   * whether a change can affect anything but prose, so CI can skip the expensive jobs when it
//     cannot — `isInertPath` and `classify`, design §3.4;
//   * which gated jobs a resolved scope gives work to — `SCOPE_GATES` and `gateOutputs`, §3.6.
//
// Design: docs/superpowers/specs/2026-07-31-scoped-ci-design.md.
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
 * The package the `test-ui` shard exists for: the workspace's only Chromium consumer.
 *
 * It is split out because `test-light` HUNG on it, twice, reproducibly enough to name both runs.
 * Read back on 2026-08-01 with `gh api repos/clintongormley/waitron/actions/runs/<id>/…`:
 *
 *   run 30692329110 attempt 1 (PR #32, head e695a44)   test-light 08:44:09 → cancelled 09:13:22
 *   run 30697414129 (PR #35, head add4097)             test-light 11:18:11 → cancelled 11:38:08
 *
 * Both jobs' logs tell the same story: `playwright install --with-deps chromium` had already
 * finished (the step's group closed and the next step opened, 08:44:29→08:44:41 and
 * 11:18:31→11:18:43), TWELVE packages printed `test:coverage: Done`, and `@waitron/ui` printed
 * individual passing test files and then stopped — last output 08:47:04 and 11:21:23, roughly 26
 * and 17 minutes before the cancellation. In BOTH, the runner's shutdown named
 * `chrome-headless-shell` among the orphan processes it had to terminate. Attempt 2 of the first
 * run, same commit, went green in 3m58s, so it is intermittent rather than a hard break.
 *
 * What that does NOT establish is the CAUSE. Nothing here proves contention between the thirteen
 * packages `test-light` starts at once is what wedged Chromium, and a shard of its own is therefore
 * a mitigation whose effect can only be read off future runs — not something this file's presence
 * demonstrates. docs/backlog.md carries it as such.
 */
export const UI_PACKAGE = "@waitron/ui";

/**
 * The packages that have a test shard to themselves — the set `test-light` subtracts.
 *
 * ONE list rather than a name per gate, because `light` is defined against it: a package added here
 * without a shard of its own stops being tested altogether, and a shard added without an entry here
 * runs its package twice. `scripts/ci-workflow.test.mjs` checks both directions against ci.yml's
 * real `--filter` arguments and the real workspace, so neither drift can land silently.
 *
 * `light` used to read "the scope holds something other than HEAVY_PACKAGE", which was the same
 * sentence as this list while the list had one entry. Generalising it rather than special-casing a
 * second name is what stops a scope of exactly {@waitron/ui} answering `light=true` — a runner and
 * a `pnpm install` for a selection that would then contain nothing to run, which is the shape the
 * `runnable` guard in scripts/changed-packages.mjs was added to refuse.
 */
export const OWN_SHARD_PACKAGES = [HEAVY_PACKAGE, UI_PACKAGE];

/**
 * Workspace members that deliberately declare no `test:coverage` script.
 *
 * A member listed here contributes nothing to a test shard, so the `light` gate below discounts it
 * and the guard in scripts/changed-packages.mjs lets a selection of nothing but these pass. A
 * member NOT listed here that declares no such script is a mistake, and that guard fails on it.
 *
 * `@waitron/bench-pglite` is the only one today, and `changed-scope.test.mjs` pins that against the
 * real workspace in both directions rather than leaving it to be remembered:
 * bench/pglite-throughput/README.md records that it defines no `test` script and holds no
 * `*.test.ts`, both deliberate. Measured in this workspace on 2026-08-01:
 * `pnpm --filter "...@waitron/bench-pglite" test:coverage` prints `None of the selected packages
 * has a "test:coverage" script` on STDOUT and exits **0**.
 */
export const PACKAGES_WITHOUT_TESTS = ["@waitron/bench-pglite"];

/** A gate that fires when one named package is in the resolved scope — four of the five. */
const membership = (packageName) => (inScope) => inScope.has(packageName);

/** True when this package would give the LIGHT shard something to actually run. */
const runsTests = (name) =>
  !OWN_SHARD_PACKAGES.includes(name) && !PACKAGES_WITHOUT_TESTS.includes(name);

/**
 * Every gated job, as a predicate over the resolved scope, in the order the CLI emits them.
 *
 * `heavy` was the first, and the two mutation jobs joined it on a measurement rather than a
 * principle. Read off run 30650089655 (`gh run view 30650089655 --json createdAt,updatedAt,jobs`,
 * head 4926cf5): the run spanned 4m8s, `mutation-verifactu` was 3m26s of it, and every other job
 * had finished 1m39s in — with both mutation jobs gated on `code` alone, so both ran on any code
 * change at all, however far from `packages/verifactu` or `packages/shared`. That made mutation the
 * critical path for the common case, which is most of what the scoping was for.
 *
 * `ui` joined them on a reproducible CI HANG rather than on cost — see UI_PACKAGE above for both
 * runs and what their logs do and do not show.
 *
 * `light` joined them for the same kind of reason as the mutation pair, and is the one gate that is
 * NOT membership of a named package, which is why an entry holds a PREDICATE rather than a package
 * name. test-light runs one `--filter "...<pkg>"` per changed package plus one `--filter "!<pkg>"`
 * per entry in OWN_SHARD_PACKAGES, so it has work exactly when the resolved scope holds a package
 * that both survives that subtraction and has a `test:coverage` script to run — false when the
 * whole of it has shards of its own, and false when the whole of it is in PACKAGES_WITHOUT_TESTS.
 * Read off run 30653487133 (`gh run view 30653487133 --json jobs`): gated on `code` alone,
 * test-light was that run's LONGEST job — 18:01:36 → 18:02:24, 48s — and its "Run the light shard"
 * step printed `None of the selected packages has a "test:coverage" script`. A runner, a `pnpm
 * install` and a `playwright install --with-deps chromium` for zero test execution, reported as
 * success.
 *
 * The `inScope === null` fail-closed case is NOT a gate's business: `gateOutputs` applies it before
 * calling any predicate, so a predicate only ever sees a real Set and cannot forget the check.
 *
 * This list is the single source of truth for the gate names: ci.yml's `changes` job reads them
 * from here (including for the unscoped `main` run), so adding a gate is one edit here plus the job
 * that consumes it.
 */
export const SCOPE_GATES = [
  { output: "heavy", covers: membership(HEAVY_PACKAGE) },
  { output: "ui", covers: membership(UI_PACKAGE) },
  { output: "light", covers: (inScope) => [...inScope].some(runsTests) },
  { output: "verifactu", covers: membership("@waitron/verifactu") },
  { output: "shared", covers: membership("@waitron/shared") },
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
 * Proven by deletion, on the code as it stands: remove the `Array.isArray` line and `pnpm vitest
 * run` fails exactly TWO tests, both of them the ones naming this input — `packagesInScope >
 * returns null for pnpm's own error object, which is valid JSON` (`TypeError: parsed.map is not a
 * function`) and `the CLI > fails closed when pnpm reports its own error as JSON on stdout` (the
 * child process exits 1 on that TypeError). The `try` wraps `JSON.parse` ONLY, so `parsed.map` on
 * the error object throws outside it and propagates instead of reaching `null`.
 *
 * Re-run on 2026-08-01, where the suite is 114 tests. Deliberately not restated as a pass/fail
 * total: this comment carried `2 failed | 42 passed (44)` from a tree with two thirds fewer tests,
 * still reading as a fresh measurement. The load-bearing part is which two fail, not the total they
 * fail out of.
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
 * needed costs runner time while skipping one that was needed ships an untested package. That check
 * lives HERE rather than in the gates, so no gate can be written without it.
 *
 * The RESOLVED SCOPE is the only thing worth asking about, and the two obvious alternatives are
 * both wrong. The design spec §3.6 measured this for `@waitron/db`; the mechanism is the same
 * whichever package a gate is about, so the receipt below is quoted in db's own terms rather than
 * restated as a general claim nobody ran:
 *
 *   - a second inclusion filter (`--filter "<scope>" --filter "@waitron/db"`) is OR-ed, not
 *     intersected, so it runs the 189s suite on every code change whether or not db is involved;
 *   - `@waitron/db[<base>]` intersects with the CHANGED set rather than changed-plus-dependents,
 *     so it selects NOTHING when one of db's own dependencies changed — a false skip, which is the
 *     dangerous direction.
 *
 * The scope is changed-packages-and-their-dependents, so a membership gate fires when its package
 * changed OR when its package depends on something that changed. For the two mutation gates the
 * second half is inert today and will not stay that way by itself. Run in this workspace on
 * 2026-07-31,
 * `pnpm --filter "@waitron/shared..." ls --depth -1` and
 * `pnpm --filter "@waitron/verifactu..." ls --depth -1` each print exactly one line, that package
 * itself, so neither has a workspace dependency to inherit a change from. Nothing enforces that,
 * and it is one package.json edit from being false — which is why the gate resolves membership
 * instead of matching the package name against the diff.
 */
export function gateOutputs(inScope) {
  return SCOPE_GATES.map(
    ({ output, covers }) => `${output}=${inScope === null || covers(inScope)}`,
  ).join("\n");
}

// CLI: one `pnpm ls --json` result on stdin → one `<gate>=<bool>` line per gate. With `--unscoped`
// (main, where there is no scope to resolve) stdin is ignored and every gate is true.
//
// ONE invocation answers every gate, which is why it emits the whole list rather than taking a gate
// name: the alternative was running the same workspace query once per gated job. Kept to the
// smallest possible body: every decision worth testing lives in the exported functions above. What
// is left is the stream split — stdout is appended verbatim to `$GITHUB_OUTPUT`, so it carries the
// output lines and nothing else, while the reason goes to stderr for whoever reads the job log. No
// exported function can show that, so changed-scope.test.mjs spawns this file with `spawnSync` and
// reads the two streams apart.
//
// It used to carry a second, argument-less subcommand that answered ci.yml's `code` gate by calling
// `classify` on a list of changed paths. That gate is now one of the three lines
// scripts/changed-packages.mjs emits, from the same `classify` call that decides the scope, so CI
// and the pre-push hook classify a diff exactly once and by exactly one route.
//
// Ignored for coverage because those tests run it in a CHILD process, and the v8 provider only
// measures the module graph loaded into the test process — so this block reads as 0% however
// thoroughly it is exercised. Ignored for being unmeasurable, not for being untested: delete the
// `describe("the CLI")` suite and eight assertions about this block's behaviour go with it.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("changed-scope.mjs")) {
  // `--unscoped` is invoked with nothing piped into it, and its whole point is that stdin is
  // irrelevant — so it does not touch fd 0 at all rather than reading an fd whose contents it would
  // discard. (Whether reading it there would block was not tested; not reading it makes the
  // question moot.)
  const unscoped = process.argv.includes("--unscoped");
  const lines = gateOutputs(unscoped ? null : packagesInScope(readFileSync(0, "utf8")));
  console.error(`changed-scope: ${lines.split("\n").join(" ")}`);
  console.log(lines);
}
/* v8 ignore stop */
