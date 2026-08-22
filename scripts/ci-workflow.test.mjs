import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIGHT_A_PACKAGES,
  LIGHT_B_PACKAGES,
  OWN_SHARD_PACKAGES,
  PACKAGES_WITHOUT_TESTS,
  SCOPE_GATES,
} from "./changed-scope.mjs";

// Two properties of .github/workflows/ci.yml that nothing else can check, both of them invisible
// until the day they are wrong:
//
//   * every job reports to `ci`. `ci` is the ONLY context branch protection requires (that file's
//     own header has the ruleset read-back), so a job missing from its `needs` can fail while the
//     pull request stays green.
//   * the test shards PARTITION the workspace. Each shard is a `pnpm --filter` selection, and the
//     three are written in three different places — a package can fall through all of them and
//     never be tested, or land in two and be tested twice. Neither shows up as a failure anywhere.
//
// The second is what this file was written for. Splitting `packages/ui` out of `test-light` into a
// `test-ui` shard meant adding `--filter "!@waitron/ui"` in one place and a whole job in another,
// and getting only the first of those would have silently stopped testing packages/ui altogether.
//
// EVERYTHING HERE IS EXTRACTED FROM ci.yml, never transcribed — the same rule
// check-signoff.test.mjs follows for licence.yml's `dco` step, and for the same reason: a
// transcription tests this file's copy of a workflow rather than the workflow. Each extraction
// carries a guard that it found something, because a silently-empty extraction makes every
// assertion below pass against nothing.
//
// And the SELECTIONS are not modelled either. Rather than reimplementing what `pnpm --filter`
// means, each shard's filters are handed to the real `pnpm ls` in the real workspace and the answer
// is read back — the same mechanism each shard's own `runnable` guard uses.
//
// WHY LINE MATCHING RATHER THAN A YAML PARSER: there is no YAML library in this workspace, and the
// root project is the one place a dependency would have to be added for a test (`node -e 'import
// ("yaml")'` here on 2026-08-01 gives ERR_MODULE_NOT_FOUND). So the parsing below is checked
// AGAINST one instead of trusted: on 2026-08-01 the three extractions were run side by side with
// PyYAML's `safe_load` over the same file, and the job list, `ci`'s `needs` and the `changes` job's
// `outputs` came out element-for-element identical. Redo that comparison rather than reasoning
// about the regexes if this file ever starts disagreeing with the workflow.

const repoRoot = join(import.meta.dirname, "..");
const lines = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8").split("\n");

// The two `describe("the test shards")` cases below hand ci.yml's real filters to the real `pnpm ls`
// (see `selects`/`membersDeclaringTests`, both via `pnpmLs`) rather than modelling `--filter` — the
// whole point of this file. The coverage-partition case alone is ~9 sequential `pnpm ls` spawns (one
// per shard, plus the members sweep), all with distinct filters so none can be deduped. That measured
// ~1.5s warm here on 2026-08-22, but the same case timed out past Vitest's 5000ms default on the lint
// job on PRs #128 and #129 — a cold CI runner has no warm pnpm store — so on that runner it took at
// least ~3.3x the warm time.
//
// TWO failure modes, TWO timeouts, because one cannot cover the other:
//   * SLOW-BUT-COMPLETING cold run — the flake above. `pnpmLs` runs SYNCHRONOUSLY (`spawnSync`), so
//     between calls the worker's event loop turns and Vitest's per-test timer can fire; with the
//     default 5000ms it fires mid-run and fails a healthy test. `PNPM_LS_TEST_TIMEOUT_MS` raises that
//     per-test bound above the whole case's cold wall-clock so a healthy run finishes first.
//   * GENUINE HANG in one `pnpm ls` — a `spawnSync` BLOCKS the event loop for its whole duration, so
//     the Vitest timer above CANNOT fire while a child is stuck (this is what an earlier version of
//     this comment got wrong). Only the kernel-level `timeout` option on `spawnSync` itself kills a
//     hung child; `PNPM_LS_SPAWN_TIMEOUT_MS` is that per-call kill, and `pnpmLs` turns the killed
//     result into a thrown error. It is smaller than the per-test bound so the clear per-call throw
//     wins over a bare Vitest timeout.
const PNPM_LS_SPAWN_TIMEOUT_MS = 30_000;
const PNPM_LS_TEST_TIMEOUT_MS = 60_000;

