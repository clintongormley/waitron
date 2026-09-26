import { readFileSync } from "node:fs";

// Two jobs, both of them answers ABOUT a scope rather than derivations OF one (that is
// changed-packages.mjs): whether a change can affect a test, build or type-check result
// (`isInertPath` and `classify`), and which gated jobs a resolved scope gives work to (`SCOPE_GATES`
// and `gateOutputs`). Design: docs/superpowers/specs/2026-07-31-scoped-ci-design.md.
//
// The rule is an ALLOWLIST OF PATHS, never a file extension: a package-nested README can be a test
// fixture whose bytes a test asserts against, so treating it as inert by its extension would let an
// edit to it skip the very test whose purpose is to catch that edit.

/**
 * Root directories and root files that no `code`-gated job reads — the typecheck, test, build and
 * mutation jobs the documentation route skips.
 *
 * NOT "no gate at all": `format:check` and `lint` read some of these, but CI runs both on EVERY push,
 * ungated. Only the LOCAL pre-push documentation route skips lint.
 *
 * ROOT-ONLY. The same names inside a package stay code — the conservative route, since the
 * classifier cannot read a package's config to prove it inert.
 */
const INERT_ROOT_PREFIXES = [".codex/", ".vscode/"];
const INERT_ROOT_FILES = [".gitignore", ".editorconfig"];

/**
 * The repository's own machinery. Code — a wrong classifier breaks every gating decision — but it
 * gives the root Vitest project work and gives no package any, unless ROOT_SCOPE_CONSUMERS lists it.
 * ROOT-ONLY, like INERT_ROOT_PREFIXES: `packages/db/scripts/x.ts` is that package's.
 */
const ROOT_SCOPE_PREFIXES = ["scripts/", ".husky/", ".github/"];

/**
 * Root-scope files a workspace member depends on, each mapped to the member DIRECTORIES that depend
 * on it: a member file reads it, or the ci.yml job that tests the member runs it first (the
 * `test-server` job's two binary installers). A change to one selects those members as well as the
 * root project. Without an entry, root scope emits `code=false` and ci.yml runs neither
 * `bundle-smoke` nor any member's build or tests.
 *
 * Hand-written. `scripts/root-scope-consumers.test.mjs` fails when a root `scripts/` file is named
 * by a member file through a relative path, or run by a line starting `node scripts/` in a ci.yml
 * job that tests a member through one quoted `pnpm --filter`, and is not listed here for that
 * member — or when an entry here is neither. Weaker than its name in the ways its header states —
 * it reads member files and ci.yml as text, so among other gaps a path built from parts, or a
 * script fed from a pipe in ci.yml, is invisible to it.
 */
export const ROOT_SCOPE_CONSUMERS = new Map([
  [
    "scripts/bundle-node.mjs",
    ["apps/print-agent", "apps/server", "packages/credentials", "packages/provisioning"],
  ],
  ["scripts/dev-server-proxy.ts", ["apps/dashboard", "apps/setup", "apps/till"]],
  ["scripts/setup-litestream.mjs", ["apps/server"]],
  ["scripts/setup-s3-test-server.mjs", ["apps/server"]],
]);

/**
 * True for a path under ROOT_SCOPE_PREFIXES. For the files ROOT_SCOPE_CONSUMERS lists,
 * scopeForPaths also selects the members listed against them.
 *
 * The other root config — the lockfile, the root manifests, `tsconfig*.json`, the lint and format
 * config, `vitest.config.ts` — is deliberately not here: each can change what every package builds,
 * lints or tests, so it falls through `scopeForPaths`'s "belongs to no package" branch and forces a
 * global run — the fail-closed default that also catches a root file nobody has thought about yet.
 */
