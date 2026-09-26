import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIGHT_A_PACKAGES,
  LIGHT_B_PACKAGES,
  OWN_SHARD_PACKAGES,
  PACKAGES_WITHOUT_TESTS,
  SCOPE_GATES,
} from "./changed-scope.mjs";

// Two properties of .github/workflows/ci.yml that nothing else can check:
//
//   * every job reports to `ci`. `ci` is the ONLY context branch protection requires, so a job
//     missing from its `needs` can fail while the pull request stays green.
//   * the test shards PARTITION the workspace. A package can fall through every shard's
//     `pnpm --filter` selection and never be tested, or land in two and be tested twice.
//
// EVERYTHING HERE IS EXTRACTED FROM ci.yml, never transcribed: a transcription tests this file's
// copy of a workflow rather than the workflow. Each extraction carries a guard that it found
// something, because a silently-empty extraction makes every assertion below pass against nothing.
// Nor are the SELECTIONS modelled: each shard's filters are handed to the real `pnpm ls` and the
// answer is read back.
//
// Line matching rather than a YAML parser, because there is no YAML library in this workspace.
// Compare the extractions with a real YAML parser's rather than reasoning about the regexes if this
// file ever starts disagreeing with the workflow.

const repoRoot = join(import.meta.dirname, "..");
const lines = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8").split("\n");

// The shard cases below make many sequential `pnpm ls` spawns, which on a cold CI runner (no warm
// pnpm store) outlast Vitest's 5000ms default. TWO failure modes, TWO timeouts, because one cannot
// cover the other:
//   * SLOW-BUT-COMPLETING cold run. `spawnSync` blocks the event loop, so Vitest's timer does not
//     fire mid-case; the case runs to the end and is then failed for its duration alone.
//     `PNPM_LS_TEST_TIMEOUT_MS` raises that per-test bound above the whole case's cold wall-clock.
//   * GENUINE HANG in one `pnpm ls` — the Vitest timer CANNOT interrupt a stuck child (an earlier
//     version of this comment said it could). Only the `timeout` option on `spawnSync` itself kills
//     a hung child; `PNPM_LS_SPAWN_TIMEOUT_MS` is that per-call kill, and `pnpmLs` turns the killed
//     result into a thrown error. It is smaller than the per-test bound so the clear per-call throw
//     wins over a bare Vitest timeout.
const PNPM_LS_SPAWN_TIMEOUT_MS = 30_000;
const PNPM_LS_TEST_TIMEOUT_MS = 60_000;

const STREAM_JOB = "test-server-stream";
const STREAM_TEST_FILES = ["src/stream-loop.e2e.test.ts", "src/stream-pause.e2e.test.ts"];
const STREAM_BINARY_INSTALLERS = [
  "node scripts/setup-litestream.mjs",
  "node scripts/setup-s3-test-server.mjs",
];

/**
 * ci.yml's jobs as `{id, body}`, in file order.
 *
 * A job id is the only KEY at two-space indent below `jobs:`: job bodies start at four, and
 * comments and `run: |` blocks go deeper still. Scanning from `jobs:` rather than from the top of
 * the file is what keeps `on:`'s own `push:` and `pull_request:` out — they sit at that same indent.
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

/**
 * The workflow-level `concurrency:` block, as two strings: the group expression and the
 * cancel-in-progress expression. Missing block, or a missing key, throws — an extraction that
 * silently found nothing would make every case below pass against an empty string. A key that is
 * PRESENT but empty yields "" instead, which is why the cases assert on CONTENT rather than on
 * having found a line.
 */