/**
 * ci.yml's jobs as `{id, body}`, in file order.
 *
 * A job id is the only KEY at two-space indent below `jobs:`: job bodies start at four, and
 * comments and `run: |` blocks go deeper still. Scanning from `jobs:` rather than from the top of
 * the file is what keeps `on:`'s own `push:` and `pull_request:` out — they sit at that same indent
 * (ci.yml lines 29 and 31 on 2026-08-01).
 */
const jobs = (() => {
  const jobsKey = lines.indexOf("jobs:");
  if (jobsKey === -1) throw new Error("ci.yml has no top-level `jobs:` key");

  const starts = [];
  for (let i = jobsKey + 1; i < lines.length; i++) {
    const id = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i])?.[1];
    if (id !== undefined) starts.push({ id, at: i });
  }

  return starts.map(({ id, at }, index) => ({
    id,
    body: lines.slice(at + 1, starts[index + 1]?.at ?? lines.length),
  }));
})();

/** One job by id, throwing rather than returning undefined for a caller to read as "no needs". */
function job(id) {
  const found = jobs.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`ci.yml has no \`${id}\` job`);
  return found;
}

/** A job's `needs:` entries when written as a block list, which only `ci` uses. */
function needsOf(body) {
  const at = body.findIndex((line) => /^ {4}needs:\s*$/.test(line));
  if (at === -1) return [];

  const entries = [];
  for (const line of body.slice(at + 1)) {
    const entry = /^ {6}- (\S+)\s*$/.exec(line)?.[1];
    if (entry === undefined) break;
    entries.push(entry);
  }
  return entries;
}

/** A job's `outputs:` keys. */
function outputsOf(body) {
  const at = body.findIndex((line) => /^ {4}outputs:\s*$/.test(line));
  if (at === -1) return [];

  const keys = [];
  for (const line of body.slice(at + 1)) {
    const key = /^ {6}([A-Za-z0-9_-]+):/.exec(line)?.[1];
    if (key === undefined) break;
    keys.push(key);
  }
  return keys;
}

/** Every `needs.changes.outputs.<name>` a job's `if:` reads. */
function gatesRead(body) {
  const ifLine = body.find((line) => /^ {4}if:/.test(line)) ?? "";
  return [...ifLine.matchAll(/needs\.changes\.outputs\.([A-Za-z0-9_-]+)/g)].map(([, name]) => name);
}

/**
 * The lines of a job's `Run the … shard` step, or undefined when it has none.
 *
 * Anchored on the step NAME rather than on the job's last `run:`, so the checkout, the install and
 * (in test-ui) the three Playwright steps cannot be mistaken for the one that runs the tests. Same
 * anchoring rule as check-signoff.test.mjs's extraction of licence.yml's `dco` step, and for the
 * same reason — that one notes it must not take the first `run: |` in the file because it belongs
 * to a different job.
 */
function shardStep(body) {
  const at = body.findIndex((line) => /^ {6}- name: Run the .* shard\s*$/.test(line));
  if (at === -1) return undefined;

  const next = body.findIndex((line, index) => index > at && /^ {6}- /.test(line));
  return body.slice(at, next === -1 ? body.length : next);
}

/**
 * The literal `--filter "<value>"` arguments in a step, deduped, in file order.
 *
 * Two kinds of line are dropped first, and both would otherwise make this measure the wrong thing:
 *
 *   COMMENTS. ci.yml's prose quotes filter spellings that were tried and REJECTED — on 2026-08-01
 *   `grep -n -- '--filter' .github/workflows/ci.yml` returns 20 lines, of which 10 are comment
 *   text, including `--filter "...@waitron/db"` and `--filter "...[<base>]"` inside test-light's
 *   own commentary. Reading those as arguments would have this suite assert against a filter list
 *   nothing runs.
 *
 *   ANYTHING HOLDING A `$`. The scoped path builds `--filter "...$pkg"` in a shell loop, one per
 *   changed package. On a GLOBAL scope — `main`, an unattributable path, a diff that could not be
 *   worked out — that loop runs zero times and contributes nothing, and a global scope is the case
 *   this suite is about: it is the run that has to cover every package.
 */
