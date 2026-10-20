import { execFile, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
// EVERYTHING HERE IS EXTRACTED FROM THE WORKFLOWS, never transcribed — from ci.yml, except one case
// reading mutation.yml, two reading codeql.yml, and a token-permissions case, a time-limit case,
// two apt cases, a `--with-deps` case, the pnpm-setup cases and the checkout cases reading every
// .yml file in .github/workflows/. A transcription tests this file's copy of a workflow rather than
// the workflow. Each extraction carries a guard that it found something, because a silently-empty
// extraction makes every assertion below pass against nothing. Nor are the SELECTIONS modelled:
// each shard's filters are handed to the real `pnpm ls` and the answer is read back.
//
// Line matching rather than a YAML parser, because there is no YAML library in this workspace.
// Compare the extractions with a real YAML parser's rather than reasoning about the regexes if this
// file ever starts disagreeing with the workflow.

// eslint.config.js gives `scripts/**/*.mjs` only `console` and `process` as globals.
const { AbortController } = globalThis;

const repoRoot = join(import.meta.dirname, "..");
const lines = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8").split("\n");

// `pnpm ls` runs two ways here, under two timeouts:
//   * `workspaceListing()` runs once, through `spawnSync`, while the file is collected
//     (`scriptsByPackage()` needs it then). `spawnSync` blocks the event loop, so no Vitest timer
//     can fire meanwhile; only its own `timeout`, `PNPM_LS_SPAWN_TIMEOUT_MS`, kills a hung child,
//     and `pnpmLs` turns the killed result into a thrown error.
//   * The shard cases' `selects(...)` calls run side by side through `execFile`, under the same
//     per-call kill. There the per-test bound, `PNPM_LS_TEST_TIMEOUT_MS`, can fail a case while a
//     call is still running, but it does not stop the child: the per-call kill does, and so does
//     the shards' `afterEach`, which aborts every call still running when a case ends. The per-call
//     kill is the smaller, so a hung call fails with its own error rather than a bare timeout.
const PNPM_LS_SPAWN_TIMEOUT_MS = 30_000;
const PNPM_LS_TEST_TIMEOUT_MS = 60_000;

const STREAM_JOB = "test-server-stream";
const STREAM_TEST_FILES = [
  "src/stream-loop.e2e.test.ts",
  "src/stream-pause.e2e.test.ts",
  "src/s3-rehearsal-scenarios.e2e.test.ts",
  "src/aws-send-gate.e2e.test.ts",
  "src/aws-rehearsal-interrupt.e2e.test.ts",
  "src/testing/s3-test-server.test.ts",
];
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

/** The FIRST matrix-named upload's base name (`name: <base>-${{ matrix.shard }}`): the blob. */
function artifactUploadBase(body) {
  const line = body.find((candidate) =>
    /^ {10}name: \S+-\$\{\{\s*matrix\.shard\s*\}\}\s*$/.test(candidate),
  );
  return line === undefined ? undefined : /name: (\S+?)-\$\{\{/.exec(line)?.[1];
}

/** The non-comment lines of the FIRST matrix-named upload step (the blob), or undefined. */
function artifactUploadStep(body) {
  const named = body.findIndex((line) =>
    /^ {10}name: \S+-\$\{\{\s*matrix\.shard\s*\}\}\s*$/.test(line),
  );
  if (named === -1) return undefined;
  const start = body.findLastIndex((line, index) => index < named && /^ {6}- /.test(line));
  const next = body.findIndex((line, index) => index > named && /^ {6}- /.test(line));
  return body
    .slice(start, next === -1 ? body.length : next)
    .filter((line) => !line.trim().startsWith("#"));
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

let listing;

/** `pnpm ls -r --depth -1 --json`, run once on first use and shared by every caller. */
function workspaceListing() {
  listing ??= pnpmLs(["ls", "-r", "--depth", "-1", "--json"]);
  return listing;
}

/** Every workspace member's package.json `scripts`, keyed by package name (never the root). */
function scriptsByPackage() {
  const map = new Map();
  for (const pkg of workspaceListing()) {
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
  return parsePnpm(args, run(args));
}

/**
 * The default runner behind `pnpmLsAsync`: `pnpm <args>` under the same per-call kill timeout,
 * without blocking, and killed when `signal` aborts. Resolves to `spawnSync`'s result shape.
 * `exec` is injected only so a test can assert what is passed.
 */
function execPnpm(args, signal, exec = execFile) {
  return new Promise((resolveRun) => {
    exec(
      "pnpm",
      args,
      { encoding: "utf8", cwd: repoRoot, timeout: PNPM_LS_SPAWN_TIMEOUT_MS, signal },
      (error, stdout, stderr) => {
        if (error === null) resolveRun({ status: 0, error: undefined, stdout, stderr });
        else if (typeof error.code === "number") {
          resolveRun({ status: error.code, error: undefined, stdout, stderr });
        } else resolveRun({ status: null, error, stdout, stderr });
      },
    );
  });
}

/** `pnpmLs`, run without blocking so several can run side by side. */
async function pnpmLsAsync(args, signal, run = execPnpm) {
  return parsePnpm(args, await run(args, signal));
}

function parsePnpm(args, result) {
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

/** Each filter set's answer from `selects`, kept only once it has succeeded. */
const selections = new Map();

/**
 * What `pnpm <filters> ls --depth -1 --json` really selects, minus the workspace ROOT.
 *
 * The root is dropped by PATH rather than by name, exactly as `workspacePackages`
 * (scripts/changed-packages.mjs) drops it, because a member's name is a manifest field anyone can
 * change while its path is a fact about the tree.
 *
 * Dropping it is not cosmetic: `pnpm ls` LISTS the root and `pnpm run` does NOT RUN it.
 */
async function selects(filters, signal) {
  const key = JSON.stringify(filters);
  const known = selections.get(key);
  if (known !== undefined) return known;
  const names = (
    await pnpmLsAsync(
      [...filters.flatMap((filter) => ["--filter", filter]), "ls", "--depth", "-1", "--json"],
      signal,
    )
  )
    .filter((pkg) => resolve(pkg.path) !== resolve(repoRoot))
    .map((pkg) => pkg.name);
  selections.set(key, names);
  return names;
}

/** Every workspace member (never the root) that declares a `test:coverage` script. */
function membersDeclaringTests() {
  return workspaceListing()
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
  return workspaceListing()
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

describe("pnpmLsAsync (the side-by-side subprocess guard)", () => {
  const hang = ["-e", "setTimeout(() => {}, 60000)"];
  /** `execPnpm`'s own option and result handling, running `node <args>` in place of pnpm. */
  const asNode =
    (nodeArgs, overrides = {}) =>
    (_cmd, _args, options, callback) =>
      execFile("node", nodeArgs, { ...options, ...overrides }, callback);

  it("returns parsed stdout on a clean exit", async () => {
    const ok = async () => ({
      status: 0,
      error: undefined,
      stdout: '[{"name":"@waitron/x"}]',
      stderr: "",
    });
    await expect(pnpmLsAsync(["ls"], undefined, ok)).resolves.toEqual([{ name: "@waitron/x" }]);
  });

  it("throws, naming the command and stderr, on a non-zero exit", async () => {
    const failed = async () => ({ status: 1, error: undefined, stdout: "", stderr: "boom" });
    await expect(pnpmLsAsync(["ls", "-r"], undefined, failed)).rejects.toThrow(
      /pnpm ls -r.*exited 1.*boom/,
    );
  });

  it("throws, naming the command, when the child errors (the timeout-kill shape)", async () => {
    const killed = async () => ({
      status: null,
      error: Object.assign(new Error("Command failed: pnpm ls"), { killed: true, code: null }),
      stdout: "",
      stderr: "",
    });
    await expect(pnpmLsAsync(["ls"], undefined, killed)).rejects.toThrow(
      /pnpm ls.*failed to run.*Command failed/,
    );
  });

  it("the default runner passes the per-call kill timeout and the signal to execFile", async () => {
    let seen;
    const spy = (cmd, args, options, callback) => {
      seen = { cmd, args, options };
      callback(null, "[]", "");
    };
    const { signal } = new AbortController();
    await expect(execPnpm(["ls"], signal, spy)).resolves.toEqual({
      status: 0,
      error: undefined,
      stdout: "[]",
      stderr: "",
    });
    expect(seen.cmd).toBe("pnpm");
    expect(seen.args).toEqual(["ls"]);
    expect(seen.options.timeout).toBe(PNPM_LS_SPAWN_TIMEOUT_MS);
    expect(seen.options.signal).toBe(signal);
    expect(seen.options.cwd).toBe(repoRoot);
  });

  it("the default runner reports a real child's exit status and stderr", async () => {
    const exits = asNode(["-e", "process.stderr.write('boom'); process.exit(3)"]);
    await expect(
      pnpmLsAsync(["ls"], undefined, (args) => execPnpm(args, undefined, exits)),
    ).rejects.toThrow(/pnpm ls.*exited 3.*boom/);
  });

  it("really kills a hung child via execFile's own timeout", async () => {
    const started = Date.now();
    const slow = asNode(hang, { timeout: 500 });
    await expect(
      pnpmLsAsync(["ls"], undefined, (args) => execPnpm(args, undefined, slow)),
    ).rejects.toThrow(/failed to run/);
    expect(Date.now() - started).toBeLessThan(PNPM_LS_SPAWN_TIMEOUT_MS);
  });

  it("really kills a hung child when its signal aborts", async () => {
    const calls = new AbortController();
    const started = Date.now();
    const run = pnpmLsAsync(["ls"], calls.signal, (args, signal) =>
      execPnpm(args, signal, asNode(hang)),
    );
    setTimeout(() => calls.abort(), 100);
    await expect(run).rejects.toThrow(/failed to run.*aborted/);
    expect(Date.now() - started).toBeLessThan(PNPM_LS_SPAWN_TIMEOUT_MS);
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

const NEEDS_STEP =
  "Fail unless every needed job succeeded or was skipped, and no selected package's merge job was skipped";
const JOBS_API_STEP = "Fail unless GitHub's jobs API reports every needed job succeeded or skipped";

/**
 * One of the `ci` job's steps, found by its `name:`: its own keys (indent 8), every line of it, and
 * its `run: |` script, dedented. Weaker than GitHub: the `env:` values are read as text, so what
 * `${{ toJSON(needs) }}` and the other expressions evaluate to is GitHub's.
 */
function ciStepNamed(name) {
  const body = job("ci").body;
  const stepsAt = body.findIndex((line) => /^ {4}steps:\s*$/.test(line));
  if (stepsAt === -1) throw new Error("the `ci` job has no `steps:`");
  const starts = [];
  for (let at = stepsAt + 1; at < body.length; at++) if (/^ {6}- /.test(body[at])) starts.push(at);
  const steps = starts.map((at, index) => body.slice(at, starts[index + 1] ?? body.length));
  const named = steps.filter((lines) =>
    lines.some(
      (line, at) =>
        (at === 0 || /^ {8}\S/.test(line)) && line.trim().replace(/^- /, "") === `name: ${name}`,
    ),
  );
  if (named.length !== 1)
    throw new Error(`the \`ci\` job has ${named.length} steps named "${name}", not one`);

  const step = named[0];
  const keys = step.filter((line, at) => at === 0 || /^ {8}\S/.test(line));
  const runAt = step.findIndex((line) => /^ {8}run: \|\s*$/.test(line));
  if (runAt === -1) throw new Error(`the \`ci\` job's step "${name}" has no \`run: |\` block`);
  const script = [];
  for (const line of step.slice(runAt + 1)) {
    if (line.trim() !== "" && !line.startsWith(" ".repeat(10))) break;
    script.push(line.slice(10));
  }
  return { keys, step, script: script.join("\n") };
}

/** The `ci` job's first step, which reads `needs`. */
function ciVerdictStep() {
  return ciStepNamed(NEEDS_STEP);
}

/** The `ci` job's second step, which reads GitHub's jobs API. */
function ciJobsApiStep() {
  return ciStepNamed(JOBS_API_STEP);
}

// The slowest default-window case took 4.6 s in three root projects run at once beside eight CPU
// burners, and 3.2 s in an idle root run; a 10 s kill fired in lane G's loaded push on 2026-10-16
// (A751).
const VERDICT_SPAWN_TIMEOUT_MS = 30_000;

// A case's per-test bound clears the kill bound of every run it makes, plus five seconds for the
// rest.
const ONE_RUN_TEST_TIMEOUT_MS = 35_000;
const TWO_RUNS_TEST_TIMEOUT_MS = 65_000;
const THREE_RUNS_TEST_TIMEOUT_MS = 95_000;
const FOUR_RUNS_TEST_TIMEOUT_MS = 125_000;
const FIVE_RUNS_TEST_TIMEOUT_MS = 155_000;
// The merge-job cases run once, or three times, per merge job, and are bounded for this many.
const MERGE_JOBS_BOUNDED = 6;
const EIGHTEEN_RUNS_TEST_TIMEOUT_MS = 545_000;
const SIX_RUNS_TEST_TIMEOUT_MS = 185_000;
// The leftover-call case waits three times for a step of the killed run and makes one other run.
const LEFTOVER_STEP_WAIT_MS = 15_000;
const LEFTOVER_CALL_TEST_TIMEOUT_MS = 3 * LEFTOVER_STEP_WAIT_MS + VERDICT_SPAWN_TIMEOUT_MS + 5_000;

/** Resolves once `check()` is true, polling; rejects naming `what` after `ms`. */
async function waitUntil(check, ms, what) {
  const giveUpAt = Date.now() + ms;
  while (!check()) {
    if (Date.now() >= giveUpAt) throw new Error(`gave up after ${ms}ms waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

/** `promise`'s value, or a rejection naming `what` after `ms`. */
async function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, refuse) => {
    timer = setTimeout(() => refuse(new Error(`gave up after ${ms}ms waiting for ${what}`)), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

// jq's exit status for an `error(...)` or a failed `fromjson`. A jq compile error exits 3 and a
// missing jq 127, so neither can satisfy it; any error jq hits while running still exits 5, which
// is why every case also checks the message.
const JQ_REFUSED = 5;

/**
 * Runs the step's script as GitHub's default Linux shell does (`bash -e`), with `NEEDS` set, and
 * returns its stdout and stderr as ONE stream in the order written (`2>&1` inside the child), which
 * two separately captured streams joined afterwards cannot show. Throws on a killed child.
 */
function runVerdict(needs) {
  const env = { PATH: process.env.PATH, VERDICT_SCRIPT: ciVerdictStep().script };
  if (needs !== undefined) env.NEEDS = typeof needs === "string" ? needs : JSON.stringify(needs);
  // `exec` leaves one shell for the kill to hit, not two.
  const result = spawnSync("bash", ["-c", 'exec bash -e -c "$VERDICT_SCRIPT" 2>&1'], {
    encoding: "utf8",
    env,
    timeout: VERDICT_SPAWN_TIMEOUT_MS,
  });
  if (result.error !== undefined || result.status === null) {
    throw new Error(
      `the verdict script failed to run (killed after ${VERDICT_SPAWN_TIMEOUT_MS}ms?): ${result.error?.message ?? result.signal}`,
    );
  }
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("the `ci` aggregate's verdict", () => {
  const results = (...values) =>
    Object.fromEntries(values.map((result, at) => [`job-${at}`, { result, outputs: {} }]));

  it("always runs, reading every needed job's result from the environment", () => {
    const { keys, step } = ciVerdictStep();
    expect(keys.filter((line) => /^ {6}(?:- | {2})if:/.test(line))).toEqual([]);
    expect(step).toContain("          NEEDS: ${{ toJSON(needs) }}");
  });

  it(
    "passes when every needed job succeeded or was skipped, printing each one",
    () => {
      expect(runVerdict(results("success", "success"))).toEqual({
        status: 0,
        output: "job-0: success\njob-1: success\n",
      });
      expect(runVerdict(results("success", "skipped", "skipped"))).toEqual({
        status: 0,
        output: "job-0: success\njob-1: skipped\njob-2: skipped\n",
      });
    },
    TWO_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "fails when one failed or was cancelled, printing every job before naming it",
    () => {
      for (const bad of ["failure", "cancelled"]) {
        const { status, output } = runVerdict(results("success", bad, "skipped"));
        expect(status, bad).toBe(JQ_REFUSED);
        const printed = output.split("\n");
        const errorAt = printed.findIndex((line) =>
          line.includes("not succeeded or skipped: job-1"),
        );
        expect(errorAt, output).toBeGreaterThan(-1);
        expect(printed.slice(0, errorAt), output).toEqual([
          "job-0: success",
          `job-1: ${bad}`,
          "job-2: skipped",
        ]);
      }
    },
    TWO_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "fails on a result nobody anticipated, or none at all",
    () => {
      for (const odd of ["neutral", "", null, "Success"]) {
        const { status, output } = runVerdict(results("success", odd));
        expect(status, String(odd)).toBe(JQ_REFUSED);
        expect(output, String(odd)).toContain("not succeeded or skipped: job-1");
      }
      const missing = runVerdict({ a: { result: "success" }, b: { outputs: {} } });
      expect(missing.status).toBe(JQ_REFUSED);
      expect(missing.output).toContain("not succeeded or skipped: b");
    },
    FIVE_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "fails when it was handed no results to read",
    () => {
      for (const needs of ["{}", "[]"]) {
        const { status, output } = runVerdict(needs);
        expect(status, needs).toBe(JQ_REFUSED);
        expect(output, needs).toContain("no needed job results to read");
      }
    },
    TWO_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "fails when NEEDS is unset or not JSON",
    () => {
      for (const [needs, message] of [
        [undefined, "only strings can be parsed"],
        ["", "(while parsing '')"],
        ["not json", "(while parsing 'not json')"],
      ]) {
        const { status, output } = runVerdict(needs);
        expect(status, String(needs)).toBe(JQ_REFUSED);
        expect(output, String(needs)).toContain(message);
      }
    },
    THREE_RUNS_TEST_TIMEOUT_MS,
  );

  const ciMergeJobs = mergeJobs.map(({ id, body }) => ({
    id,
    gate: gatesRead(body).find((name) => name !== "code"),
    pkg: packageRunning(body, "test:merge"),
  }));

  /** Every job `ci` needs, succeeded, with `changes` carrying `outputs` and `merge` skipped. */
  const scoped = (outputs, merge, mergeResult = "skipped") => {
    const needs = Object.fromEntries(
      needsOf(job("ci").body).map((id) => [id, { result: "success", outputs: {} }]),
    );
    needs.changes.outputs = outputs;
    needs[merge].result = mergeResult;
    return needs;
  };

  it(
    "fails when a selected package's coverage merge job was skipped, naming the package",
    () => {
      expect(ciMergeJobs.length).toBeGreaterThan(0);
      expect(
        ciMergeJobs.length,
        "raise MERGE_JOBS_BOUNDED and the merge cases' bounds with it",
      ).toBeLessThanOrEqual(MERGE_JOBS_BOUNDED);
      for (const { id, gate, pkg } of ciMergeJobs) {
        const { status, output } = runVerdict(scoped({ code: "true", [gate]: "true" }, id));
        expect(status, id).toBe(JQ_REFUSED);
        expect(output, id).toContain(`${id}: skipped`);
        expect(output, id).toContain(
          `${pkg} was selected but its coverage merge job ${id} was skipped`,
        );
      }
    },
    SIX_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "passes a skipped merge job whose package was not selected, or when no code changed",
    () => {
      for (const { id, gate } of ciMergeJobs) {
        for (const outputs of [
          { code: "true", [gate]: "false" },
          { code: "false", [gate]: "true" },
          {},
        ]) {
          expect(runVerdict(scoped(outputs, id)).status, `${id} ${JSON.stringify(outputs)}`).toBe(
            0,
          );
        }
      }
    },
    EIGHTEEN_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "passes a selected package whose merge job succeeded",
    () => {
      for (const { id, gate } of ciMergeJobs) {
        expect(runVerdict(scoped({ code: "true", [gate]: "true" }, id, "success")).status, id).toBe(
          0,
        );
      }
    },
    SIX_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "lets a failed job's message win over a skipped merge job's",
    () => {
      const [{ id, gate }] = ciMergeJobs;
      const needs = scoped({ code: "true", [gate]: "true" }, id);
      needs.lint.result = "failure";
      const { status, output } = runVerdict(needs);
      expect(status).toBe(JQ_REFUSED);
      expect(output).toContain("not succeeded or skipped: lint");
      expect(output).not.toContain("was selected but");
    },
    ONE_RUN_TEST_TIMEOUT_MS,
  );

  // Reads ci.yml and the step's jq as TEXT: each `-merge` job's gate and package, against the
  // step's table; the cases above prove by running it that the table is what the step reads.
  it("names every coverage merge job in ci.yml, with the gate and package that job reads", () => {
    const mergeIds = jobs.map(({ id }) => id).filter((id) => id.endsWith("-merge"));
    expect(ciMergeJobs.map(({ id }) => id).sort()).toEqual(mergeIds.sort());
    const table = [
      ...ciVerdictStep().script.matchAll(
        /^\s*"([a-z-]+-merge)": \{ gate: "([a-z_]+)", package: "([^"]+)" \},?$/gm,
      ),
    ].map(([, id, gate, pkg]) => ({ id, gate, pkg }));
    const byId = (a, b) => a.id.localeCompare(b.id);
    expect(table.sort(byId)).toEqual([...ciMergeJobs].sort(byId));
    for (const { id } of table) expect(needsOf(job("ci").body)).toContain(id);
  });
});

// A stand-in for `gh`, first on PATH. Call n writes its arguments to args.n, prints out.n (or the
// latest out file before it) and exits with status.n (default 0). With GH_STUB_HOLD set, each call
// first creates held, waits for release (giving up after 1200 polls 50 ms apart), and creates
// finished as it ends.
const GH_STUB = `#!/usr/bin/env bash
if [ -n "\${GH_STUB_HOLD:-}" ]; then
  : > "$STUB_DIR/held"
  for ((i = 0; i < 1200; i++)); do
    [ -f "$STUB_DIR/release" ] && break
    /bin/sleep 0.05
  done
fi
n=$(( $(cat "$STUB_DIR/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$STUB_DIR/count"
printf '%s\n' "$@" > "$STUB_DIR/args.$n"
for ((i = n; i >= 1; i--)); do
  if [ -f "$STUB_DIR/out.$i" ]; then cat "$STUB_DIR/out.$i"; break; fi
done
if [ -n "\${GH_STUB_HOLD:-}" ]; then : > "$STUB_DIR/finished"; fi
exit "$(cat "$STUB_DIR/status.$n" 2>/dev/null || echo 0)"
`;

// A stand-in for `sleep`, first on PATH: it records each argument in sleeps and returns at once.
const SLEEP_STUB = `#!/usr/bin/env bash
echo "$1" >> "$STUB_DIR/sleeps"
`;
const STUBS = { gh: GH_STUB, sleep: SLEEP_STUB };

describe("the `ci` aggregate's jobs API cross-check", () => {
  // The stubs are built once; each run gets its own state directory, because a killed run's
  // leftover `gh` call still writes to the one it was given (the leftover-call case below).
  let root;
  let binDir;
  let lastStateDir;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "ci-jobs-api-"));
    binDir = join(root, "bin");
    mkdirSync(binDir);
    for (const [name, body] of Object.entries(STUBS)) {
      writeFileSync(join(binDir, name), body);
      chmodSync(join(binDir, name), 0o755);
    }
  });
  afterAll(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });

  // The page shape (`total_count`, `jobs`) and the job names (`test-heavy (1)`, `image / smoke`) are
  // as read with `gh api --paginate "repos/clintongormley/waitron/actions/runs/37435589194/attempts/1/jobs?per_page=100"`;
  // the never-acquired entry's shape (`cancelled`, `runner_id` 0) is run 37368759185 attempt 1's
  // `test-dashboard`. A stub whose shape is wrong makes the cases that serve pages pass against
  // a script that fails in CI.
  const apiJob = (name, conclusion, status = "completed") => ({
    name,
    status,
    conclusion: status === "completed" ? conclusion : null,
    runner_id: 1,
  });
  const page = (jobsOnPage, total = jobsOnPage.length) =>
    JSON.stringify({ total_count: total, jobs: jobsOnPage });
  const needsFor = (...ids) =>
    Object.fromEntries(ids.map((id) => [id, { result: "success", outputs: {} }]));

  /**
   * Call n of the stub answers `answers[n-1]`: a string to print, or `{ out, status }`. Runs with
   * three tries and no delay unless `defaults` is set.
   */
  function prepareCrossCheck(needs, answers, { defaults = false, holdGh = false } = {}) {
    const stateDir = mkdtempSync(join(root, "run-"));
    lastStateDir = stateDir;
    answers.forEach((answer, at) => {
      const { out, status } = typeof answer === "string" ? { out: answer, status: 0 } : answer;
      if (out !== undefined) writeFileSync(join(stateDir, `out.${at + 1}`), out);
      writeFileSync(join(stateDir, `status.${at + 1}`), String(status ?? 0));
    });
    const env = {
      PATH: `${binDir}:${process.env.PATH}`,
      STUB_DIR: stateDir,
      GH_TOKEN: "token",
      REPO: "o/r",
      RUN_ID: "123",
      RUN_ATTEMPT: "2",
      VERDICT_SCRIPT: ciJobsApiStep().script,
    };
    if (!defaults) Object.assign(env, { JOBS_API_TRIES: "3", JOBS_API_DELAY: "0" });
    if (holdGh) env.GH_STUB_HOLD = "1";
    if (needs !== undefined) env.NEEDS = typeof needs === "string" ? needs : JSON.stringify(needs);
    return { env, stateDir };
  }
  const CROSS_CHECK_COMMAND = ["-c", 'exec bash -e -c "$VERDICT_SCRIPT" 2>&1'];

  /**
   * Starts a run whose every `gh` call waits for `release`, for the case to kill. The run leads its
   * own process group, so the case can end the leftover subshell too however it exits.
   */
  function startHeldCrossCheck(needs, answers) {
    const { env, stateDir } = prepareCrossCheck(needs, answers, { holdGh: true });
    const child = spawn("bash", CROSS_CHECK_COMMAND, { env, stdio: "ignore", detached: true });
    const exited = new Promise((done) => child.once("exit", (code, signal) => done(signal)));
    return { child, exited, stateDir };
  }

  function runCrossCheck(needs, answers, options) {
    const { env, stateDir } = prepareCrossCheck(needs, answers, options);
    const result = spawnSync("bash", CROSS_CHECK_COMMAND, {
      encoding: "utf8",
      env,
      timeout: VERDICT_SPAWN_TIMEOUT_MS,
    });
    if (result.error !== undefined || result.status === null) {
      throw new Error(
        `the cross-check script failed to run (killed after ${VERDICT_SPAWN_TIMEOUT_MS}ms?): ${result.error?.message ?? result.signal}`,
      );
    }
    const calls = callsIn(stateDir);
    const sleeps = existsSync(join(stateDir, "sleeps"))
      ? readFileSync(join(stateDir, "sleeps"), "utf8").split("\n").filter(Boolean)
      : [];
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      calls,
      sleeps,
      stateDir,
    };
  }
  const callsIn = (dir) =>
    existsSync(join(dir, "count")) ? Number(readFileSync(join(dir, "count"), "utf8")) : 0;
  const argsOfCall = (n) =>
    readFileSync(join(lastStateDir, `args.${n}`), "utf8")
      .split("\n")
      .filter(Boolean);

  it("is wired to always run, read this run's jobs with a token allowed to, allow twelve minutes inside a fifteen-minute job, and keep its default tries", () => {
    const { keys, step } = ciJobsApiStep();
    expect(keys).toContain("        if: always()");
    expect(keys).toContain("        timeout-minutes: 12");
    expect(job("ci").body).toContain("    timeout-minutes: 15");
    for (const line of [
      "          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
      "          REPO: ${{ github.repository }}",
      "          RUN_ID: ${{ github.run_id }}",
      "          RUN_ATTEMPT: ${{ github.run_attempt }}",
      "          NEEDS: ${{ toJSON(needs) }}",
    ]) {
      expect(step).toContain(line);
    }
    expect(lines.filter((line) => /^\s*JOBS_API_\w+\s*:/.test(line))).toEqual([]);

    const body = job("ci").body;
    const permissionsAt = body.findIndex((line) => /^ {4}permissions:\s*$/.test(line));
    expect(permissionsAt).toBeGreaterThan(-1);
    const granted = [];
    for (const line of body.slice(permissionsAt + 1)) {
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      if (!/^ {6}\S/.test(line)) break;
      granted.push(line.trim());
    }
    expect(granted).toEqual(["actions: read"]);
  });

  it(
    "fails after twenty-one failed API calls, thirty seconds apart, with default settings",
    () => {
      const { status, output, calls, sleeps } = runCrossCheck(
        needsFor("lint"),
        Array.from({ length: 21 }, () => ({ status: 1 })),
        { defaults: true },
      );
      expect(status).not.toBe(0);
      expect(calls, output).toBe(21);
      expect(sleeps).toEqual(Array(20).fill("30"));
      expect(output).toContain("the jobs API call failed");
    },
    ONE_RUN_TEST_TIMEOUT_MS,
  );

  it(
    "accepts a needed job first marked completed at the last default poll, ten minutes later",
    () => {
      const { status, output, calls, sleeps } = runCrossCheck(
        needsFor("lint"),
        [
          ...Array(20).fill(page([apiJob("lint", null, "in_progress")])),
          page([apiJob("lint", "success")]),
        ],
        { defaults: true },
      );
      expect(status, output).toBe(0);
      expect(calls).toBe(21);
      expect(sleeps).toEqual(Array(20).fill("30"));
      expect(output).toContain("lint: success");
    },
    ONE_RUN_TEST_TIMEOUT_MS,
  );

  it(
    "fails after the default window when a needed job never becomes completed",
    () => {
      const { status, output, calls, sleeps } = runCrossCheck(
        needsFor("lint"),
        [page([apiJob("lint", null, "in_progress")])],
        { defaults: true },
      );
      expect(status).not.toBe(0);
      expect(calls, output).toBe(21);
      expect(sleeps).toEqual(Array(20).fill("30"));
      expect(output).toContain("not completed: lint");
    },
    ONE_RUN_TEST_TIMEOUT_MS,
  );

  it("matches only needed jobs that set no display `name:`, which the jobs API would report instead of the id", () => {
    const needs = needsOf(job("ci").body);
    expect(needs.length).toBeGreaterThan(0);
    const named = needs.filter((id) => job(id).body.some((line) => /^ {4}name:/.test(line)));
    expect(named).toEqual([]);
  });

  // A kill ends the script's shell, not the `$(gh …)` subshell it is waiting on, so a killed run
  // can still call `gh` after the next run has started. Receipt: docs/developers/testing-guide.md,
  // "A `spawnSync` timeout kills only the process it started".
  it(
    "keeps a killed run's leftover call out of the next run's count",
    async () => {
      const killed = startHeldCrossCheck(needsFor("lint"), [page([apiJob("lint", "success")])]);
      try {
        await waitUntil(
          () => existsSync(join(killed.stateDir, "held")),
          LEFTOVER_STEP_WAIT_MS,
          "the killed run's `gh` call to start",
        );
        killed.child.kill("SIGTERM");
        expect(
          await within(killed.exited, LEFTOVER_STEP_WAIT_MS, "the killed run to end"),
          "the signal that ended the killed run",
        ).toBe("SIGTERM");

        const next = runCrossCheck(needsFor("lint"), [page([apiJob("lint", "success")])]);
        expect(next.status, next.output).toBe(0);
        expect(next.calls).toBe(1);

        writeFileSync(join(killed.stateDir, "release"), "");
        await waitUntil(
          () => existsSync(join(killed.stateDir, "finished")),
          LEFTOVER_STEP_WAIT_MS,
          "the killed run's leftover `gh` call to finish",
        );
        expect(callsIn(next.stateDir), "calls the next run saw after the leftover call").toBe(1);
        expect(callsIn(killed.stateDir), "calls the killed run's leftover call made").toBe(1);
      } finally {
        writeFileSync(join(killed.stateDir, "release"), "");
        try {
          process.kill(-killed.child.pid, "SIGKILL");
        } catch {
          // The group has already ended.
        }
      }
    },
    LEFTOVER_CALL_TEST_TIMEOUT_MS,
  );

  it(
    "reads this run attempt's jobs, every page of them",
    () => {
      const { status, calls } = runCrossCheck(needsFor("lint"), [
        page([apiJob("lint", "success")]),
      ]);
      expect(status).toBe(0);
      expect(calls).toBe(1);
      const args = argsOfCall(1);
      expect(args).toContain("api");
      expect(args).toContain("--paginate");
      expect(args).toContain("repos/o/r/actions/runs/123/attempts/2/jobs?per_page=100");
    },
    ONE_RUN_TEST_TIMEOUT_MS,
  );

  it(
    "passes when every needed job succeeded or was skipped, printing each one",
    () => {
      const { status, output } = runCrossCheck(
        needsFor("lint", "test-heavy", "image", "bundle-smoke"),
        [
          page([
            apiJob("lint", "success"),
            apiJob("test-heavy (1)", "success"),
            apiJob("test-heavy (2)", "success"),
            apiJob("image / smoke", "success"),
            apiJob("bundle-smoke", "skipped"),
            apiJob("ci", null, "in_progress"),
          ]),
        ],
      );
      expect(status, output).toBe(0);
      expect(output.split("\n").filter(Boolean)).toEqual([
        "lint: success",
        "test-heavy (1): success",
        "test-heavy (2): success",
        "image / smoke: success",
        "bundle-smoke: skipped",
      ]);

      const skippedCaller = runCrossCheck(needsFor("image"), [page([apiJob("image", "skipped")])]);
      expect(skippedCaller.status, skippedCaller.output).toBe(0);
      expect(skippedCaller.output).toBe("image: skipped\n");
    },
    TWO_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "fails at once on a job GitHub never gave a runner, though `needs` says it succeeded",
    () => {
      const never = { name: "test-ui", status: "completed", conclusion: "cancelled", runner_id: 0 };
      const { status, output, calls } = runCrossCheck(needsFor("lint", "test-ui"), [
        page([apiJob("lint", "success"), never]),
      ]);
      expect(status).not.toBe(0);
      expect(calls).toBe(1);
      const printed = output.split("\n");
      const errorAt = printed.findIndex((line) =>
        line.includes("not succeeded or skipped: test-ui"),
      );
      expect(errorAt, output).toBeGreaterThan(-1);
      expect(printed.slice(0, errorAt), output).toEqual(["lint: success", "test-ui: cancelled"]);
    },
    ONE_RUN_TEST_TIMEOUT_MS,
  );

  it(
    "fails on any other completed conclusion, a missing one included",
    () => {
      for (const bad of ["failure", null, "neutral", "timed_out"]) {
        const { status, output, calls } = runCrossCheck(needsFor("lint"), [
          page([apiJob("lint", bad)]),
        ]);
        expect(status, String(bad)).not.toBe(0);
        expect(calls, String(bad)).toBe(1);
        expect(output, String(bad)).toContain("not succeeded or skipped: lint");
      }
    },
    FOUR_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "does not take a job whose name only starts with the needed id as that job",
    () => {
      const { status, output, calls } = runCrossCheck(needsFor("test-server"), [
        page([apiJob("test-server-stream", "success")]),
      ]);
      expect(status).not.toBe(0);
      expect(calls).toBe(3);
      expect(output).toContain("test-server: not in the jobs API");
      expect(output).toContain("no job in the jobs API for: test-server");
    },
    ONE_RUN_TEST_TIMEOUT_MS,
  );

  it(
    "combines every page, and retries until it has read as many jobs as the API counts",
    () => {
      const twoPages =
        page([apiJob("lint", "success")], 2) + "\n" + page([apiJob("typecheck", "success")], 2);
      const whole = runCrossCheck(needsFor("lint", "typecheck"), [twoPages]);
      expect(whole.status, whole.output).toBe(0);
      expect(whole.output).toBe("lint: success\ntypecheck: success\n");

      const short = runCrossCheck(needsFor("lint"), [page([apiJob("lint", "success")], 2)]);
      expect(short.status).not.toBe(0);
      expect(short.calls).toBe(3);
      expect(short.output).toContain("read 1 of 2 jobs");
    },
    TWO_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "fails when the API call fails on every try",
    () => {
      const failing = runCrossCheck(needsFor("lint"), [
        { status: 1 },
        { status: 1 },
        { status: 1 },
      ]);
      expect(failing.status).not.toBe(0);
      expect(failing.calls).toBe(3);
      expect(failing.output).toContain("the jobs API call failed");
    },
    ONE_RUN_TEST_TIMEOUT_MS,
  );

  it(
    "passes when the API call fails once and then succeeds",
    () => {
      const { status, output, calls } = runCrossCheck(needsFor("lint"), [
        { out: "", status: 1 },
        page([apiJob("lint", "success")]),
      ]);
      expect(status, output).toBe(0);
      expect(calls).toBe(2);
      expect(output).toContain("lint: success");
    },
    ONE_RUN_TEST_TIMEOUT_MS,
  );

  it(
    "waits for a needed job that has not completed, and fails if it never does",
    () => {
      const later = runCrossCheck(needsFor("lint"), [
        page([apiJob("lint", null, "in_progress")]),
        page([apiJob("lint", "success")]),
      ]);
      expect(later.status, later.output).toBe(0);
      expect(later.calls).toBe(2);

      const never = runCrossCheck(needsFor("lint"), [page([apiJob("lint", null, "in_progress")])]);
      expect(never.status).not.toBe(0);
      expect(never.calls).toBe(3);
      expect(never.output).toContain("lint: in_progress");
      expect(never.output).toContain("not completed: lint");
    },
    TWO_RUNS_TEST_TIMEOUT_MS,
  );

  it(
    "fails without calling the API when it was handed no needed jobs",
    () => {
      for (const needs of [undefined, "", "not json", "{}", "[]"]) {
        const { status, calls } = runCrossCheck(needs, [page([apiJob("lint", "success")])]);
        expect(status, String(needs)).not.toBe(0);
        expect(calls, String(needs)).toBe(0);
      }
    },
    FIVE_RUNS_TEST_TIMEOUT_MS,
  );
});

describe("the test shards", () => {
  // A case's `pnpm ls` calls run side by side; when the case ends, pass or fail, the ones still
  // running are killed.
  let pnpmCalls = new AbortController();
  afterEach(() => {
    pnpmCalls.abort();
    pnpmCalls = new AbortController();
  });

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

  // Nightly and by hand (owner, 2026-10-12). Weaker than its name: it reads mutation.yml as TEXT.
  it("runs mutation checks for ui, ui-core and db every night and by hand", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/mutation.yml"), "utf8");
    expect(workflowTriggers(workflow).sort()).toEqual(["schedule", "workflow_dispatch"]);
    const crons = [...workflow.matchAll(/^ {4}- cron: "([^"]*)"/gm)].map((match) => match[1]);
    expect(crons.length, "no cron line in mutation.yml").toBeGreaterThan(0);
    for (const cron of crons) expect(cron, "a cron that skips a day").toMatch(/^\d+ \d+ \* \* \*$/);
    // One job's text: from its `  <id>:` line to the next line at that indent (a job or its comment).
    const section = (id) => {
      const start = workflow.indexOf(`\n  ${id}:\n`);
      expect(start, `no \`${id}\` job in mutation.yml`).toBeGreaterThan(-1);
      const rest = workflow.slice(start + 1);
      const end = rest.slice(1).search(/\n {2}\S/);
      return end === -1 ? rest : rest.slice(0, end + 1);
    };
    const lines = (text) => text.split("\n").map((line) => line.trim());

    expect(workflow, "the unsharded `mutation` matrix is back").not.toContain("\n  mutation:\n");
    const uiCore = section("mutation-ui-core");
    expect(uiCore).toMatch(/shard: \[1(, \d+)*\]/);
    expect(uiCore).toContain("fail-fast: false");
    expect(uiCore).toContain("pnpm --filter @waitron/ui-core exec playwright install chromium");
    expect(lines(uiCore)).toContain(
      'FILES=$(node scripts/mutation-shard.mjs ui-core "$SHARD" "$TOTAL")',
    );
    expect(lines(uiCore)).toContain(
      'pnpm --filter @waitron/ui-core exec stryker run --mutate "$FILES"',
    );
    expect(uiCore).toContain("name: mutation-report-ui-core-shard-${{ matrix.shard }}");
    expect(uiCore).toContain("path: packages/ui-core/reports/mutation/");
    const uiCoreAggregate = section("mutation-ui-core-aggregate");
    expect(uiCoreAggregate).toContain("needs: mutation-ui-core");
    expect(uiCoreAggregate).toContain("if: always()");
    expect(uiCoreAggregate).toContain("pattern: mutation-report-ui-core-shard-*");

    const ui = section("mutation-ui");
    expect(ui).toMatch(/shard: \[1(, \d+)*\]/);
    expect(ui).toContain("fail-fast: false");
    expect(ui).toContain("pnpm --filter @waitron/ui exec playwright install chromium");
    expect(lines(ui)).toContain('FILES=$(node scripts/mutation-shard.mjs ui "$SHARD" "$TOTAL")');
    expect(lines(ui)).toContain('pnpm --filter @waitron/ui exec stryker run --mutate "$FILES"');
    expect(ui).toContain("name: mutation-report-ui-shard-${{ matrix.shard }}");
    expect(ui).toContain("path: packages/ui/reports/mutation/");

    const aggregate = section("mutation-ui-aggregate");
    expect(aggregate).toContain("needs: mutation-ui");
    expect(aggregate).toContain("if: always()");
    expect(aggregate).toContain("pattern: mutation-report-ui-shard-*");

    const db = section("mutation-db");
    expect(db).toMatch(/shard: \[1(, \d+)*\]/);
    expect(db).toContain("fail-fast: false");
    expect(lines(db)).toContain('FILES=$(node scripts/mutation-shard.mjs db "$SHARD" "$TOTAL")');
    expect(lines(db)).toContain('pnpm --filter @waitron/db exec stryker run --mutate "$FILES"');
    expect(db).toContain("name: mutation-report-db-shard-${{ matrix.shard }}");
    expect(db).toContain("path: packages/db/reports/mutation/");
    const dbAggregate = section("mutation-db-aggregate");
    expect(dbAggregate).toContain("needs: mutation-db");
    expect(dbAggregate).toContain("if: always()");
    expect(dbAggregate).toContain("pattern: mutation-report-db-shard-*");
  });

  it("isolates Provisioning into six coverage shards and enforces the merged result", () => {
    const name = "@waitron/provisioning";
    expect(OWN_SHARD_PACKAGES).toContain(name);
    expect(LIGHT_A_PACKAGES).not.toContain(name);
    expect(LIGHT_B_PACKAGES).not.toContain(name);
    const body = job("test-provisioning").body.join("\n");
    expect(body).toContain("shard: [1, 2, 3, 4, 5, 6]");
    expect(body).toContain("fail-fast: false");
    expect(body).toContain('pnpm --filter "@waitron/provisioning" test:shard');
    expect(job("test-provisioning-merge").body.join("\n")).toContain(
      'pnpm --filter "@waitron/provisioning" test:merge',
    );
    expect(job("ci").body.join("\n")).toContain("- test-provisioning-merge");
  });

  it("isolates Bookings from the light bins", () => {
    const name = "@waitron/bookings";
    expect(OWN_SHARD_PACKAGES).toContain(name);
    expect(LIGHT_A_PACKAGES).not.toContain(name);
    expect(LIGHT_B_PACKAGES).not.toContain(name);
  });

  // The owner's bound (2026-10-09): no test job should run past about four minutes. These limits
  // sit above that so a slow runner is not cut off, and well below GitHub's six hours.
  it("bounds every test job at ten minutes, every merge job at five, and lint and the root guards at eight", () => {
    const minutesOf = (body) => Number(/^ {4}timeout-minutes: (\d+)$/m.exec(body.join("\n"))?.[1]);
    const testJobs = jobs.filter(({ id }) => id.startsWith("test-"));
    expect(testJobs.length).toBeGreaterThan(0);
    for (const { id, body } of testJobs) {
      expect(minutesOf(body), id).toBe(id.endsWith("-merge") ? 5 : 10);
    }
    for (const id of ["lint", "root-guards"]) expect(minutesOf(job(id).body), id).toBe(8);
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
    async () => {
      const declaring = membersDeclaringTests();
      expect(declaring.length).toBeGreaterThan(0);

      const selected = await Promise.all(
        shards.map((shard) => selects(shard.filters, pnpmCalls.signal)),
      );
      const runs = new Map();
      shards.forEach((shard, at) => {
        for (const name of selected[at]) {
          runs.set(name, [...(runs.get(name) ?? []), shard.id]);
        }
      });

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
    async () => {
      // Every shard is checked before any lookup starts: a lookup already running when a later
      // check throws is aborted by `afterEach` with nothing to receive its refusal.
      const dedicated = OWN_SHARD_PACKAGES.map((name) => {
        const found = shards.filter((shard) => shard.filters.includes(name));
        expect(found, name).toHaveLength(1);
        return found[0];
      });
      const answers = await Promise.all(
        dedicated.map((shard) => selects(shard.filters, pnpmCalls.signal)),
      );
      OWN_SHARD_PACKAGES.forEach((name, at) => {
        expect(answers[at]).toEqual(
          name === "@waitron/ui" || name === "@waitron/ui-core"
            ? ["@waitron/ui", "@waitron/ui-core"]
            : [name],
        );
      });
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );

  it("print each test file's progress, keeping the default reporter beside it", () => {
    const progress = '--reporter="$GITHUB_WORKSPACE/scripts/vitest-file-progress.mjs"';
    expect(existsSync(join(repoRoot, "scripts", "vitest-file-progress.mjs"))).toBe(true);

    const streamStep = job(STREAM_JOB).body;
    const steps = [
      ...jobs.map(({ id, body }) => ({ id, step: shardStep(body) })),
      {
        id: STREAM_JOB,
        step: streamStep.slice(
          streamStep.findIndex((l) =>
            /- name: Run the tests that need Litestream or versitygw$/.test(l),
          ),
        ),
      },
    ].filter(({ step }) => step !== undefined);

    const commands = [];
    for (const { id, step } of steps) {
      const logical = step
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n")
        .replace(/\\\n\s*/g, " ")
        .split("\n")
        .map((line) => line.trim());
      for (const command of logical) {
        // The selection guard (`pnpm … ls | node … runnable test:coverage`) runs no tests.
        if (command.includes(" runnable ")) continue;
        const script = /^pnpm .*\b(test:coverage|test:shard)\b/.exec(command)?.[1];
        if (script !== undefined) commands.push({ id, script, command });
      }
    }

    // Every shard job, and the stream step, runs exactly one test command.
    expect(commands.map(({ id }) => id).sort()).toEqual(steps.map(({ id }) => id).sort());
    for (const { id, script, command } of commands) {
      expect(command, id).toContain(progress);
      // test:coverage passes no reporter of its own, so a lone --reporter would REPLACE the
      // default one; test:shard's script already names it.
      if (script === "test:coverage") expect(command, id).toContain("--reporter=default");
    }
  });
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
  // A pull request runs the image smoke only when an image input changed; a push to `main` still
  // smokes on `code` alone, because `publish` ships the image off this smoke passing.
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
      name: "a PR that changes no image input skips",
      ctx: { event_name: "pull_request", code: "true", deploy: "false" },
      run: false,
    },
    {
      name: "a PR that changes an image input runs",
      ctx: { event_name: "pull_request", code: "true", deploy: "true" },
      run: true,
    },
    // scripts/fake-bluez.py alone: root scope, so `code=false`, and still an image input.
    {
      name: "a PR that changes only a root-scope image input runs",
      ctx: { event_name: "pull_request", code: "false", deploy: "true" },
      run: true,
    },
    {
      name: "a push that changes only a root-scope image input runs",
      ctx: { event_name: "push", code: "false", deploy: "true" },
      run: true,
    },
    {
      name: "a docs-only PR skips",
      ctx: { event_name: "pull_request", code: "false", deploy: "false" },
      run: false,
    },
    {
      name: "a code push to main runs even without an image input",
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
  it.each([
    ["||", "&&"],
    ["&&", "||"],
  ])("would catch the %s being flipped to %s", (from, to) => {
    const real = imageIf();
    const mutated = real.replace(from, to);
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

  // No shard job checks that its package has a test:shard script to run, so a shard that ran
  // nothing writes no blob and only a failing upload turns it red.
  it("fail a shard whose blob upload finds no file", () => {
    for (const shard of shardedJobs) {
      const step = artifactUploadStep(shard.body);
      expect(step, `${shard.id} uploads no matrix-named blob artifact`).toBeDefined();
      expect(
        step.map((line) => line.trim()),
        shard.id,
      ).toContain("if-no-files-found: error");
    }
  });

  it("gate every merge job on `code` plus exactly one scope gate", () => {
    for (const merge of mergeJobs) expectGatedOnCodePlusOneScope(gatesRead(merge.body));
  });

  // A shard given no files exits 1 ("No test files found"). Weaker than its name: it counts files
  // named `*.test.ts` under the package, not what the package's Vitest config includes.
  it(
    "run no more shards than the package has test files",
    () => {
      const paths = new Map(workspaceListing().map((pkg) => [pkg.name, pkg.path]));
      const testFiles = (dir) =>
        readdirSync(dir, { withFileTypes: true })
          .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
          .reduce(
            (count, entry) =>
              count +
              (entry.isDirectory()
                ? testFiles(join(dir, entry.name))
                : Number(entry.isFile() && entry.name.endsWith(".test.ts"))),
            0,
          );
      for (const { id, body, pkg } of shardedJobs) {
        expect(shardDenominator(body), id).toBeLessThanOrEqual(testFiles(paths.get(pkg)));
      }
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );

  it("pin each sharded package's shard count", () => {
    const counts = Object.fromEntries(
      shardedJobs.map(({ pkg, body }) => [pkg, shardDenominator(body)]),
    );
    expect(counts).toEqual({
      "@waitron/dashboard": 4,
      "@waitron/db": 3,
      "@waitron/provisioning": 6,
      "@waitron/server": 11,
      "@waitron/venue-service": 4,
      "@waitron/till": 7,
    });
  });

  // `--merge-reports` runs no test, so a merge job installing a browser would pay for nothing.
  it("install no browser in a merge job", () => {
    for (const merge of mergeJobs) {
      expect(merge.body.join("\n"), merge.id).not.toContain("playwright install");
    }
  });
});

describe("the lint and root-guards jobs", () => {
  // The repo-level project runs in a job of its own so its time runs beside lint's rather than
  // inside it.
  it("run the repo-level Vitest project only in root-guards, which nothing gates", () => {
    const runsRoot = (body) =>
      body.some((line) => !line.trim().startsWith("#") && /pnpm vitest run --coverage/.test(line));
    expect(jobs.filter(({ body }) => runsRoot(body)).map(({ id }) => id)).toEqual(["root-guards"]);
    for (const id of ["lint", "root-guards"]) {
      expect(
        job(id).body.some((line) => /^ {4}(if|needs):/.test(line)),
        id,
      ).toBe(false);
    }
  });

  it("leave lint running exactly lint and the format check", () => {
    const runs = job("lint")
      .body.map((line) => /^ {6}- run: (.*)$/.exec(line)?.[1])
      .filter((run) => run !== undefined);
    expect(runs).toEqual(["pnpm install --frozen-lockfile", "pnpm lint", "pnpm format:check"]);
  });
});

/**
 * Holds that the step running a job's `test:shard` line has an `env:` key of its own, before its
 * `run:` key, setting TMPDIR to the in-memory /dev/shm. Reads the job's lines as TEXT.
 */
function expectTestShardStepTmpdirInMemory(body, what) {
  const run = body.findIndex((line) => !line.trim().startsWith("#") && line.includes("test:shard"));
  const stepStart = body.findLastIndex((line, at) => at < run && /^ {6}- /.test(line));
  expect(stepStart, `no step runs ${what}`).toBeGreaterThan(-1);
  const runKey = body.findIndex((line, at) => at > stepStart && /^ {8}run:/.test(line));
  expect(
    runKey,
    "the step's own run: key must come at or before its test:shard line",
  ).toBeGreaterThan(stepStart);
  expect(
    runKey,
    "the step's own run: key must come at or before its test:shard line",
  ).toBeLessThanOrEqual(run);
  const keys = body.slice(stepStart, runKey);
  const env = keys.findIndex((line) => /^ {8}env:\s*$/.test(line));
  expect(env, "the step needs an env: key of its own, before its run: key").toBeGreaterThan(-1);
  const after = keys.slice(env + 1);
  const end = after.findIndex((line) => !/^ {10}/.test(line));
  const mapping = end === -1 ? after : after.slice(0, end);
  expect(mapping, "the step's env: must set TMPDIR to the in-memory /dev/shm").toContain(
    "          TMPDIR: /dev/shm",
  );
}

/**
 * Each venue-service shard keeps its test databases (made by `useVenueDb` under `os.tmpdir()`) in
 * memory; why: ci-and-gates.md, "The venue-service shards keep their test databases in memory".
 * Read from ci.yml as TEXT, so a step an `if:` switches off, or a `run:` that sets TMPDIR again,
 * still passes.
 */
describe("the venue-service shards' test databases", () => {
  it("live in memory, not on the runner's disk", () => {
    expectTestShardStepTmpdirInMemory(job("test-venue-service").body, "the venue-service shard");
  });
});

/**
 * A venue-service shard whose browser never starts leaves a record of each start-up step; why:
 * ci-and-gates.md, "A failed venue-service shard keeps its browser start-up record". Reads ci.yml
 * as TEXT: it never runs a shard, so it cannot tell that the channels still print anything.
 */
describe("the venue-service shards' browser start-up record", () => {
  const body = job("test-venue-service").body.filter((line) => !line.trim().startsWith("#"));
  const step = shardStep(body) ?? [];
  const record = '"$RUNNER_TEMP/shard-diagnostics/shard.log"';

  it("turns on Vitest's browser channels and Playwright's browser log for the shard", () => {
    expect(step.length, "no venue-service shard step").toBeGreaterThan(0);
    const debug = step.map((line) => /^ {10}DEBUG: "?([^"]*)"?\s*$/.exec(line)?.[1]).find(Boolean);
    expect(debug?.split(",").sort()).toEqual([
      "pw:browser",
      "vitest:browser:api",
      "vitest:browser:playwright",
      "vitest:browser:pool",
    ]);
    expect(step).toContain('          VITEST_PW_DEBUG: "1"');
  });

  it("writes the shard's whole output to the record", () => {
    expect(step.join("\n")).toContain(`2>&1 | tee ${record}`);
  });

  it("does not fail a passing shard whose log the filter leaves empty", () => {
    expect(step).toContain("          set -euo pipefail");
    expect(step.join("\n")).toMatch(
      /\| \{ grep -v --line-buffered '[^']*' \|\| \[ \$\? -eq 1 \]; \}\s*$/,
    );
  });

  it("samples the runner's memory and processes into the same folder", () => {
    const sampler = body.findIndex((line) => /^ {6}- name: Sample the runner/.test(line));
    const shard = body.findIndex((line) => /^ {6}- name: Run the .* shard\s*$/.test(line));
    expect(sampler, "no sampler step").toBeGreaterThan(-1);
    expect(sampler, "the sampler must start before the shard").toBeLessThan(shard);
    expect(body.slice(sampler, shard).join("\n")).toContain(
      '"$RUNNER_TEMP/shard-diagnostics/resources.log"',
    );
  });

  it("snapshots the runner and keeps the folder when the shard fails or is cancelled, and only then", () => {
    const named = body.findIndex((line) =>
      /^ {10}name: venue-service-diagnostics-\$\{\{\s*matrix\.shard\s*\}\}\s*$/.test(line),
    );
    expect(named, "no diagnostics artifact").toBeGreaterThan(-1);
    const start = body.findLastIndex((line, at) => at < named && /^ {6}- /.test(line));
    const upload = body.slice(start, named + 3);
    expect(upload).toContain("        if: failure() || cancelled()");
    const snapshot = body.findIndex((line) => /^ {6}- name: Snapshot the runner/.test(line));
    expect(snapshot, "no snapshot step").toBeGreaterThan(-1);
    expect(body[snapshot + 1]).toBe("        if: failure() || cancelled()");
    expect(upload.join("\n")).toContain("actions/upload-artifact@");
    expect(upload).toContain("          path: ${{ runner.temp }}/shard-diagnostics/");
  });
});

/**
 * The tests that need Litestream or versitygw (`STREAM_TEST_FILES`) run in a job of their own,
 * beside the apps/server shards: between them they need two downloaded binaries. Their blob joins
 * the server's coverage merge. Read from ci.yml as TEXT, so a step an `if:` switches off still
 * passes.
 */
describe("the job of the tests that need Litestream or versitygw", () => {
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

  it("runs them with their temporary files in memory, not on the runner's disk", () => {
    expectTestShardStepTmpdirInMemory(stream().body, "the stream tests");
  });

  it("gives loopback a 1500-byte packet size before it runs them", () => {
    const body = stream().body;
    const code = (line) => !line.trim().startsWith("#");
    const run = body.findIndex((line) => code(line) && line.includes("test:shard"));
    const mtu = body.findIndex(
      (line) => code(line) && /^\s*(run:\s*)?sudo ip link set dev lo mtu 1500\s*$/.test(line),
    );
    expect(mtu, "no step runs `sudo ip link set dev lo mtu 1500`").toBeGreaterThan(-1);
    expect(mtu, "loopback's packet size must be set before the tests run").toBeLessThan(run);
  });

  it("is the only job that installs the binaries", () => {
    for (const { id, body } of jobs.filter(({ id }) => id !== STREAM_JOB)) {
      const code = body.filter((line) => !line.trim().startsWith("#")).join("\n");
      for (const installer of STREAM_BINARY_INSTALLERS) expect(code, id).not.toContain(installer);
    }
  });

  it("takes those files out of every apps/server shard", () => {
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

  it("share one test:shard across every sharded package", () => {
    // They are hand-copied across packages.
    expect(new Set(shardedPackages.map((pkg) => scripts.get(pkg)?.["test:shard"])).size).toBe(1);
  });

  it("merge a browser-mode package's blobs through the shard coverage merge, and the rest through plain v8", () => {
    // A browser package's plain merge reads coverage LOWER than an unsharded run: see
    // scripts/vitest-shard-coverage-merge.mjs.
    const plain = "vitest --merge-reports .vitest-reports --coverage";
    const browser = `${plain} --coverage.provider=custom --coverage.customProviderModule=../../scripts/vitest-shard-coverage-merge.mjs`;
    const browserMode = new Set(browserPackages());
    const expected = new Map(
      shardedPackages.map((pkg) => [pkg, browserMode.has(pkg) ? browser : plain]),
    );

    expect(new Map(shardedPackages.map((pkg) => [pkg, scripts.get(pkg)?.["test:merge"]]))).toEqual(
      expected,
    );
    expect([...expected.values()]).toContain(browser);
    expect([...expected.values()]).toContain(plain);
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

/** The ids of one workflow's jobs that run with the repository's default token permissions. */
function jobsWithoutPermissions(text) {
  const workflowLines = text.split("\n");
  if (workflowLines.some((line) => /^permissions:/.test(line))) return [];
  const jobsKey = workflowLines.indexOf("jobs:");
  if (jobsKey === -1) throw new Error("workflow has no top-level `jobs:` key");
  const uncovered = [];
  let current;
  for (const line of workflowLines.slice(jobsKey + 1)) {
    const id = /^ {2}([^\s#][^:]*):/.exec(line)?.[1];
    if (id !== undefined) {
      if (current !== undefined && !current.covered) uncovered.push(current.id);
      current = { id, covered: false };
    } else if (current !== undefined && /^ {4}permissions:/.test(line)) {
      current.covered = true;
    }
  }
  if (current === undefined) throw new Error("workflow has no jobs under `jobs:`");
  if (!current.covered) uncovered.push(current.id);
  return uncovered;
}

/** The ids of one workflow's jobs that run without a positive whole-number `timeout-minutes`. */
function jobsWithoutTimeout(text) {
  const workflowLines = text.split("\n");
  const jobsKey = workflowLines.indexOf("jobs:");
  if (jobsKey === -1) throw new Error("workflow has no top-level `jobs:` key");
  const unbounded = [];
  let current;
  const close = () => {
    if (current !== undefined && !current.bounded && !current.callsWorkflow)
      unbounded.push(current.id);
  };
  for (const line of workflowLines.slice(jobsKey + 1)) {
    const id = /^ {2}([^\s#][^:]*):/.exec(line)?.[1];
    if (id !== undefined) {
      close();
      current = { id, bounded: false, callsWorkflow: false };
    } else if (current !== undefined) {
      if (/^ {4}timeout-minutes: [1-9]\d*\s*(#.*)?$/.test(line)) current.bounded = true;
      if (/^ {4}uses:/.test(line)) current.callsWorkflow = true;
    }
  }
  if (current === undefined) throw new Error("workflow has no jobs under `jobs:`");
  close();
  return unbounded;
}

/**
 * A one-line YAML value with its quotes taken off: `'…'` with `''` read as `'`, and `"…"` with `\n`
 * and `\t` decoded and any other backslash dropped before the character it escapes. Any other
 * value, a quoted one left open on its line included, comes back as it is.
 */
function unquoted(value) {
  const single = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(value);
  if (single !== null) return single[1].replaceAll("''", "'");
  const double = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(value);
  if (double === null) return value;
  return double[1].replace(/\\(.)/g, (_, char) => ({ n: "\n", t: "\t" })[char] ?? char);
}

/**
 * Each step under a `steps:` key, with its `name:`, its `timeout-minutes:` value as written, and the
 * first line, unquoted, or `|`/`>` block of its `run:`, shell comments cut. Also its `id:`, `uses:`,
 * `if:` and `continue-on-error:` values, unquoted (`undefined` when absent), and its `env:` and
 * `with:` blocks as objects of the unquoted `key: value` lines one indent deeper (`{}` when absent).
 */
function workflowSteps(text) {
  const workflowLines = text.split("\n");
  const indentOf = (line) => line.search(/\S/);
  const isContent = (line) => line.trim() !== "" && !/^\s*#/.test(line);
  const steps = [];
  workflowLines.forEach((line, index) => {
    if (!/^\s*steps:\s*(#.*)?$/.test(line)) return;
    const first = workflowLines.slice(index + 1).find(isContent);
    if (first === undefined || !/^\s*- /.test(first)) return;
    const dash = indentOf(first);
    let step;
    let blockIndent;
    for (let at = index + 1; at < workflowLines.length; at += 1) {
      const current = workflowLines[at];
      if (blockIndent !== undefined) {
        if (!isContent(current) || indentOf(current) > blockIndent) {
          step.run.push(current);
          continue;
        }
        blockIndent = undefined;
      }
      if (!isContent(current)) continue;
      const indent = indentOf(current);
      if (indent < dash || (indent === dash && !/^\s*- /.test(current))) break;
      if (indent === dash) {
        const keyIndent = dash + 1 + current.slice(dash + 1).search(/\S/);
        step = { line: at + 1, name: undefined, run: [], keyIndent, env: {}, with: {} };
        steps.push(step);
      } else if (indent !== step.keyIndent) {
        if (step.mapping === undefined) continue;
        step.mapping.indent ??= indent;
        if (indent !== step.mapping.indent) continue;
        const [, mapKey, mapValue] = /^([\w.-]+):\s*(.*)$/.exec(current.trim()) ?? [];
        if (mapKey !== undefined) step[step.mapping.key][mapKey] = unquoted(mapValue.trim());
        continue;
      }
      step.mapping = undefined;
      const [, key, value] = /^([\w-]+):\s*(.*)$/.exec(current.slice(step.keyIndent)) ?? [];
      if (key === "name") step.name = value.trim();
      if (key === "timeout-minutes") step.timeoutMinutes = value.trim();
      if (key === "id") step.id = unquoted(value.trim());
      if (key === "uses") step.uses = unquoted(value.trim());
      if (key === "if") step.if = unquoted(value.trim());
      if (key === "continue-on-error") step.continueOnError = unquoted(value.trim());
      if ((key === "env" || key === "with") && /^(#.*)?$/.test(value.trim()))
        step.mapping = { key, indent: undefined };
      if (key !== "run") continue;
      if (/^[|>][-+\d]*\s*(#.*)?$/.test(value)) blockIndent = step.keyIndent;
      else step.run.push(unquoted(value));
    }
  });
  return steps.map(({ line, name, run, timeoutMinutes, ...settings }) => ({
    step: name ?? `the step at line ${line}`,
    timeoutMinutes,
    id: settings.id,
    uses: settings.uses,
    if: settings.if,
    continueOnError: settings.continueOnError,
    env: settings.env,
    with: settings.with,
    command: run
      .filter((runLine) => !/^\s*#/.test(runLine))
      .map((runLine) => runLine.replace(/\s#.*$/, ""))
      .join("\n"),
  }));
}

/** An `apt` or `apt-get` command running `word`, options before it included. */
const apt = (word, flags = "") =>
  new RegExp(`\\bapt(?:-get)?(?:\\s+(?:-[oc]\\s+\\S+|-\\S+))*\\s+${word}\\b`, flags);

/** The steps whose `run:` command installs with apt, and whether it updates the package list first. */
function aptInstallSteps(text) {
  return workflowSteps(text).flatMap(({ step, command }) => {
    const install = apt("install").exec(command);
    if (install === null) return [];
    return [{ step, updatesFirst: apt("update").test(command.slice(0, install.index)) }];
  });
}

/**
 * Every `apt update`, `apt install`, `apt-get update` or `apt-get install` in a step's `run:`
 * command, and whether it is bounded: run under `timeout <n>` on its own line (`sudo` allowed
 * before `timeout` and between it and the apt word) and carrying both
 * `-o Acquire::http::Timeout=<n>` and `-o Acquire::https::Timeout=<n>` before the word.
 */
function aptWaits(text) {
  const aptWait = apt("(?:update|install)", "g");
  const outerLimit = /(?:^|[\s;&|(!])(?:sudo\s+)?timeout\s+\d+\s+(?:sudo\s+)?$/;
  return workflowSteps(text).flatMap(({ step, command }) =>
    command.split("\n").flatMap((line) =>
      [...line.matchAll(aptWait)].map((found) => ({
        step,
        command: found[0],
        bounded:
          outerLimit.test(line.slice(0, found.index)) &&
          /-o\s+Acquire::http::Timeout=\d+\b/.test(found[0]) &&
          /-o\s+Acquire::https::Timeout=\d+\b/.test(found[0]),
      })),
    ),
  );
}

/**
 * Every `--with-deps` in a step's `run:` command, which makes Playwright run apt-get itself, and
 * whether the command it belongs to runs under `timeout <n>` on the same line (`if`, `!` and `sudo`
 * allowed before `timeout`; a `;`, `&&`, `|`, `(` or a `&` that is not part of `&&`, `>&`, `<&`
 * or `&>` between them starts another command).
 */
function withDepsWaits(text) {
  const limited = /^\s*(?:if\s+|!\s*)?(?:sudo\s+)?timeout\s+\d+\s/;
  return workflowSteps(text).flatMap(({ step, command }) =>
    command.split("\n").flatMap((line) =>
      [...line.matchAll(/--with-deps\b/g)].map((found) => ({
        step,
        bounded: limited.test(
          line
            .slice(0, found.index)
            .split(/;|&&|\|\||\||(?<![<>&])&(?![&>])|\(/)
            .at(-1),
        ),
      })),
    ),
  );
}

const workflowsDir = join(repoRoot, ".github", "workflows");
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();

describe("the workflow step reader", () => {
  it("reads a step's id, condition, action, settings, environment and inputs", () => {
    const text =
      "on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n" +
      "      - id: checkout\n" +
      "        name: Check out\n" +
      '        uses: "actions/checkout@v7"\n' +
      "        if: steps.x.outcome == 'failure'\n" +
      "        timeout-minutes: 2\n" +
      "        continue-on-error: true\n" +
      "        env:\n" +
      "          # a comment\n" +
      "          GIT_HTTP_LOW_SPEED_LIMIT: 1000\n" +
      "\n" +
      "          GIT_HTTP_LOW_SPEED_TIME: '20'\n" +
      "        with:\n" +
      "          fetch-depth: 0\n" +
      "      - name: plain\n" +
      "        run: echo hi\n";
    expect(workflowSteps(text)).toEqual([
      {
        step: "Check out",
        timeoutMinutes: "2",
        command: "",
        id: "checkout",
        uses: "actions/checkout@v7",
        if: "steps.x.outcome == 'failure'",
        continueOnError: "true",
        env: { GIT_HTTP_LOW_SPEED_LIMIT: "1000", GIT_HTTP_LOW_SPEED_TIME: "20" },
        with: { "fetch-depth": "0" },
      },
      {
        step: "plain",
        timeoutMinutes: undefined,
        command: "echo hi",
        id: undefined,
        uses: undefined,
        if: undefined,
        continueOnError: undefined,
        env: {},
        with: {},
      },
    ]);
  });
});

/**
 * Every job runs under a `permissions:` block of its own or its workflow's, never the repository's
 * default token permissions. It reads each workflow as TEXT, by indent: a job is any two-space key
 * after the `jobs:` line, and only a `permissions:` key at four-space indent covers it. So a job
 * written in flow style on one line is reported even when it names permissions, and any top-level
 * `permissions:` value, `write-all` included, counts as covering every job.
 */
describe("the workflows' token permissions", () => {
  it("reads a top-level block as covering every job, and a job's own block as covering it", () => {
    const shape = (top) =>
      `name: x\n${top}on: push\njobs:\n  a:\n    permissions:\n      contents: read\n    runs-on: x\n  b:\n    runs-on: x\n    steps:\n      - run: echo permissions:\n`;
    expect(jobsWithoutPermissions(shape(""))).toEqual(["b"]);
    expect(jobsWithoutPermissions(shape("permissions:\n  contents: read\n"))).toEqual([]);
  });

  it.each([
    ["  b: # comment", "b"],
    ['  "b":', '"b"'],
    ["  b: {runs-on: x}", "b"],
    ["  b: *j", "b"],
  ])("reads %j after a covered job as a job of its own", (jobLine, id) => {
    const covered = "  a:\n    permissions:\n      contents: read\n    runs-on: x\n";
    const text = `on: push\njobs:\n${covered}${jobLine}\n    runs-on: x\n`;
    expect(jobsWithoutPermissions(text)).toEqual([id]);
  });

  it("reads a first job whose line carries a comment", () => {
    const text =
      "on: push\njobs:\n  b: # comment\n    runs-on: x\n  a:\n    permissions:\n      contents: read\n";
    expect(jobsWithoutPermissions(text)).toEqual(["b"]);
  });

  it("reports a one-line flow-style job even when it names permissions", () => {
    const text = "on: push\njobs:\n  b: {permissions: {contents: read}, runs-on: x}\n";
    expect(jobsWithoutPermissions(text)).toEqual(["b"]);
  });

  it("were found", () => {
    expect(workflowFiles).toContain("ci.yml");
  });

  it("never leave a job on the repository's default token permissions", () => {
    const uncovered = workflowFiles.flatMap((name) =>
      jobsWithoutPermissions(readFileSync(join(workflowsDir, name), "utf8")).map(
        (job) => `${name}: ${job}`,
      ),
    );
    expect(
      uncovered,
      "give the workflow a top-level `permissions:` block (contents: read), or the job its own",
    ).toEqual([]);
  });
});

/**
 * Every job carries its own `timeout-minutes`; without one GitHub cancels it only after 360 minutes
 * (github/docs workflow-syntax.md, `jobs.<job_id>.timeout-minutes`: "Default: 360"). A job that
 * calls a reusable workflow is exempt: `timeout-minutes` is not among the keywords
 * reusing-workflow-configurations.md (main 7b807926d, read 2026-10-08) allows in "the job
 * containing the call"; a called workflow in this repository's .github/workflows/ is read here like
 * any other, and one in another repository is not read at all.
 * Weaker than its name: it reads TEXT by indent, so a flow-style job, or a `timeout-minutes`
 * written as an expression, is reported as unbounded, and it does not judge whether the number is
 * a sensible one.
 */
describe("the workflows' job time limits", () => {
  const workflow = (jobs) => `on: push\njobs:\n${jobs}`;

  it("passes a job with a limit and reports one without", () => {
    expect(jobsWithoutTimeout(workflow("  a:\n    runs-on: x\n    timeout-minutes: 5\n"))).toEqual(
      [],
    );
    expect(jobsWithoutTimeout(workflow("  a:\n    runs-on: x\n    steps: []\n"))).toEqual(["a"]);
  });

  it("does not count a step's own limit as the job's", () => {
    const text = workflow(
      "  a:\n    runs-on: x\n    steps:\n      - run: echo\n        timeout-minutes: 5\n",
    );
    expect(jobsWithoutTimeout(text)).toEqual(["a"]);
  });

  it("reports a one-line flow-style job even when it names a limit", () => {
    expect(jobsWithoutTimeout(workflow("  a: {runs-on: x, timeout-minutes: 5}\n"))).toEqual(["a"]);
  });

  it("passes a limit when its line and the job's line carry a comment", () => {
    expect(
      jobsWithoutTimeout(workflow("  a: # note\n    runs-on: x\n    timeout-minutes: 5 # why\n")),
    ).toEqual([]);
  });

  it("passes a job that calls a reusable workflow", () => {
    const text = workflow("  a:\n    uses: ./.github/workflows/other.yml\n    secrets: inherit\n");
    expect(jobsWithoutTimeout(text)).toEqual([]);
  });

  it.each([["0"], ["2.5"], ["${{ inputs.minutes }}"], ["-5"]])("reports a limit of %j", (value) => {
    const text = workflow(`  a:\n    runs-on: x\n    timeout-minutes: ${value}\n`);
    expect(jobsWithoutTimeout(text)).toEqual(["a"]);
  });

  it("give every job a time limit", () => {
    const unbounded = workflowFiles.flatMap((name) =>
      jobsWithoutTimeout(readFileSync(join(workflowsDir, name), "utf8")).map(
        (job) => `${name}: ${job}`,
      ),
    );
    expect(
      unbounded,
      "give each job `timeout-minutes:` at four-space indent, set from its measured durations",
    ).toEqual([]);
  });
});

/**
 * A step that runs `apt install` or `apt-get install` runs `apt update` or `apt-get update` earlier
 * in its own `run:` command: the runner's baked-in package list can name a file the archive no
 * longer serves. It reads each workflow as TEXT, by indent: a step is a `- ` item under a `steps:`
 * key, its command is the first line of its own `run:` value, unquoted, or the indented block
 * under a `run: |` or `run: >`, and a shell comment is cut from a full-line `#` or a
 * whitespace-led ` #` to the end of the line, inside quotes too. An install it does not read
 * passes, among them one after a quoted ` #` on its line, on the second line of a `run:` value that
 * is neither `|` nor `>`, after an option whose value is a separate word (`-t noble-backports`), in
 * a step written in flow style (`- {run: …}`), in a composite or Docker action, in a script the
 * step calls, in a command built from a variable, and in one a tool runs itself
 * (`playwright install --with-deps`).
 * Any `apt update` or `apt-get update` text before the install counts, whether or not it runs.
 */
describe("the workflows' apt installs", () => {
  const workflow = (steps) => `on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n${steps}`;

  it("reports an install with no update before it", () => {
    const text = workflow(
      "      - name: deps\n        run: |\n          sudo apt-get install -y bluez\n",
    );
    expect(aptInstallSteps(text)).toEqual([{ step: "deps", updatesFirst: false }]);
  });

  it("does not count an update in an earlier step", () => {
    const text = workflow(
      "      - name: refresh\n        run: |\n          sudo apt-get update\n" +
        "      - name: deps\n        run: sudo apt-get install -y bluez\n",
    );
    expect(aptInstallSteps(text)).toEqual([{ step: "deps", updatesFirst: false }]);
  });

  it.each([
    [
      "a later line",
      "run: |\n          sudo apt-get install -y bluez\n          sudo apt-get update",
    ],
    ["later on the same line", "run: sudo apt-get install -y bluez && sudo apt-get update"],
  ])("does not count an update on %s than the install", (_where, run) => {
    const text = workflow(`      - name: deps\n        ${run}\n`);
    expect(aptInstallSteps(text)).toEqual([{ step: "deps", updatesFirst: false }]);
  });

  it.each([
    [
      "the step's name",
      "- name: apt-get update\n        run: sudo apt-get install -y bluez",
      "apt-get update",
    ],
    [
      "an env value",
      "- name: deps\n        env:\n          NOTE: apt-get update\n        run: sudo apt-get install -y bluez",
      "deps",
    ],
    [
      "a with value",
      "- name: deps\n        with:\n          note: apt-get update\n        run: sudo apt-get install -y bluez",
      "deps",
    ],
    [
      "a trailing shell comment",
      "- name: deps\n        run: |\n          echo noop # apt-get update\n          sudo apt-get install -y bluez",
      "deps",
    ],
  ])("does not count an update named in %s", (_where, step, name) => {
    expect(aptInstallSteps(workflow(`      ${step}\n`))).toEqual([
      { step: name, updatesFirst: false },
    ]);
  });

  it.each([
    [
      "a one-line step",
      "      - run: sudo apt-get update && sudo apt-get install -y bluez\n",
      "the step at line 6",
    ],
    [
      "an inline run",
      "      - name: deps\n        run: sudo apt-get update && sudo apt-get install -y bluez\n",
      "deps",
    ],
    [
      "one line of a block",
      "      - name: deps\n        run: |\n          sudo apt-get update && sudo apt-get install -y bluez\n",
      "deps",
    ],
    [
      "a folded block",
      "      - name: deps\n        run: >\n          sudo apt-get update &&\n          sudo apt-get install -y bluez\n",
      "deps",
    ],
    [
      "an option before the word",
      "      - name: deps\n        run: |\n          sudo apt-get -qq update\n          sudo apt-get -qq install -y bluez\n",
      "deps",
    ],
    [
      "plain apt",
      "      - name: deps\n        run: sudo apt update && sudo apt install -y bluez\n",
      "deps",
    ],
  ])("passes an update before the install in %s", (_shape, steps, name) => {
    expect(aptInstallSteps(workflow(steps))).toEqual([{ step: name, updatesFirst: true }]);
  });

  it.each([
    ["apt-get -y install bluez"],
    ["apt-get -o Acquire::Retries=3 install -y bluez"],
    ["apt -y install bluez"],
  ])("reports %j with no update", (command) => {
    const text = workflow(`      - name: deps\n        run: sudo ${command}\n`);
    expect(aptInstallSteps(text)).toEqual([{ step: "deps", updatesFirst: false }]);
  });

  it.each([
    [
      "a commented-out line",
      "run: |\n          # sudo apt-get install -y bluez\n          echo ok",
    ],
    ["a trailing shell comment", "run: echo ok # sudo apt-get install -y bluez"],
    [
      "a with value",
      "uses: some/action@v1\n        with:\n          script: sudo apt-get install -y bluez",
    ],
  ])("ignores an install in %s", (_where, body) => {
    expect(aptInstallSteps(workflow(`      - name: deps\n        ${body}\n`))).toEqual([]);
  });

  it("refresh apt's package list in the same step before every apt install", () => {
    const steps = workflowFiles.flatMap((name) =>
      aptInstallSteps(readFileSync(join(workflowsDir, name), "utf8")).map((found) => ({
        ...found,
        name,
      })),
    );
    expect(steps.length, "expected image-smoke's apt install to still be here").toBeGreaterThan(0);
    expect(
      steps.filter((found) => !found.updatesFirst).map((found) => `${found.name}: ${found.step}`),
      "run `sudo apt-get update` earlier in the same step's `run:` than its `apt-get install`: " +
        "the runner's baked-in package list can name a file the archive no longer serves",
    ).toEqual([]);
  });
});

/**
 * Every apt update or install in a step runs under an outer `timeout <n>` on its own line and
 * carries apt's own `Acquire::http::Timeout` and `Acquire::https::Timeout`: apt's read timeout did
 * not end a wait on a mirror sending a byte every 5 s, and the outer limit did (receipt:
 * docs/developers/ci-and-gates.md, "Every apt wait is bounded"). It reads each workflow as TEXT
 * through the same step reader as the case above, so it misses every install that case lists as
 * passing. It reads line by line, so a `timeout` at the end of a `\`-continued line is reported as
 * unbounded. It does not check that the step retries, nor judge the numbers.
 */
describe("the workflows' apt waits", () => {
  const workflow = (steps) => `on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n${steps}`;
  const options = "-o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30";
  const unbounded = (text) =>
    aptWaits(text)
      .filter((found) => !found.bounded)
      .map((found) => found.command);

  it.each([
    ["sudo timeout 60 apt-get"],
    ["timeout 60 apt-get"],
    ["timeout 60 sudo apt-get"],
    ["if sudo timeout 60 apt-get"],
  ])("passes %j with both options", (prefix) => {
    const text = workflow(`      - name: deps\n        run: ${prefix} ${options} update\n`);
    expect(aptWaits(text)).toEqual([
      { step: "deps", command: `apt-get ${options} update`, bounded: true },
    ]);
  });

  it.each([[`"timeout 60 apt-get ${options} update"`], [`'timeout 60 apt-get ${options} update'`]])(
    "passes the quoted run: value %j",
    (run) => {
      const text = workflow(`      - name: deps\n        run: ${run}\n`);
      expect(aptWaits(text)).toEqual([
        { step: "deps", command: `apt-get ${options} update`, bounded: true },
      ]);
    },
  );

  it("reports an apt command with no outer limit", () => {
    const text = workflow(
      `      - name: deps\n        run: sudo apt-get ${options} install -y bluez\n`,
    );
    expect(unbounded(text)).toEqual([`apt-get ${options} install`]);
  });

  it.each([
    ["the http", "-o Acquire::https::Timeout=30"],
    ["the https", "-o Acquire::http::Timeout=30"],
  ])("reports an apt command without %s read timeout", (_missing, kept) => {
    const text = workflow(
      `      - name: deps\n        run: sudo timeout 60 apt-get ${kept} update\n`,
    );
    expect(unbounded(text)).toEqual([`apt-get ${kept} update`]);
  });

  it("does not count a timeout on an earlier line", () => {
    const text = workflow(
      `      - name: deps\n        run: |\n          sudo timeout 60 true\n          sudo apt-get ${options} update\n`,
    );
    expect(unbounded(text)).toEqual([`apt-get ${options} update`]);
  });

  it("does not count a timeout that bounds a different command on the same line", () => {
    const text = workflow(
      `      - name: deps\n        run: timeout 60 true && sudo apt-get ${options} update\n`,
    );
    expect(unbounded(text)).toEqual([`apt-get ${options} update`]);
  });

  it("counts an update with no install, and each command on its own", () => {
    const text = workflow(
      "      - name: refresh\n        run: sudo apt-get update\n" +
        `      - name: deps\n        run: |\n          sudo timeout 60 apt-get ${options} update &&\n` +
        "            sudo apt install -y bluez\n",
    );
    expect(aptWaits(text)).toEqual([
      { step: "refresh", command: "apt-get update", bounded: false },
      { step: "deps", command: `apt-get ${options} update`, bounded: true },
      { step: "deps", command: "apt install", bounded: false },
    ]);
  });

  it("bound every apt update and install with an outer timeout and apt's own read timeouts", () => {
    const found = workflowFiles.flatMap((name) =>
      aptWaits(readFileSync(join(workflowsDir, name), "utf8")).map((wait) => ({ ...wait, name })),
    );
    expect(found.length, "expected image-smoke's apt commands to still be here").toBeGreaterThan(0);
    expect(
      found
        .filter((wait) => !wait.bounded)
        .map((wait) => `${wait.name}: ${wait.step}: ${wait.command}`),
      "run each apt-get as `sudo timeout <seconds> apt-get -o Acquire::http::Timeout=<n> " +
        "-o Acquire::https::Timeout=<n> …` inside a retry loop: apt's own read timeout did not " +
        "end a wait on a mirror sending a byte every 5 s",
    ).toEqual([]);
  });
});

/**
 * `playwright install --with-deps` runs apt-get where no `-o` option or guard above reaches it, so
 * it takes the same outer limit. Reads TEXT through the same step reader, line by line, and does
 * not check that the step retries or judge the number.
 */
describe("the workflows' playwright --with-deps waits", () => {
  const workflow = (run) =>
    `on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - name: browsers\n        run: ${run}\n`;

  it.each([
    ["timeout 600 pnpm exec playwright install --with-deps chromium", true],
    ["if sudo timeout 600 npx playwright install --with-deps chromium; then :; fi", true],
    ["pnpm exec playwright install --with-deps chromium", false],
    ["timeout 60 true && pnpm exec playwright install --with-deps chromium", false],
    ["timeout 60 true & pnpm exec playwright install --with-deps chromium", false],
    ["timeout 600 pnpm exec playwright install 2>&1 --with-deps chromium", true],
    ['"timeout 600 pnpm exec playwright install --with-deps chromium"', true],
    ["'timeout 600 pnpm exec playwright install --with-deps chromium'", true],
    ['"pnpm exec playwright install --with-deps chromium"', false],
    ['"echo \\"x\\"\\ntimeout 600 pnpm exec playwright install --with-deps chromium"', true],
    [
      "|\n          timeout 600 true\n          pnpm exec playwright install --with-deps chromium",
      false,
    ],
  ])("reads %j as bounded: %s", (run, bounded) => {
    expect(withDepsWaits(workflow(run))).toEqual([{ step: "browsers", bounded }]);
  });

  it("finds no --with-deps without an outer timeout in any workflow", () => {
    const steps = workflowFiles.flatMap((name) =>
      workflowSteps(readFileSync(join(workflowsDir, name), "utf8")).map((step) => ({
        ...step,
        name,
      })),
    );
    expect(
      steps.some((step) => /playwright install/.test(step.command)),
      "expected the playwright install steps to still be read",
    ).toBe(true);
    expect(
      workflowFiles.flatMap((name) =>
        withDepsWaits(readFileSync(join(workflowsDir, name), "utf8"))
          .filter((wait) => !wait.bounded)
          .map((wait) => `${name}: ${wait.step}`),
      ),
      '--with-deps runs apt-get: run it under `timeout <seconds>` (docs/developers/ci-and-gates.md, "Every apt wait is bounded")',
    ).toEqual([]);
  });
});

/**
 * The top-level keys of a workflow's `on:` block, read as TEXT: the two-space keys after an `on:`
 * line, up to the next unindented line other than a comment. A one-line `on: push` or
 * `on: [push, pull_request]` is returned as its words. Weaker than its name: a flow-style block
 * spread over several lines, or a trigger spelled through an anchor, is not read.
 */
function workflowTriggers(text) {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => /^on:/.test(line));
  if (at === -1) return [];
  const inline = lines[at]
    .replace(/^on:/, "")
    .replace(/\s#.*$/, "")
    .trim();
  if (inline !== "") return inline.match(/[A-Za-z_]+/g) ?? [];
  const keys = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("#")) continue;
    if (/^\S/.test(line)) break;
    const key = /^ {2}([A-Za-z_]+):/.exec(line);
    if (key !== null) keys.push(key[1]);
  }
  return keys;
}

/**
 * CodeQL scans `main` nightly and on request, never on a push or a pull request (owner,
 * 2026-10-11, A488), and stores nothing in the repository's shared Actions cache
 * (docs/developers/ci-and-gates.md, "CodeQL scans `main` nightly, and nothing waits for it").
 * Weaker than its name: it reads codeql.yml as TEXT, so it sees the two cache switches only as
 * lines in the file, not what the action does with them.
 */
describe("CodeQL's workflow", () => {
  it("reads a block of triggers and a one-line trigger", () => {
    expect(
      workflowTriggers("on:\n  schedule:\n    - cron: x\n  workflow_dispatch:\njobs:\n"),
    ).toEqual(["schedule", "workflow_dispatch"]);
    expect(workflowTriggers("on:\n  schedule:\n# note\n  push:\njobs:\n")).toEqual([
      "schedule",
      "push",
    ]);
    expect(workflowTriggers("on: [push, pull_request] # both\njobs:\n")).toEqual([
      "push",
      "pull_request",
    ]);
  });

  const codeql = () => readFileSync(join(workflowsDir, "codeql.yml"), "utf8");

  it("runs only on its nightly schedule and by hand", () => {
    expect(workflowTriggers(codeql()).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(codeql()).toMatch(/^ {4}- cron: "\d+ \d+ \* \* \*"/m);
  });

  it("saves no database and no extraction cache", () => {
    expect(codeql()).toMatch(/^ {2}CODEQL_OVERLAY_DATABASE_MODE: none$/m);
    expect(codeql()).toMatch(/^ {10}trap-caching: false$/m);
  });
});

describe("CI image provenance", () => {
  it.each(["ci.yml", "image-smoke.yml"])(
    "stamps both images in %s and inspects smoke labels",
    (file) => {
      const workflow = readFileSync(join(repoRoot, ".github", "workflows", file), "utf8");
      const builds = workflow.split(/uses: docker\/build-push-action@[^\n]+/).slice(1);
      expect(builds).toHaveLength(2);
      for (const build of builds) {
        const withBlock = build.split(/\n {6}- /)[0];
        expect(withBlock).toContain("org.opencontainers.image.revision=${{ github.sha }}");
        expect(withBlock).toContain(
          "org.opencontainers.image.created=${{ steps.provenance.outputs.created }}",
        );
        expect(withBlock).toContain(
          "org.opencontainers.image.ref.name=${{ github.head_ref || github.ref_name }}",
        );
      }
      expect(workflow).toContain("id: provenance");
      expect(workflow).toContain("date -u '+%Y-%m-%dT%H:%M:%SZ'");
      if (file === "image-smoke.yml") {
        expect(workflow).toContain("docker image inspect --format '{{json .Config.Labels}}'");
        expect(workflow).toContain("for image in waitron:ci waitron-print-agent:ci");
        expect(workflow).toContain("org.opencontainers.image.revision");
      }
    },
  );
});

/**
 * One workflow's jobs, each a two-space key under the top-level `jobs:` line with the lines from it
 * to the next job or the next top-level key, and `start`, the index of its first line in the
 * workflow. Empty when there is no `jobs:` line.
 */
function jobBlocks(text) {
  const workflowLines = text.split("\n");
  const jobsKey = workflowLines.indexOf("jobs:");
  const blocks = [];
  if (jobsKey === -1) return blocks;
  for (const [offset, line] of workflowLines.slice(jobsKey + 1).entries()) {
    if (/^\S/.test(line) && !/^#/.test(line)) break;
    const id = /^ {2}([^\s#][^:]*):/.exec(line)?.[1];
    if (id !== undefined) blocks.push({ id, lines: [], start: jobsKey + 1 + offset });
    blocks.at(-1)?.lines.push(line);
  }
  return blocks;
}

/**
 * One workflow's pnpm setups: every non-comment `uses: pnpm/action-setup` line, every step whose
 * `run:` command names `scripts/ci-setup-pnpm.sh` and whether it carries a positive
 * `timeout-minutes`, the jobs with a step running `pnpm`, and those of them whose first such step
 * comes before (or without) a step running `bash scripts/ci-setup-pnpm.sh`. Jobs are two-space keys
 * under `jobs:`; steps and their commands come from `workflowSteps`.
 */
function pnpmSetups(text) {
  const workflowLines = text.split("\n");
  const actionSetup = workflowLines
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter(({ text: line }) => /^\s*(?:-\s+)?uses:\s*["']?pnpm\/action-setup\b/.test(line))
    .map(({ line }) => line);
  const setups = [];
  const pnpmJobs = [];
  const lateJobs = [];
  for (const { id, lines } of jobBlocks(text)) {
    const steps = workflowSteps(lines.join("\n"));
    for (const { command, timeoutMinutes } of steps) {
      if (!/\bscripts\/ci-setup-pnpm\.sh\b/.test(command)) continue;
      setups.push({ job: id, bounded: /^[1-9]\d*\s*(#.*)?$/.test(timeoutMinutes ?? "") });
    }
    const setupAt = steps.findIndex(({ command }) =>
      /\bbash scripts\/ci-setup-pnpm\.sh\b/.test(command),
    );
    const pnpmAt = steps.findIndex(({ command }) => /(?:^|[\s;&|(!])pnpm\s/m.test(command));
    if (pnpmAt === -1) continue;
    pnpmJobs.push(id);
    if (setupAt === -1 || setupAt > pnpmAt) lateJobs.push(id);
  }
  return { actionSetup, setups, pnpmJobs, lateJobs };
}

/**
 * Every pnpm setup runs `scripts/ci-setup-pnpm.sh` under a step `timeout-minutes`, never
 * `pnpm/action-setup`, whose self-installer has no time limit of its own (receipt:
 * docs/developers/ci-and-gates.md, "Every pnpm setup is bounded"). Weaker than its name: it reads
 * each workflow as TEXT and does not run it, so a setup inside a composite action or a reusable
 * workflow is invisible, and a `pnpm` reached through a script a step runs is not seen.
 */
describe("the workflows' pnpm setups", () => {
  const workflow = (steps) => `on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n${steps}`;
  const setup =
    "      - name: Set up pnpm\n        timeout-minutes: 5\n        run: bash scripts/ci-setup-pnpm.sh\n";

  it("passes a bounded setup before the job's first pnpm command", () => {
    const text = workflow(
      `${setup}      - name: install\n        run: pnpm install --frozen-lockfile\n`,
    );
    expect(pnpmSetups(text)).toEqual({
      actionSetup: [],
      setups: [{ job: "a", bounded: true }],
      pnpmJobs: ["a"],
      lateJobs: [],
    });
  });

  it("refuses a pnpm/action-setup step", () => {
    const text = workflow(
      "      - uses: pnpm/action-setup@v6\n        with:\n          version: 9.15.0\n",
    );
    expect(pnpmSetups(text).actionSetup).toEqual([6]);
  });

  it("passes a commented mention of pnpm/action-setup", () => {
    const text = workflow(`      # - uses: pnpm/action-setup@v6\n${setup}`);
    expect(pnpmSetups(text).actionSetup).toEqual([]);
  });

  it("refuses a setup step with no time limit", () => {
    const text = workflow(
      "      - name: Set up pnpm\n        run: bash scripts/ci-setup-pnpm.sh\n",
    );
    expect(pnpmSetups(text).setups).toEqual([{ job: "a", bounded: false }]);
  });

  it.each([
    [
      "a block, with no time limit",
      "|\n          echo setting up\n          bash scripts/ci-setup-pnpm.sh",
      false,
    ],
    ["a quoted line, with no time limit", '"bash scripts/ci-setup-pnpm.sh"', false],
    ["a block, with a time limit", "|\n          bash scripts/ci-setup-pnpm.sh", true],
  ])("reads a setup run from %s", (_shape, run, limited) => {
    const limit = limited ? "        timeout-minutes: 5\n" : "";
    const text = workflow(`      - name: Set up pnpm\n${limit}        run: ${run}\n`);
    expect(pnpmSetups(text).setups).toEqual([{ job: "a", bounded: limited }]);
  });

  it("does not count a job's time limit as the step's", () => {
    const text =
      "on: push\njobs:\n  a:\n    runs-on: x\n    timeout-minutes: 10\n    steps:\n" +
      "      - name: Set up pnpm\n        run: bash scripts/ci-setup-pnpm.sh\n";
    expect(pnpmSetups(text).setups).toEqual([{ job: "a", bounded: false }]);
  });

  it.each([
    ["no setup at all", "      - name: install\n        run: pnpm install\n"],
    ["the setup after it", `      - name: install\n        run: pnpm install\n${setup}`],
  ])("refuses a job that runs pnpm with %s before it", (_shape, steps) => {
    expect(pnpmSetups(workflow(steps)).lateJobs).toEqual(["a"]);
  });

  it("does not count pnpm named in a shell comment or a step name", () => {
    const text = workflow("      - name: pnpm install\n        run: echo ok # pnpm install\n");
    expect(pnpmSetups(text).lateJobs).toEqual([]);
  });

  const found = workflowFiles.map((name) => ({
    name,
    ...pnpmSetups(readFileSync(join(workflowsDir, name), "utf8")),
  }));

  it("finds setup steps to check", () => {
    expect(found.flatMap(({ setups }) => setups).length).toBeGreaterThan(0);
  });

  it("uses no pnpm/action-setup in any workflow", () => {
    expect(
      found.flatMap(({ name, actionSetup }) => actionSetup.map((line) => `${name}:${line}`)),
      "set pnpm up with `run: bash scripts/ci-setup-pnpm.sh` under a step `timeout-minutes`",
    ).toEqual([]);
  });

  it("gives every setup step its own time limit", () => {
    expect(
      found.flatMap(({ name, setups }) =>
        setups.filter((step) => !step.bounded).map((step) => `${name}: job ${step.job}`),
      ),
    ).toEqual([]);
  });

  it("sets pnpm up before each job's first pnpm command", () => {
    expect(
      found.find(({ name }) => name === "ci.yml").pnpmJobs.length,
      "expected ci.yml's jobs that run pnpm to still be read",
    ).toBeGreaterThan(0);
    expect(found.flatMap(({ name, lateJobs }) => lateJobs.map((job) => `${name}: ${job}`))).toEqual(
      [],
    );
  });
});

/**
 * One workflow's checkouts: an entry `{ job, step, shape }` for each first attempt of an
 * `actions/checkout@` step, where `step` is its `workflowSteps` label and `shape` is `"bounded"`
 * when it runs as the three steps in docs/developers/ci-and-gates.md, "Every checkout is bounded",
 * or else the first reason it does not. A checkout two steps after a first attempt, whose `if:`
 * names that attempt's id, is its second attempt and is not judged on its own.
 */
function checkoutAttempts(text) {
  const isCheckout = (step) => step?.uses?.startsWith("actions/checkout@") ?? false;
  const minutes = (step) => /^([1-9]\d*)\s*(?:#.*)?$/.exec(step?.timeoutMinutes ?? "")?.[1];
  const positive = (value) => /^[1-9]\d*$/.test(value ?? "");
  const same = (a, b) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  const shapeOf = (first, stop, second) => {
    if (minutes(first) === undefined) return "no time limit";
    if (Number(minutes(first)) > 2) return "time limit too long";
    if (Number(minutes(first)) < 2) return "time limit too short";
    if (
      !positive(first.env.GIT_HTTP_LOW_SPEED_LIMIT) ||
      !positive(first.env.GIT_HTTP_LOW_SPEED_TIME)
    )
      return "no low-speed limit";
    if (first.id === undefined || first.continueOnError !== "true") return "a stall fails the job";
    const failed = `steps.${first.id}.outcome == 'failure'`;
    if (
      stop?.if !== failed ||
      !stop.command.includes("pgrep '^git(-remote-https?)?$'") ||
      !stop.command.includes("GITHUB_WORKSPACE") ||
      !stop.command.includes("kill -9")
    )
      return "leftover git not stopped";
    if (second?.uses !== first.uses || second.if !== failed) return "no second attempt";
    if (
      minutes(second) === undefined ||
      Number(minutes(second)) > 2 ||
      !same(second.env, first.env)
    )
      return "second attempt unbounded";
    if (!same(second.with, first.with)) return "second attempt differs";
    if (second.continueOnError === "true") return "second attempt cannot fail the job";
    return "bounded";
  };
  const attempts = [];
  for (const { id: job, lines, start } of jobBlocks(text)) {
    const steps = workflowSteps("\n".repeat(start) + lines.join("\n"));
    for (let at = 0; at < steps.length; at += 1) {
      const [first, stop, second] = steps.slice(at, at + 3);
      if (!isCheckout(first)) continue;
      attempts.push({ job, step: first.step, shape: shapeOf(first, stop, second) });
      if (
        first.id !== undefined &&
        isCheckout(second) &&
        (second.if ?? "").includes(`steps.${first.id}.`)
      )
        at += 2;
    }
  }
  return attempts;
}

/**
 * Every `actions/checkout` runs as three steps — a first attempt under a 2-minute step limit with
 * git's low-speed limit and `continue-on-error`, a step that stops its leftover git, and a second
 * attempt only when the first failed — because the action retries a fetch that fails but waits on
 * one that stalls (receipt: docs/developers/ci-and-gates.md, "Every checkout is bounded"). Weaker
 * than its name: it reads each workflow as TEXT and never runs one, so a checkout inside a
 * composite action or a called workflow outside `.github/workflows/`, or reached through an
 * expression or a YAML anchor, is not seen; it checks that the low-speed numbers are positive
 * whole numbers, not that they are the right size; and it checks the stop step's words, not
 * whether it stops anything. It also refuses valid YAML no site uses: a quoted
 * `timeout-minutes: "2"`, an `if:` wrapped in `${{ }}`, and a low-speed value followed by a
 * `# comment`.
 */
describe("the workflows' checkouts", () => {
  const workflow = (steps) => `on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n${steps}`;
  const bounded = `      - id: checkout
        name: Check out the code
        uses: actions/checkout@v7
        timeout-minutes: 2
        continue-on-error: true
        env:
          GIT_HTTP_LOW_SPEED_LIMIT: 1000
          GIT_HTTP_LOW_SPEED_TIME: 20
      - name: Stop the first checkout's leftover git
        if: steps.checkout.outcome == 'failure'
        run: for p in $(pgrep '^git(-remote-https?)?$'); do [ "$(readlink /proc/$p/cwd)" = "$GITHUB_WORKSPACE" ] && kill -9 "$p" && echo "stopped git $p"; done; true
      - name: Check out the code, second attempt
        if: steps.checkout.outcome == 'failure'
        uses: actions/checkout@v7
        timeout-minutes: 2
        env:
          GIT_HTTP_LOW_SPEED_LIMIT: 1000
          GIT_HTTP_LOW_SPEED_TIME: 20
`;
  const [firstAttempt, stopStep, secondAttempt] = bounded.split(/(?=^ {6}- )/m);
  const withDepth = (step) => `${step}        with:\n          fetch-depth: 0\n`;
  const first = (shape) => ({ job: "a", step: "Check out the code", shape });
  const second = (shape) => ({ job: "a", step: "Check out the code, second attempt", shape });

  it("passes the bounded shape", () => {
    expect(checkoutAttempts(workflow(bounded))).toEqual([first("bounded")]);
  });

  it("passes the bounded shape with the same inputs on both attempts", () => {
    const text = workflow(withDepth(firstAttempt) + stopStep + withDepth(secondAttempt));
    expect(checkoutAttempts(text)).toEqual([first("bounded")]);
  });

  it("does not count a commented-out checkout", () => {
    expect(checkoutAttempts(workflow("      # - uses: actions/checkout@v7\n"))).toEqual([]);
  });

  it("refuses a lone checkout", () => {
    expect(checkoutAttempts(workflow("      - uses: actions/checkout@v7\n"))).toEqual([
      { job: "a", step: "the step at line 6", shape: "no time limit" },
    ]);
  });

  it("does not count a job's time limit as the checkout's", () => {
    const text =
      "on: push\njobs:\n  a:\n    runs-on: x\n    timeout-minutes: 10\n    steps:\n" +
      "      - name: Check out the code\n        uses: actions/checkout@v7\n";
    expect(checkoutAttempts(text)).toEqual([first("no time limit")]);
  });

  it.each([
    [
      "a first attempt with a 30-minute limit",
      bounded.replace("timeout-minutes: 2", "timeout-minutes: 30"),
      [first("time limit too long")],
    ],
    [
      "a first attempt with a 1-minute limit",
      bounded.replace("timeout-minutes: 2", "timeout-minutes: 1"),
      [first("time limit too short")],
    ],
    [
      "a second attempt with a 30-minute limit",
      firstAttempt + stopStep + secondAttempt.replace("timeout-minutes: 2", "timeout-minutes: 30"),
      [first("second attempt unbounded")],
    ],
    [
      "a stop step finding only processes named exactly git",
      bounded.replace("pgrep '^git(-remote-https?)?$'", "pgrep -x git"),
      [first("leftover git not stopped")],
    ],
    [
      "a low-speed window of 0 seconds",
      bounded.replace("GIT_HTTP_LOW_SPEED_TIME: 20", "GIT_HTTP_LOW_SPEED_TIME: 0"),
      [first("no low-speed limit")],
    ],
    [
      "no continue-on-error",
      bounded.replace("        continue-on-error: true\n", ""),
      [first("a stall fails the job")],
    ],
    [
      "a stop step waiting on another step",
      firstAttempt +
        stopStep.replace("steps.checkout.outcome", "steps.other.outcome") +
        secondAttempt,
      [first("leftover git not stopped")],
    ],
    [
      "a second attempt that always runs",
      firstAttempt +
        stopStep +
        secondAttempt.replace("        if: steps.checkout.outcome == 'failure'\n", ""),
      [first("no second attempt"), second("a stall fails the job")],
    ],
    [
      "a second attempt with no time limit",
      firstAttempt + stopStep + secondAttempt.replace("        timeout-minutes: 2\n", ""),
      [first("second attempt unbounded")],
    ],
    [
      "a second attempt without the low-speed limit",
      firstAttempt + stopStep + secondAttempt.replace(/ {8}env:\n(?: {10}.*\n)+/, ""),
      [first("second attempt unbounded")],
    ],
    [
      "a full history on the first attempt only",
      withDepth(firstAttempt) + stopStep + secondAttempt,
      [first("second attempt differs")],
    ],
    [
      "a second attempt that cannot fail the job",
      firstAttempt +
        stopStep +
        secondAttempt.replace(
          "        timeout-minutes: 2\n",
          "$&        continue-on-error: true\n",
        ),
      [first("second attempt cannot fail the job")],
    ],
    [
      "a first attempt without the low-speed byte rate",
      firstAttempt.replace("          GIT_HTTP_LOW_SPEED_LIMIT: 1000\n", "") +
        stopStep +
        secondAttempt,
      [first("no low-speed limit")],
    ],
    [
      "a first attempt with no id",
      bounded.replace("      - id: checkout\n        name:", "      - name:"),
      [first("a stall fails the job"), second("a stall fails the job")],
    ],
    [
      "a stop step not limited to the job's own directory",
      bounded.replace('"$GITHUB_WORKSPACE"', '"$PWD"'),
      [first("leftover git not stopped")],
    ],
    [
      "a stop step that does not force the kill",
      bounded.replace("kill -9", "kill"),
      [first("leftover git not stopped")],
    ],
    [
      "a second attempt using another version of the action",
      firstAttempt + stopStep + secondAttempt.replace("actions/checkout@v7", "actions/checkout@v6"),
      [first("no second attempt")],
    ],
    [
      "no stop step",
      firstAttempt + secondAttempt,
      [first("leftover git not stopped"), second("a stall fails the job")],
    ],
    ["no second attempt", firstAttempt + stopStep, [first("no second attempt")]],
    [
      "a double-quoted action and condition",
      bounded
        .replaceAll("uses: actions/checkout@v7", 'uses: "actions/checkout@v7"')
        .replaceAll(
          "if: steps.checkout.outcome == 'failure'",
          `if: "steps.checkout.outcome == 'failure'"`,
        ),
      [first("bounded")],
    ],
  ])("reads %s", (_shape, steps, expected) => {
    expect(checkoutAttempts(workflow(steps))).toEqual(expected);
  });

  const found = workflowFiles.map((name) => ({
    name,
    attempts: checkoutAttempts(readFileSync(join(workflowsDir, name), "utf8")),
  }));

  it("finds checkouts to check", () => {
    expect(found.find(({ name }) => name === "ci.yml").attempts.length).toBeGreaterThan(0);
    expect(found.flatMap(({ attempts }) => attempts).length).toBeGreaterThan(0);
  });

  it("bounds and retries every checkout in every workflow", () => {
    expect(
      found.flatMap(({ name, attempts }) =>
        attempts
          .filter(({ shape }) => shape !== "bounded")
          .map(({ job, shape }) => `${name}: job ${job}: ${shape}`),
      ),
      'run each checkout as the three steps in docs/developers/ci-and-gates.md, "Every checkout is bounded"',
    ).toEqual([]);
  });
});