const concurrency = (() => {
  const at = lines.indexOf("concurrency:");
  if (at === -1) throw new Error("ci.yml has no top-level `concurrency:` key");

  const body = [];
  for (let i = at + 1; i < lines.length && /^(\s|$)/.test(lines[i]); i++) body.push(lines[i]);

  const valueOf = (key) => {
    const line = body.find((entry) => entry.trimStart().startsWith(`${key}:`));
    if (line === undefined) throw new Error(`ci.yml's concurrency block has no \`${key}:\``);
    return line.slice(line.indexOf(":") + 1).trim();
  };

  return { group: valueOf("group"), cancelInProgress: valueOf("cancel-in-progress") };
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
 * the Playwright steps cannot be mistaken for the one that runs the tests.
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
 * Two kinds of line are dropped first:
 *
 *   COMMENTS. ci.yml's prose quotes filter spellings that were tried and REJECTED; reading those as
 *   arguments would assert against a filter list nothing runs.
 *
 *   ANYTHING HOLDING A `$`. The scoped path builds `--filter "...$pkg"` in a shell loop, one per
 *   changed package. On a GLOBAL scope that loop runs zero times, and a global scope is the case
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

// ---- Sharded jobs ----
//
// A package too big for one runner shards its test FILES with vitest's `--shard=i/N` (a matrix
// job), each shard emitting a PARTIAL-coverage `blob`; a paired merge job merges the blobs and
// enforces the coverage thresholds on the TOTAL. None of that is visible to the partition checks
// above — a sharded job still selects its one package, once.

/** A job's `needs:` in EITHER inline (`needs: [a, b]`) or block (`needs:\n  - a`) form. */
function allNeedsOf(body) {
  const inline = body.find((line) => /^ {4}needs:\s*\[/.test(line));
  if (inline !== undefined) {
    return [...inline.matchAll(/[[,]\s*([A-Za-z0-9_-]+)/g)].map(([, id]) => id);
  }
  return needsOf(body);
}

/** The package a non-comment line runs `pnpm --filter "<pkg>" <script>` for, or undefined. */
function packageRunning(body, script) {
  for (const line of body) {
    if (line.trim().startsWith("#")) continue;
    const found = new RegExp(`pnpm --filter "([^"]+)" ${script}\\b`).exec(line);
    if (found !== null) return found[1];
  }
  return undefined;
}

/** The inline `strategy.matrix.shard` list as strings, e.g. ["1","2","3"], or undefined. */
function matrixShards(body) {
  const line = body.find((candidate) => /^ {8}shard:\s*\[/.test(candidate));
  if (line === undefined) return undefined;
  const inner = /\[([^\]]*)\]/.exec(line)?.[1] ?? "";
  return inner
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The N in `--shard=${{ matrix.shard }}/N`, or undefined when absent. The regex requires the
 * numerator to be the matrix variable, so a constant numerator (every leg running one shard) makes
 * this undefined and fails the case rather than passing on a hidden bug.
 */
function shardDenominator(body) {
  for (const line of body) {
    if (line.trim().startsWith("#")) continue;
    const found = /--shard=\$\{\{\s*matrix\.shard\s*\}\}\/(\d+)/.exec(line);
    if (found !== null) return Number(found[1]);
  }
  return undefined;
}

/** The blob artifact's base name from an `upload-artifact` `name: <base>-${{ matrix.shard }}`. */
function artifactUploadBase(body) {
  const line = body.find((candidate) =>
    /^ {10}name: \S+-\$\{\{\s*matrix\.shard\s*\}\}\s*$/.test(candidate),
  );
  return line === undefined ? undefined : /name: (\S+?)-\$\{\{/.exec(line)?.[1];
}

/** The blob artifact's base name from a `download-artifact` `pattern: <base>-*`. */
function artifactDownloadBase(body) {
  const line = body.find((candidate) => /^ {10}pattern: \S+-\*\s*$/.test(candidate));
  return line === undefined ? undefined : /pattern: (\S+?)-\*/.exec(line)?.[1];
}

const testShardJobs = jobs
  .map(({ id, body }) => ({ id, body, pkg: packageRunning(body, "test:shard") }))
  .filter(({ pkg }) => pkg !== undefined);
const shardedJobs = testShardJobs.filter(({ body }) => matrixShards(body) !== undefined);
const mergeJobs = jobs
  .map(({ id, body }) => ({ id, body, pkg: packageRunning(body, "test:merge") }))
  .filter(({ pkg }) => pkg !== undefined);

/** A job's `if:` gates read exactly `code` plus one SCOPE_GATES-defined gate. */
function expectGatedOnCodePlusOneScope(read) {
  const names = SCOPE_GATES.map((gate) => gate.output);
  expect(read).toContain("code");
  const own = read.filter((name) => name !== "code");
  expect(own).toHaveLength(1);
  expect(names).toContain(own[0]);
}

/** Every workspace member's package.json `scripts`, keyed by package name (never the root). */
function scriptsByPackage() {
  const map = new Map();
  for (const pkg of pnpmLs(["ls", "-r", "--depth", "-1", "--json"])) {
    if (resolve(pkg.path) === resolve(repoRoot)) continue;
    map.set(
      pkg.name,
      JSON.parse(readFileSync(join(pkg.path, "package.json"), "utf8")).scripts ?? {},
    );
  }
  return map;
}

/**
 * The default runner behind `pnpmLs`: `pnpm <args>` under the per-call kill timeout (see the
 * two-timeout note above). `spawn` is injected only so a test can assert the `timeout` is passed.
 */
function spawnPnpm(args, spawn = spawnSync) {
  return spawn("pnpm", args, {
    encoding: "utf8",
    cwd: repoRoot,
    timeout: PNPM_LS_SPAWN_TIMEOUT_MS,
  });
}

/**
 * Run `pnpm <args>` via `run` and return its parsed-JSON stdout, or throw an Error naming the
 * command, so a killed child fails loudly rather than as `expected null to be 0`.
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
 * Dropping it is not cosmetic: `pnpm ls` LISTS the root and `pnpm run` does NOT RUN it.
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

/** Every workspace member that declares the Vitest browser provider. */
function browserPackages() {
  return pnpmLs(["ls", "-r", "--depth", "-1", "--json"])
    .filter((pkg) => resolve(pkg.path) !== resolve(repoRoot))
    .filter((pkg) => {
      const manifest = JSON.parse(readFileSync(join(pkg.path, "package.json"), "utf8"));
      return manifest.devDependencies?.["@vitest/browser-playwright"] !== undefined;
    })
    .map((pkg) => pkg.name);
}

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

  it("the default runner passes the per-call kill timeout to spawnSync", () => {
    let opts;
    const spy = (_cmd, _args, options) => {
      opts = options;
      return { status: 0, error: undefined, stdout: "[]", stderr: "" };
    };
    spawnPnpm(["ls"], spy);
    expect(opts.timeout).toBe(PNPM_LS_SPAWN_TIMEOUT_MS);
  });

  it("really kills a hung child via spawnSync's own timeout", () => {
    const hang = () =>
      spawnSync("node", ["-e", "setTimeout(() => {}, 60000)"], { encoding: "utf8", timeout: 500 });
    expect(() => pnpmLs(["ls"], hang)).toThrow(/failed to run/);
  });
});

describe("the workflow's concurrency group", () => {
  it("was parsed at all", () => {
    expect(concurrency.group).toContain("github.workflow");
    expect(concurrency.cancelInProgress).not.toBe("");
  });

  // GitHub allows only one PENDING run per group and a newer arrival cancels the one already
  // waiting, which `cancel-in-progress` does not reach. Receipt: `docs/developers/ci-and-gates.md`.
  // These cases pin how the expression is written, not what GitHub evaluates it to.
  //
  // The operand ORDER is pinned, not just the names: `push && github.ref || github.run_id` reads
  // plausibly, mentions both, and puts every push back into one group per branch.
  it("gives every push a group of its own, so one push cannot displace another", () => {
    expect(concurrency.group).toMatch(
      /github\.event_name\s*==\s*'push'\s*&&\s*github\.run_id\s*\|\|\s*github\.ref/,
    );
  });

  // Anchored at both ends, so an appended `|| true` — which would cancel pushes again — fails here.
  it("still lets a pull request's newer run supersede its own older one", () => {
    expect(concurrency.cancelInProgress).toMatch(
      /^\$\{\{\s*github\.event_name\s*!=\s*'push'\s*\}\}$/,
    );
  });

  // The script's own behaviour is `scripts/main-tag-guard.test.mjs`; this pins that the job ASKS.
  it("has the publish job ask before it moves the `:main` tag, and obey the answer", () => {
    const body = job("publish").body;
    const text = body.join("\n");
    expect(text).toMatch(/decision=\$\(scripts\/main-tag-guard\.sh[^)]*\)/);

    // Asking is not obeying: a `tags=` line that added `:main` unconditionally would leave the call
    // above in place and still publish the backwards tag.
    const moveArm = body.findIndex((line) => /^\s*move\)\s*$/.test(line));
    const armEnd = body.findIndex((line, index) => index > moveArm && /^\s*;;\s*$/.test(line));
    expect(moveArm).toBeGreaterThan(-1);
    expect(armEnd).toBeGreaterThan(moveArm);

    // Matching the VARIABLE and the tag, rather than one exact line, catches a `:main` appended
    // somewhere else in the step.
    const setsMainTag = (line) => /[a-z_]*tags="[^"]*repo:main"/.test(line);
    const setters = body
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => setsMainTag(line));
    expect(setters.length).toBeGreaterThanOrEqual(2);
    expect(setters.filter(({ index }) => index < moveArm || index > armEnd)).toEqual([]);
  });
});

describe("ci.yml's job graph", () => {
  it("was parsed at all", () => {
    expect(jobs.length).toBeGreaterThan(1);
    expect(jobs.map((entry) => entry.id)).toContain("ci");
  });

  // `publish` is the ONE deliberate exception: it runs AFTER `ci` (it `needs: ci`), so it cannot be
  // in `ci`'s needs without a cycle. The next case pins its safety instead.
  it("names every other job in `ci`'s needs, except the post-`ci` publish leaf", () => {
    const others = jobs.map((entry) => entry.id).filter((id) => id !== "ci" && id !== "publish");
    expect(others.length).toBeGreaterThan(0);
    expect([...needsOf(job("ci").body)].sort()).toEqual([...others].sort());
  });

  it("gates the publish job downstream of the full `ci` aggregate", () => {
    const body = job("publish").body;
    expect(allNeedsOf(body)).toContain("ci");
    const ifLine = body.find((line) => /^ {4}if:/.test(line)) ?? "";
    // The success comparison itself, not a mention: `== 'failure'` also mentions `needs.ci.result`.
    expect(ifLine).toMatch(/needs\.ci\.result\s*==\s*'success'/);
  });

  it("publishes the print-agent image from the gated publish job", () => {
    const body = job("publish").body.join("\n");
    expect(body).toContain("target: print-agent");
    expect(body).toContain("tags: ${{ steps.tags.outputs.agent_tags }}");
  });

  it("needs nothing that is not a job in this file", () => {
    const ids = jobs.map((entry) => entry.id);
    const needs = needsOf(job("ci").body);
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.filter((entry) => !ids.includes(entry))).toEqual([]);
  });
});