function literalFilters(step) {
  const found = new Set();
  for (const line of step) {
    if (line.trim().startsWith("#")) continue;
    for (const [, value] of line.matchAll(/--filter "([^"]+)"/g)) {
      if (!value.includes("$")) found.add(value);
    }
  }
  return [...found];
}

/** Every shard job in ci.yml, as `{id, filters}`. */
const shards = jobs
  .map(({ id, body }) => ({ id, step: shardStep(body) }))
  .filter(({ step }) => step !== undefined)
  .map(({ id, step }) => ({ id, filters: literalFilters(step) }));

/**
 * The default runner behind `pnpmLs`: `pnpm <args>` under the per-call kill timeout.
 *
 * The `timeout` is the ONLY thing that bounds a hung child — `spawnSync` blocks the event loop, so
 * Vitest's per-test timer cannot interrupt it (see the two-timeout note above). Node kills the child
 * on timeout and sets `result.error`.
 */
function spawnPnpm(args) {
  return spawnSync("pnpm", args, {
    encoding: "utf8",
    cwd: repoRoot,
    timeout: PNPM_LS_SPAWN_TIMEOUT_MS,
  });
}

/**
 * Run `pnpm <args>` via `run` and return its parsed-JSON stdout, or throw a clear Error.
 *
 * `run` is injected so the timeout/error path has an executable assertion without a real hang (see
 * the `pnpmLs` suite): a killed or un-spawnable child sets `result.error`; a non-zero exit sets
 * `result.status`. Both become a thrown Error naming the command, so a hang or failure fails the
 * test loudly rather than surfacing as `expected null to be 0` — or, for a hang, never at all.
 */