export function isRootScopePath(path) {
  return ROOT_SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * True for everything under `deploy/`, the box image's build and runtime inputs, whose change is what
 * re-runs ci.yml's `image` smoke on a pull request. The WHOLE directory on purpose: matching too
 * broadly only re-runs the smoke on a `deploy/README.md` edit, while a named-file list would silently
 * SKIP it on a new input file nobody remembered to add. The trailing slash keeps out `deployment/`.
 */
export function isImageInputPath(path) {
  return path.startsWith("deploy/");
}

/** True when a change to `path` cannot affect any test, build or type-check result. */
export function isInertPath(path) {
  if (path.startsWith("docs/")) return true;
  if (INERT_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (INERT_ROOT_FILES.includes(path)) return true;
  // No slash means repository root.
  if (path.endsWith(".md") && !path.includes("/")) return true;
  return false;
}

/**
 * `code: false` is what both gates call `documentation` — a name narrower than the set, which also
 * holds the inert root config. The name is the consumers' contract (ci.yml gates on `code`,
 * .husky/pre-push compares its scope to the literal `documentation`), so it stays.
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

export const HEAVY_PACKAGE = "@waitron/db";

/**
 * The package the `test-ui` shard exists for. It was split out of `test-light` after that shard HUNG
 * on it twice (run 30692329110 attempt 1, and run 30697414129): both times `@waitron/ui` printed
 * passing test files and then stopped, and the runner's shutdown named `chrome-headless-shell` among
 * the orphan processes it terminated; attempt 2 of the first run, same commit, went green. That does
 * NOT establish the cause, so a shard of its own is a mitigation whose effect can only be read off
 * future runs.
 */
export const UI_PACKAGE = "@waitron/ui";
export const UI_CORE_PACKAGE = "@waitron/ui-core";

/**
 * The `test-till` shard's package, a Chromium browser-mode app. Its own shard is a PREEMPTIVE
 * mitigation on UI_PACKAGE's precedent: apps/till has never run in `test-light` and so has never hung
 * it, and nothing here proves it would.
 */
export const TILL_PACKAGE = "@waitron/till";

/**
 * The `test-dashboard` shard's package, a Chromium browser-mode app. Its own shard is a PREEMPTIVE
 * mitigation on UI_PACKAGE's precedent: apps/dashboard has never run in `test-light` and so has never
 * hung it, and nothing here proves it would.
 */
export const DASHBOARD_PACKAGE = "@waitron/dashboard";

/**
 * The `test-setup` shard's package, a Chromium browser-mode app. Its own shard is a PREEMPTIVE
 * mitigation on UI_PACKAGE's precedent: apps/setup has never run in `test-light` and so has never hung
 * it, and nothing here proves it would.
 */
export const SETUP_PACKAGE = "@waitron/setup";

/** Of its two Vitest projects, `node` and `browser`, it is the Chromium one that earns it a shard. */
export const VENUE_SERVICE_PACKAGE = "@waitron/venue-service";

/**
 * Each has a Chromium dashboard-panel project, so each gets a shard of its own rather than sharing a
 * light bin: a browser package in a shared light shard is the shape UI_PACKAGE's receipt warns
 * against.
 */
export const PAYMENTS_STRIPE_PACKAGE = "@waitron/payments-stripe";
export const PAYMENTS_SUMUP_PACKAGE = "@waitron/payments-sumup";

/**
 * The `test-server` shard's package. A measured PERFORMANCE split, not a hang mitigation: apps/server
 * alone set `test-light`'s floor. Why it may run several workers there is on
 * apps/server/vitest.config.ts's `maxWorkers`.
 */
export const SERVER_PACKAGE = "@waitron/server";

/**
 * The `test-fiscal-verifactu` shard's package: a `maxWorkers: 4` suite, which oversubscribed its
 * bin-mates when it shared a light shard.
 */
export const FISCAL_VERIFACTU_PACKAGE = "@waitron/fiscal-verifactu";

/**
 * The packages that have a single-package test shard to themselves — the set BOTH light shards
 * subtract.
 *
 * ONE list rather than a name per gate, because the light gates are defined against it: a package
 * added here without a shard of its own stops being tested altogether, and a shard added without an
 * entry here runs its package twice. `scripts/ci-workflow.test.mjs` checks both directions against
 * ci.yml's real `--filter` arguments and the real workspace, so neither drift can land silently.
 */
export const OWN_SHARD_PACKAGES = [
  HEAVY_PACKAGE,
  UI_PACKAGE,
  UI_CORE_PACKAGE,
  TILL_PACKAGE,
  DASHBOARD_PACKAGE,
  SETUP_PACKAGE,
  VENUE_SERVICE_PACKAGE,
  SERVER_PACKAGE,
  FISCAL_VERIFACTU_PACKAGE,
  "@waitron/bookings",
  "@waitron/media",
  PAYMENTS_STRIPE_PACKAGE,
  PAYMENTS_SUMUP_PACKAGE,
];

/**
 * The remaining workspace members partition into two bins. Each CI bin runs at most two
 * package processes; browser and other heavy workloads have dedicated runners above.
 * The workflow subtracts the other bin and OWN_SHARD_PACKAGES from pnpm's resolved scope.
 * ci-workflow.test.mjs runs those filters against the real workspace and checks that every
 * test package is selected exactly once. Add each new package to one bin or its own shard.
 */
export const LIGHT_A_PACKAGES = [
  "@waitron/country",
  "@waitron/country-es",
  "@waitron/core",
  "@waitron/payments",
  "@waitron/provisioning",
  "@waitron/reporting",
  "@waitron/scheduler",
  "@waitron/purchasing",
  "@waitron/membership",
  "@waitron/module",
  "@waitron/tunnel",
  "@waitron/migrations",
  "@waitron/fiscal",
  "@waitron/shared",
  "@waitron/server-kit",
  "@waitron/dashboard-modules",
  "@waitron/store",
  "@waitron/stream",
];

export const LIGHT_B_PACKAGES = [
  "@waitron/country-gb",
  "@waitron/country-packs",
  "@waitron/dashboard-kit",
  "@waitron/identity",
  "@waitron/workforce",
  "@waitron/credentials",
  "@waitron/catalogue",
  "@waitron/recipes",
  "@waitron/workforce-es",
  "@waitron/layouts",
  "@waitron/printing",
  "@waitron/print-agent",
  "@waitron/print-agent-app",
  "@waitron/bench-pglite",
  "@waitron/bench-sqlite-failover",
  "@waitron/diagnostics",
  "@waitron/sync-enrolment",
  "@waitron/composition",
  "@waitron/fiscal-none",
];

/**
 * Workspace members that deliberately declare no `test:coverage` script.
 *
 * A member listed here contributes nothing to a test shard, so the `light` gate below discounts it
 * and the guard in scripts/changed-packages.mjs lets a selection of nothing but these pass. A
 * member NOT listed here that declares no such script is a mistake, and that guard fails on it.
 *
 * `changed-scope.test.mjs` pins this list against the real workspace in both directions. A scoped
 * `pnpm --filter "...<member>" test:coverage` over a listed member prints `None of the selected
 * packages has a "test:coverage" script` on STDOUT and exits **0**.
 */
export const PACKAGES_WITHOUT_TESTS = ["@waitron/bench-pglite", "@waitron/bench-sqlite-failover"];

/** A gate that fires when one named package is in the resolved scope. */
const membership = (packageName) => (inScope) => inScope.has(packageName);

/**
 * True when `name` gives the named light bin something to actually run: a member of the bin that
 * declares tests. PACKAGES_WITHOUT_TESTS contributes nothing to any shard, so a bin holding only
 * those (or nothing) does not switch its gate on.
 */
const runsInLightShard = (bin) => (name) =>
  bin.includes(name) && !PACKAGES_WITHOUT_TESTS.includes(name);

/** The two light shards' predicate, the counterpart to `membership`. */
const lightGate = (bin) => (inScope) => [...inScope].some(runsInLightShard(bin));

/**
 * Every gated job, as a predicate over the resolved scope, in the order the CLI emits them.
 *
 * `light_a` and `light_b` are the two gates that are NOT membership of a named package: each light
 * shard subtracts OWN_SHARD_PACKAGES and the other bin, so it has work exactly when the scope holds a
 * member of its own bin that is not in PACKAGES_WITHOUT_TESTS.
 *
 * The `inScope === null` fail-closed case is applied by `gateOutputs` before any predicate is called,
 * so a predicate only ever sees a real Set.
 */
export const SCOPE_GATES = [
  { output: "heavy", covers: membership(HEAVY_PACKAGE) },
  { output: "ui", covers: (scope) => scope.has(UI_PACKAGE) || scope.has(UI_CORE_PACKAGE) },
  { output: "till", covers: membership(TILL_PACKAGE) },
  { output: "dashboard", covers: membership(DASHBOARD_PACKAGE) },
  { output: "setup", covers: membership(SETUP_PACKAGE) },
  { output: "venue_service", covers: membership(VENUE_SERVICE_PACKAGE) },
  { output: "server", covers: membership(SERVER_PACKAGE) },
  { output: "fiscal_verifactu", covers: membership(FISCAL_VERIFACTU_PACKAGE) },
  { output: "bookings", covers: membership("@waitron/bookings") },
  { output: "media", covers: membership("@waitron/media") },
  { output: "payments_stripe", covers: membership(PAYMENTS_STRIPE_PACKAGE) },
  { output: "payments_sumup", covers: membership(PAYMENTS_SUMUP_PACKAGE) },
  { output: "light_a", covers: lightGate(LIGHT_A_PACKAGES) },
  { output: "light_b", covers: lightGate(LIGHT_B_PACKAGES) },
  { output: "shared", covers: membership("@waitron/shared") },
];

/**
 * The set of package names in the resolved scope, given the JSON output of
 * `pnpm --filter "<scope>" ls --depth -1 --json`, or `null` when that output cannot be parsed.
 *
 * `null` and the empty set are deliberately different answers. Empty is definite — `pnpm ls` emits
 * zero bytes on BOTH streams, and exits 0, when its filter matches nothing — while `null` is "we do
 * not know", which `gateOutputs` turns into running everything.
 *
 * `pnpm ls --json` reports its OWN ERRORS as valid JSON on STDOUT, not as a diagnostic on stderr:
 *
 *   $ pnpm --filter "" ls --json 2>/dev/null
 *   {"error":{"code":"pnpm","message":"Unsupported package selector: …"}}
 *
 * That parses cleanly, so the shape — not the parse — is what separates a pnpm failure from a real
 * result. Getting it wrong reads a failure as "no packages in scope" and SKIPS every gated job,
 * which is the silent direction.
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
 * The RESOLVED SCOPE — changed packages and their dependents — is the only thing worth asking about.
 * The design spec §3.6 measured the two obvious alternatives for `@waitron/db`:
 *
 *   - a second inclusion filter (`--filter "<scope>" --filter "@waitron/db"`) is OR-ed, not
 *     intersected, so it runs db's suite on every code change whether or not db is involved;
 *   - `@waitron/db[<base>]` intersects with the CHANGED set rather than changed-plus-dependents,
 *     so it selects NOTHING when one of db's own dependencies changed — a false skip, which is the
 *     dangerous direction.
 */
export function gateOutputs(inScope) {
  return SCOPE_GATES.map(
    ({ output, covers }) => `${output}=${inScope === null || covers(inScope)}`,
  ).join("\n");
}

// CLI: one `pnpm ls --json` result on stdin → one `<gate>=<bool>` line per gate. With `--unscoped`
// (main, where there is no scope to resolve) stdin is never read and every gate is true.
//
// stdout is appended verbatim to `$GITHUB_OUTPUT`, so it carries the output lines and nothing else,
// while the reason goes to stderr for whoever reads the job log.
//
// Ignored for coverage because its tests run it in a CHILD process, which the v8 provider does not
// measure.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("changed-scope.mjs")) {
  const unscoped = process.argv.includes("--unscoped");
  const lines = gateOutputs(unscoped ? null : packagesInScope(readFileSync(0, "utf8")));
  console.error(`changed-scope: ${lines.split("\n").join(" ")}`);
  console.log(lines);
}
/* v8 ignore stop */