describe("the test shards", () => {
  it("runs both UI packages sequentially and verifies the tarball", () => {
    const body = job("test-ui").body.join("\n");
    expect(literalFilters(shardStep(job("test-ui").body)).sort()).toEqual([
      "@waitron/ui",
      "@waitron/ui-core",
    ]);
    expect(body).toContain(
      'pnpm --filter "@waitron/ui" --filter "@waitron/ui-core" --workspace-concurrency=1 test:coverage',
    );
    expect(body.split("\n").map((line) => line.trim())).toContain(
      "- run: pnpm --filter @waitron/ui-core test:package",
    );
  });

  it("keeps weekly mutation checks for both UI packages", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/mutation.yml"), "utf8");
    const ui = workflow.slice(workflow.indexOf("  mutation:"), workflow.indexOf("  mutation-db:"));
    expect(ui).toContain("package: [ui, ui-core]");
    expect(ui).toContain("fail-fast: false");
    expect(ui.split("\n").map((line) => line.trim())).toContain(
      "- run: pnpm --filter @waitron/${{ matrix.package }} mutation",
    );
    expect(ui).toContain("name: mutation-report-${{ matrix.package }}");
    expect(ui).toContain("path: packages/${{ matrix.package }}/reports/mutation/");
  });

  it("isolates Bookings from the light bins", () => {
    const name = "@waitron/bookings";
    expect(OWN_SHARD_PACKAGES).toContain(name);
    expect(LIGHT_A_PACKAGES).not.toContain(name);
    expect(LIGHT_B_PACKAGES).not.toContain(name);
  });

  it("bounds every test job, including startup and teardown", () => {
    const testJobs = jobs.filter(({ id }) => id.startsWith("test-"));
    expect(testJobs.length).toBeGreaterThan(0);
    for (const { id, body } of testJobs) {
      const minutes = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(body.join("\n"))?.[1]);
      expect(minutes, id).toBeGreaterThan(0);
      expect(minutes, id).toBeLessThanOrEqual(15);
    }
  });

  it("caps light-bin package concurrency explicitly", () => {
    for (const id of ["test-light-a", "test-light-b"]) {
      expect(job(id).body.join("\n")).toContain("--workspace-concurrency=2");
    }
  });

  it("gives every browser package its own shard and installs Chromium there", () => {
    const browser = browserPackages();
    expect(browser.length).toBeGreaterThan(0);

    for (const name of browser) {
      const dedicated = shards.filter((shard) => shard.filters.includes(name));
      expect(dedicated, name).toHaveLength(1);

      const body = job(dedicated[0].id).body.join("\n");
      expect(body, name).toContain(`pnpm --filter ${name} exec playwright install chromium`);
    }
  });

  it("were found, each with at least one filter", () => {
    expect(shards.length).toBeGreaterThan(1);
    for (const shard of shards) expect(shard.filters.length).toBeGreaterThan(0);
  });

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

      expect([...runs].filter(([, shardIds]) => shardIds.length > 1)).toEqual([]);

      expect(declaring.filter((name) => !runs.has(name))).toEqual([]);

      // Without this a package could be "covered" by a shard that then runs nothing for it.
      expect([...runs.keys()].filter((name) => !declaring.includes(name)).sort()).toEqual(
        [...PACKAGES_WITHOUT_TESTS].sort(),
      );
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );

  // Written as literal `!` filters in ci.yml and as the bin lists in changed-scope.mjs, and nothing
  // but this makes them agree: a package in neither exclusion set runs in BOTH shards, and one in
  // both exclusion sets stops being tested.
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
    "give each package its dedicated shard, with the UI pair sharing one",
    () => {
      for (const name of OWN_SHARD_PACKAGES) {
        const dedicated = shards.filter((shard) => shard.filters.includes(name));
        expect(dedicated).toHaveLength(1);
        expect(selects(dedicated[0].filters)).toEqual(
          name === "@waitron/ui" || name === "@waitron/ui-core"
            ? ["@waitron/ui", "@waitron/ui-core"]
            : [name],
        );
      }
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );
});