function pnpmLs(args, run = spawnPnpm) {
  const result = run(args);
  if (result.error !== undefined) {
    throw new Error(
      `\`pnpm ${args.join(" ")}\` failed to run (killed after ${PNPM_LS_SPAWN_TIMEOUT_MS}ms?): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`\`pnpm ${args.join(" ")}\` exited ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * What `pnpm <filters> ls --depth -1 --json` really selects, minus the workspace ROOT.
 *
 * The root is dropped by PATH rather than by name, exactly as `workspacePackages`
 * (scripts/changed-packages.mjs) drops it, because a member's name is a manifest field anyone can
 * change while its path is a fact about the tree.
 *
 * Dropping it is not cosmetic: `pnpm ls` LISTS the root and `pnpm run` does NOT RUN it. Measured
 * here on 2026-08-05, using the one script only the root declares —
 * `pnpm --filter "!@waitron/db" --filter "!@waitron/ui" --filter "!@waitron/till" prepare` printed
 * `Scope: 18 of 22 workspace projects` and then `None of the selected packages has a "prepare"
 * script`, exit 0, while the same filters through `pnpm ls --depth -1 --json` returned 19 entries,
 * the extra one being the root.
 */
function selects(filters) {
  return pnpmLs([
    ...filters.flatMap((filter) => ["--filter", filter]),
    "ls",
    "--depth",
    "-1",
    "--json",
  ])
    .filter((pkg) => resolve(pkg.path) !== resolve(repoRoot))
    .map((pkg) => pkg.name);
}

/** Every workspace member (never the root) that declares a `test:coverage` script. */
function membersDeclaringTests() {
  return pnpmLs(["ls", "-r", "--depth", "-1", "--json"])
    .filter((pkg) => resolve(pkg.path) !== resolve(repoRoot))
    .filter(
      (pkg) =>
        JSON.parse(readFileSync(join(pkg.path, "package.json"), "utf8")).scripts?.[
          "test:coverage"
        ] !== undefined,
    )
    .map((pkg) => pkg.name);
}

// `pnpmLs`'s timeout/error path is the regression fix for the hang above, so it carries its own
// assertions — otherwise deleting the `timeout` or a throw leaves the suite green (CLAUDE.md §4,
// "prove a guard by deletion"). A fake `run` exercises each branch deterministically; one real case
// proves spawnSync's `timeout` genuinely kills a hung child.
describe("pnpmLs (the subprocess guard)", () => {
  it("returns parsed stdout on a clean exit", () => {
    const ok = () => ({
      status: 0,
      error: undefined,
      stdout: '[{"name":"@waitron/x"}]',
      stderr: "",
    });
    expect(pnpmLs(["ls"], ok)).toEqual([{ name: "@waitron/x" }]);
  });

  it("throws, naming the command and stderr, on a non-zero exit", () => {
    const failed = () => ({ status: 1, error: undefined, stdout: "", stderr: "boom" });
    expect(() => pnpmLs(["ls", "-r"], failed)).toThrow(/pnpm ls -r.*exited 1.*boom/);
  });

  it("throws, naming the command, when the child errors (the timeout-kill shape)", () => {
    const killed = () => ({
      status: null,
      signal: "SIGTERM",
      error: Object.assign(new Error("spawnSync pnpm ETIMEDOUT"), { code: "ETIMEDOUT" }),
      stdout: "",
      stderr: "",
    });
    expect(() => pnpmLs(["ls"], killed)).toThrow(/pnpm ls.*failed to run.*ETIMEDOUT/);
  });

  it("really kills a hung child via spawnSync's own timeout", () => {
    // A child that would sleep a minute, killed by a 500ms timeout — proves the mechanism the default
    // runner relies on (status null, error set), fast and deterministically.
    const hang = () =>
      spawnSync("node", ["-e", "setTimeout(() => {}, 60000)"], { encoding: "utf8", timeout: 500 });
    expect(() => pnpmLs(["ls"], hang)).toThrow(/failed to run/);
  });
});

describe("ci.yml's job graph", () => {
  it("was parsed at all", () => {
    // The guard the whole file leans on. A regex that stopped matching would leave `jobs` empty and
    // every assertion below vacuously true.
    expect(jobs.length).toBeGreaterThan(1);
    expect(jobs.map((entry) => entry.id)).toContain("ci");
  });

  // The one rule ci.yml's header states about itself: "every other job in this file must appear in
  // `ci`'s needs. A job that does not is reporting to nothing — it could fail while the pull
  // request stays green." Asserted here rather than trusted, because the failure is silent in the
  // direction that matters.
  it("names every other job in `ci`'s needs", () => {
    const others = jobs.map((entry) => entry.id).filter((id) => id !== "ci");
    expect(others.length).toBeGreaterThan(0);
    expect([...needsOf(job("ci").body)].sort()).toEqual([...others].sort());
  });

  // The other direction. A `needs` entry naming a job that does not exist is not a silent failure —
  // GitHub rejects the workflow — but it is a five-minute round trip through a push, and the same
  // extraction answers it for free.
  it("needs nothing that is not a job in this file", () => {
    const ids = jobs.map((entry) => entry.id);
    const needs = needsOf(job("ci").body);
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.filter((entry) => !ids.includes(entry))).toEqual([]);
  });
});

describe("the test shards", () => {
  it("were found, each with at least one filter", () => {
    // Extraction guard again: `shards` is derived from a step-name regex, and an empty list would
    // make the partition below hold trivially.
    expect(shards.length).toBeGreaterThan(1);
    for (const shard of shards) expect(shard.filters.length).toBeGreaterThan(0);
  });

  // THE PROPERTY THIS FILE EXISTS FOR. On a global scope — `main`, and any pull request whose diff
  // touches something outside every package — the shards between them must run every package's
  // suite, and none of them twice.
  //
  // Selections come from the real `pnpm ls` with ci.yml's real filters, so this measures what the
  // shards would actually select rather than what a model of `--filter` says they would.
  it(
    "cover every package declaring test:coverage exactly once, on a global scope",
    () => {
      const declaring = membersDeclaringTests();
      expect(declaring.length).toBeGreaterThan(0);

      const runs = new Map();
      for (const shard of shards) {
        for (const name of selects(shard.filters)) {
          runs.set(name, [...(runs.get(name) ?? []), shard.id]);
        }
      }

      // Nothing runs twice — two shards selecting one package burns a runner and doubles a suite.
      expect([...runs].filter(([, shardIds]) => shardIds.length > 1)).toEqual([]);

      // Nothing falls through. This is the direction that ships an untested package.
      expect(declaring.filter((name) => !runs.has(name))).toEqual([]);

      // And the only selected members that declare no `test:coverage` are the ones declared test-less
      // on purpose. Without this a package could be "covered" by a shard that then runs nothing for
      // it — which is exactly what PACKAGES_WITHOUT_TESTS and the `runnable` guard exist to separate
      // from a mistake.
      expect([...runs.keys()].filter((name) => !declaring.includes(name)).sort()).toEqual(
        [...PACKAGES_WITHOUT_TESTS].sort(),
      );
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );

  // The two light shards partition the non-own-shard packages: each subtracts its bin's COMPLEMENT
  // — every package in OWN_SHARD_PACKAGES plus every package in the OTHER bin — so what it selects is
  // its own bin. Written as literal `!` filters in ci.yml and as the bin lists in changed-scope.mjs,
  // and nothing but this makes them agree. The drift is invisible: a package in neither exclusion
  // set runs in BOTH shards, and one in both exclusion sets stops being tested.
  it("subtract from each light shard exactly the own-shard packages and the other bin", () => {
    const excludedBy = (id) => {
      const shard = shards.find((candidate) => candidate.id === id);
      expect(shard, `ci.yml has no ${id} shard`).toBeDefined();
      return shard.filters
        .filter((filter) => filter.startsWith("!"))
        .map((filter) => filter.slice(1))
        .sort();
    };

    expect(excludedBy("test-light-a")).toEqual([...OWN_SHARD_PACKAGES, ...LIGHT_B_PACKAGES].sort());
    expect(excludedBy("test-light-b")).toEqual([...OWN_SHARD_PACKAGES, ...LIGHT_A_PACKAGES].sort());
  });

  it(
    "give each of those packages a shard that selects it and nothing else",
    () => {
      for (const name of OWN_SHARD_PACKAGES) {
        const dedicated = shards.filter((shard) => shard.filters.includes(name));
        expect(dedicated).toHaveLength(1);
        expect(selects(dedicated[0].filters)).toEqual([name]);
      }
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );
});

describe("the scope gates", () => {
  // SCOPE_GATES is the single source of truth for gate names, including the `--unscoped` path that
  // `main` takes. A gate the `changes` job never declares as an output is a gate every consumer
  // reads as the empty string — which is not `'true'`, so the job it gates never runs. On `main`
  // that is a package silently never tested, and nothing else reports it.
  it("are each declared as a `changes` job output", () => {
    const declared = outputsOf(job("changes").body);
    expect(declared).toContain("code");
    for (const gate of SCOPE_GATES) expect(declared).toContain(gate.output);
  });

  // The other direction: a gate that gates nothing. Harmless at runtime, but it means a shard was
  // planned and not wired, which is the state this change would have been left in had `test-ui`
  // been forgotten after `ui` was added to SCOPE_GATES.
  it("are each read by some job's `if:`", () => {
    const read = new Set(jobs.flatMap((entry) => gatesRead(entry.body)));
    for (const gate of SCOPE_GATES) expect([...read]).toContain(gate.output);
  });

  // Every shard is gated, and gated on a name SCOPE_GATES defines. A shard gated on `code` alone
  // runs on every code change — which is what both mutation jobs did until they were measured as
  // the critical path (ci.yml's own comments on them carry that receipt).
  it("gate every shard on `code` plus one gate of its own", () => {
    const names = SCOPE_GATES.map((gate) => gate.output);
    for (const shard of shards) {
      const read = gatesRead(job(shard.id).body);
      expect(read).toContain("code");
      const own = read.filter((name) => name !== "code");
      expect(own).toHaveLength(1);
      expect(names).toContain(own[0]);
    }
  });
});