describe("the scope gates", () => {
  // A gate the `changes` job never declares as an output is read as the empty string — not
  // `'true'` — so the job it gates silently never runs.
  it("are each declared as a `changes` job output", () => {
    const declared = outputsOf(job("changes").body);
    expect(declared).toContain("code");
    for (const gate of SCOPE_GATES) expect(declared).toContain(gate.output);
  });

  // A gate that gates nothing means a shard was planned and not wired.
  it("are each read by some job's `if:`", () => {
    const read = new Set(jobs.flatMap((entry) => gatesRead(entry.body)));
    for (const gate of SCOPE_GATES) expect([...read]).toContain(gate.output);
  });

  // A shard gated on `code` alone runs on every code change.
  it("gate every shard on `code` plus one gate of its own", () => {
    for (const shard of shards) expectGatedOnCodePlusOneScope(gatesRead(job(shard.id).body));
  });
});

describe("the image smoke's scoping", () => {
  // A pull request runs the image smoke only when `deploy/` changed; a push to `main` still smokes
  // on `code` alone, because `publish` ships the image off this smoke passing.
  it("declares a `deploy` output on the `changes` job", () => {
    expect(outputsOf(job("changes").body)).toContain("deploy");
  });

  it("gates the image job on `code` and reads `deploy` to scope its pull-request runs", () => {
    const gates = gatesRead(job("image").body);
    expect(gates).toContain("code");
    expect(gates).toContain("deploy");
  });

  it("scopes the `deploy` narrowing to pull requests, so every main push is still smoked", () => {
    const ifLine = job("image").body.find((line) => /^ {4}if:/.test(line)) ?? "";
    expect(ifLine).toMatch(/github\.event_name != 'pull_request'/);
  });

  // The cases above check that `code`, `deploy` and the event guard are PRESENT, not how they
  // combine, so the real extracted `if:` is also evaluated as a truth table. GitHub's
  // `==`/`!=`/`&&`/`||` match JS once `==`→`===` and `!=`→`!==` (in that order: `!=`→`!==` first
  // would then be hit by `==`→`===` and become `!===`).
  const imageIf = () => {
    const line = job("image").body.find((entry) => /^ {4}if:/.test(entry)) ?? "";
    return line.replace(/^ {4}if:\s*/, "").trim();
  };
  const runsWhen = (expr, { event_name, code, deploy }) => {
    const js = expr
      .replace(/needs\.changes\.outputs\.code/g, JSON.stringify(code))
      .replace(/needs\.changes\.outputs\.deploy/g, JSON.stringify(deploy))
      .replace(/github\.event_name/g, JSON.stringify(event_name))
      .replace(/==/g, "===")
      .replace(/!=/g, "!==");
    // `new Function` evaluates our OWN workflow's boolean, extracted from the repo file — not
    // untrusted input.
    return Boolean(new Function(`return (${js});`)());
  };

  const cases = [
    {
      name: "a PR that does not touch deploy/ skips",
      ctx: { event_name: "pull_request", code: "true", deploy: "false" },
      run: false,
    },
    {
      name: "a PR that touches deploy/ runs",
      ctx: { event_name: "pull_request", code: "true", deploy: "true" },
      run: true,
    },
    {
      name: "a docs-only PR skips",
      ctx: { event_name: "pull_request", code: "false", deploy: "false" },
      run: false,
    },
    {
      name: "a code push to main runs even without deploy/",
      ctx: { event_name: "push", code: "true", deploy: "false" },
      run: true,
    },
    {
      name: "a deploy push to main runs",
      ctx: { event_name: "push", code: "true", deploy: "true" },
      run: true,
    },
    {
      name: "a docs-only push skips",
      ctx: { event_name: "push", code: "false", deploy: "false" },
      run: false,
    },
  ];

  it.each(cases)("gates the image job so $name", ({ ctx, run }) => {
    expect(runsWhen(imageIf(), ctx)).toBe(run);
  });

  // The negative control: otherwise the truth table above could measure nothing.
  it("would catch the inner || being flipped to &&", () => {
    const real = imageIf();
    const mutated = real.replace("||", "&&");
    expect(mutated).not.toBe(real);
    const differs = cases.some(({ ctx }) => runsWhen(real, ctx) !== runsWhen(mutated, ctx));
    expect(differs).toBe(true);
  });
});

describe("the sharded jobs", () => {
  it("were found, and each has a matching merge job", () => {
    expect(shardedJobs.length).toBeGreaterThan(0);
    expect(mergeJobs.length).toBe(shardedJobs.length);
  });

  // Without this, deleting a sharded job's matrix would drop it from every case below unseen.
  it("are every job running test:shard, apart from the stream job", () => {
    expect(
      testShardJobs
        .filter(({ id }) => !shardedJobs.some((shard) => shard.id === id))
        .map(({ id }) => id),
    ).toEqual([STREAM_JOB]);
  });

  // If the matrix legs and the `--shard=i/N` denominator disagree, a bucket of files runs twice or
  // never — and because the merge job gates on whatever the blobs contain, a missing bucket is a
  // coverage HOLE that still reports green.
  it("run a matrix of exactly 1..N shards whose N equals the --shard denominator", () => {
    for (const { id, body } of shardedJobs) {
      const matrix = matrixShards(body);
      expect(matrix, `${id} has no strategy.matrix.shard list`).toBeDefined();
      const denom = shardDenominator(body);
      expect(denom, `${id} has no --shard=\${{ matrix.shard }}/N`).toBeDefined();
      expect(matrix).toEqual(Array.from({ length: denom }, (_, i) => String(i + 1)));
    }
  });

  // `pnpm --filter X test:shard -- <args>` forwards the `--` LITERALLY into the vitest command, and
  // vitest (cac) treats every option after a bare `--` as positional, so both flags are silently
  // dropped. The regex fails on `test:shard --` followed by a space/backslash/end (a bare separator)
  // but not on `--shard`/`--outputFile` (letters follow the `--`).
  it("forward --shard and --outputFile to test:shard without a bare `--` separator", () => {
    for (const shard of shardedJobs) {
      const step = shardStep(shard.body);
      expect(step, `${shard.id} has no "Run the … shard" step`).toBeDefined();
      const text = step.join("\n");
      expect(text).toMatch(/--shard=\$\{\{\s*matrix\.shard\s*\}\}\//);
      expect(text).toContain("--outputFile=");
      expect(
        text,
        `${shard.id}: a bare \`--\` after test:shard is forwarded into vitest and drops the flags`,
      ).not.toMatch(/test:shard\s+--(\s|\\|$)/);
    }
  });

  // Any of these wrong runs the gate on missing or stale blobs, or skips it while the shards ran.
  it("each pair to one merge job for the same package that needs it and shares its gate", () => {
    for (const shard of shardedJobs) {
      const shardGate = gatesRead(shard.body).filter((name) => name !== "code");
      const paired = mergeJobs.filter((merge) => merge.pkg === shard.pkg);
      expect(paired, `${shard.pkg} has ${paired.length} merge jobs, expected 1`).toHaveLength(1);
      expect(allNeedsOf(paired[0].body)).toContain(shard.id);
      expect(gatesRead(paired[0].body).filter((name) => name !== "code")).toEqual(shardGate);
    }
  });

  it("upload a blob artifact the merge job downloads by matching prefix", () => {
    for (const shard of shardedJobs) {
      const merge = mergeJobs.find((candidate) => candidate.pkg === shard.pkg);
      const upload = artifactUploadBase(shard.body);
      const download = artifactDownloadBase(merge.body);
      expect(upload, `${shard.id} uploads no matrix-named blob artifact`).toBeDefined();
      expect(download, `${merge.id} downloads no *-pattern blob artifact`).toBeDefined();
      expect(upload).toBe(download);
    }
  });

  it("gate every merge job on `code` plus exactly one scope gate", () => {
    for (const merge of mergeJobs) expectGatedOnCodePlusOneScope(gatesRead(merge.body));
  });
});

/**
 * The stream loop and pause tests run in a job of their own, beside the apps/server shards: they
 * need two downloaded binaries. Their blob joins the server's coverage merge. Read from ci.yml as
 * TEXT, so a step an `if:` switches off still passes.
 */
describe("the stream loop and pause tests' own job", () => {
  const stream = () => job(STREAM_JOB);
  const streamText = () => stream().body.join("\n");

  it("names test files that exist", () => {
    for (const file of STREAM_TEST_FILES) {
      expect(existsSync(join(repoRoot, "apps", "server", file)), file).toBe(true);
    }
  });

  it("runs exactly those files, unsharded, after installing both binaries", () => {
    expect(streamText()).toContain('pnpm --filter "@waitron/server" test:shard');
    const body = stream().body;
    const start = body.findIndex(
      (line) => !line.trim().startsWith("#") && line.includes("test:shard"),
    );
    expect(start).toBeGreaterThan(-1);
    const step = body.slice(start);
    const args = step
      .slice(0, step.findIndex((line) => !line.trimEnd().endsWith("\\")) + 1)
      .join(" ");
    for (const file of STREAM_TEST_FILES) expect(args).toContain(` ${file}`);
    expect(args.match(/\bsrc\/\S+\.test\.ts\b/g)).toHaveLength(STREAM_TEST_FILES.length);
    expect(args).not.toContain("--shard=");
    for (const installer of STREAM_BINARY_INSTALLERS) {
      const at = body.findIndex((line) => line.includes(installer));
      expect(at, installer).toBeGreaterThan(-1);
      expect(at, installer).toBeLessThan(start);
    }
  });

  it("is the only job that installs the binaries", () => {
    for (const { id, body } of jobs.filter(({ id }) => id !== STREAM_JOB)) {
      const code = body.filter((line) => !line.trim().startsWith("#")).join("\n");
      for (const installer of STREAM_BINARY_INSTALLERS) expect(code, id).not.toContain(installer);
    }
  });

  it("takes both files out of every apps/server shard", () => {
    const step = shardStep(job("test-server").body)?.join("\n") ?? "";
    for (const file of STREAM_TEST_FILES) expect(step).toContain(`--exclude ${file}`);
  });

  it("feeds its blob to the server's coverage merge", () => {
    const merge = job("test-server-merge");
    expect(allNeedsOf(merge.body)).toContain(STREAM_JOB);
    const download = artifactDownloadBase(merge.body);
    expect(download).toBe("server-blob");
    expect(streamText()).toMatch(new RegExp(`^ {10}name: ${download}-stream\\s*$`, "m"));
    expect(streamText()).toContain("path: apps/server/.vitest-reports/blob-stream.json");
    expect(streamText()).toContain("--outputFile=.vitest-reports/blob-stream.json");
    expect(streamText()).toContain("if-no-files-found: error");
  });

  it("is gated exactly as the apps/server shards are", () => {
    expect(gatesRead(stream().body).sort()).toEqual(gatesRead(job("test-server").body).sort());
  });
});

describe("the sharded packages' scripts", () => {
  // The sharding MECHANISM lives half in each sharded package's `test:shard` / `test:merge` scripts,
  // which ci.yml only NAMES. Two drifts there are SILENT, and nothing but these cases catches them:
  // a `test:shard` without `--coverage` writes a blob with no coverage map, which the merge passes
  // vacuously; a `test:merge` without `--coverage` checks no thresholds and passes green.
  const scripts = scriptsByPackage();
  const shardedPackages = [...new Set(shardedJobs.map((shard) => shard.pkg))];

  it("were found", () => {
    expect(shardedPackages.length).toBeGreaterThan(0);
  });

  it("each declare a test:shard that collects coverage into a blob with thresholds suppressed", () => {
    for (const pkg of shardedPackages) {
      const shard = scripts.get(pkg)?.["test:shard"];
      expect(shard, `${pkg} has no test:shard script`).toBeDefined();
      expect(shard).toContain("--coverage");
      expect(shard).toContain("--reporter=blob");
      expect(shard, `${pkg} must print failures even when the coverage merge is skipped`).toContain(
        "--reporter=default",
      );
      for (const metric of ["statements", "lines", "functions", "branches"]) {
        expect(shard, `${pkg} test:shard must zero the ${metric} threshold`).toContain(
          `--coverage.thresholds.${metric}=0`,
        );
      }
    }
  });

  it("each declare a test:merge that enforces coverage on the merged blobs", () => {
    for (const pkg of shardedPackages) {
      const merge = scripts.get(pkg)?.["test:merge"];
      expect(merge, `${pkg} has no test:merge script`).toBeDefined();
      expect(merge).toContain("--merge-reports");
      expect(merge, `${pkg} test:merge must pass --coverage or the gate checks nothing`).toContain(
        "--coverage",
      );
    }
  });

  it("share one test:shard and one test:merge across every sharded package", () => {
    // They are hand-copied across packages.
    expect(new Set(shardedPackages.map((pkg) => scripts.get(pkg)?.["test:shard"])).size).toBe(1);
    expect(new Set(shardedPackages.map((pkg) => scripts.get(pkg)?.["test:merge"])).size).toBe(1);
  });
});

/**
 * A workflow step must not capture the SERVER bundle's output in a `$(…)`: the bundle SERVES, so a
 * capture never returns and the step runs until the job's own limit kills it.
 *
 * It reads the workflow as TEXT, so it sees a `node …server.js` written literally and nothing
 * reached through a variable or a script.
 *
 * The credentials CLI is deliberately outside it: `packages/credentials/dist/bin.js` refuses and
 * exits when `WAITRON_VENUE_DIR` is unset, so a capture of THAT one returns.
 */
describe("the server bundle's smoke steps", () => {
  const serverBundle = /node\s+\S*(?:server\.js|node-entry\.js)/;

  it("never capture a bundle that serves, because the capture would never return", () => {
    const captured = lines.filter(
      (line) => serverBundle.test(line) && /=\s*\$\(/.test(line) && !line.trim().startsWith("#"),
    );
    expect(
      captured,
      "a $(…) around the server bundle waits for a process that serves until it is killed; " +
        "background it, poll its log for server.listening, then kill it",
    ).toEqual([]);
  });

  it("bound every run of the bundle with a timeout", () => {
    const runs = lines.filter(
      (line) => serverBundle.test(line) && !line.trim().startsWith("#") && !/grep|echo/.test(line),
    );
    expect(runs.length, "expected the two bundle smoke steps to still be here").toBeGreaterThan(0);
    for (const line of runs) {
      expect(line, `this run of the bundle has no timeout: ${line.trim()}`).toMatch(/\btimeout\s/);
    }
  });
});
