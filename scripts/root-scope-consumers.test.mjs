import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_SCOPE_CONSUMERS } from "./changed-scope.mjs";
import { PNPM_LS_SPAWN_TIMEOUT_MS, workspaceMembers } from "./workspace-members.mjs";

// Holds ROOT_SCOPE_CONSUMERS (scripts/changed-scope.mjs) to the tree in both directions: a member
// file that names a root `scripts/` file by relative path is listed there, and so is a root
// `scripts/` file a ci.yml job runs before testing a member; every listed pair is one or the other.
//
// The member-file half is weaker than its name: it reads TEXT, so a path assembled from parts
// (`join(root, "scripts", x)`) is invisible to it; it reads tracked files only, and skips Markdown,
// which no build or test runs; a comment that spells such a path counts as a reference; it scans
// member files alone, so a root script reached only THROUGH a listed one (a helper that one
// imports) is attributed to nobody; and it looks for root `scripts/` alone, so a member reading a
// file under `.husky/` or `.github/`, also root scope, is unchecked.
//
// The ci.yml half is weaker than its name too: it reads the workflow as TEXT, line by line, and
// reads ci.yml alone. A script counts only on a line that STARTS with `node scripts/<file>` (after
// an optional `- run:`), so one run at the end of a pipe, or any other way, is not counted — the
// pipe is what leaves out `scripts/changed-packages.mjs runnable`, which several test jobs run
// before their tests. A member counts only through `pnpm --filter "<name>" test:shard` or
// `test:coverage` with that one quoted filter, so a job that tests through two filters or a
// variable is attributed to nobody. It skips full-line comments, but a step an `if:` switches off,
// or a line inside a heredoc, still counts, and it does not check that the script runs before the
// tests.

const REPO_ROOT = join(import.meta.dirname, "..");
const CI_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const GIT_SPAWN_TIMEOUT_MS = 30_000;
// Covers the real-tree test's waits: both kill timeouts, plus reading every tracked file. A
// literal, because scripts/spawn-timeout-budget.test.ts cannot resolve an imported constant.
const REAL_TREE_TEST_TIMEOUT_MS = 90_000;

/** Git exports `GIT_DIR` to every hook and `.husky/pre-push` runs this suite. */
const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

const sortedListing = (map) =>
  new Map([...map].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));

const RELATIVE_SCRIPTS_PATH = /((?:\.\.?\/)+scripts\/[\w./-]+)/g;

/**
 * The root `scripts/` file a relative reference in `file` resolves to, or `undefined` when it
 * resolves anywhere else. An import written `.js` resolves to the `.ts` beside it, as TypeScript's
 * does. A reference to a root `scripts/` path that exists as neither is returned as written, so the
 * comparison reports it rather than dropping it.
 */
function rootScriptTarget(file, reference, exists) {
  const resolved = posix.join(posix.dirname(file), reference.replace(/\.+$/, ""));
  if (!resolved.startsWith("scripts/")) return undefined;
  const typescript = resolved.replace(/\.js$/, ".ts");
  if (!exists(resolved) && exists(typescript)) return typescript;
  return resolved;
}

/** `{ file: memberDirs[] }` of every root `scripts/` file the given member files name. */
function rootScriptReaders(files, members, exists) {
  const readers = new Map();
  for (const { path, text } of files) {
    const member = members.find(({ dir }) => path.startsWith(`${dir}/`));
    if (member === undefined) continue;
    for (const [reference] of text.matchAll(RELATIVE_SCRIPTS_PATH)) {
      const target = rootScriptTarget(path, reference, exists);
      if (target === undefined) continue;
      if (!readers.has(target)) readers.set(target, new Set());
      readers.get(target).add(member.dir);
    }
  }
  return sortedListing(readers);
}

/**
 * ci.yml's jobs as arrays of lines. A job id is the only key at two-space indent below `jobs:`;
 * scanning from `jobs:` keeps `on:`'s own keys, at that same indent, out. The same line matching
 * scripts/ci-workflow.test.mjs uses, since there is no YAML library in this workspace.
 */
function workflowJobs(text) {
  const lines = text.split("\n");
  const jobsKey = lines.indexOf("jobs:");
  if (jobsKey === -1) throw new Error("the workflow has no top-level `jobs:` key");
  const starts = [];
  for (let i = jobsKey + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) starts.push(i);
  }
  return starts.map((at, index) => lines.slice(at + 1, starts[index + 1] ?? lines.length));
}

const RUNS_ROOT_SCRIPT = /^(?:-\s+)?(?:run:\s+)?node (scripts\/[\w./-]+)/;
const TESTS_MEMBER = /pnpm --filter "([^"]+)" test:(?:shard|coverage)\b/;

/**
 * `{ file: memberDirs[] }` of every root `scripts/` file a ci.yml job runs as a command of its own
 * (`node scripts/<file>` at the start of a line), attributed to each member that same job tests
 * with `pnpm --filter "<name>" test:shard` or `test:coverage`. Full-line comments are skipped.
 */
function ciRunReaders(text, members) {
  const readers = new Map();
  for (const job of workflowJobs(text)) {
    const code = job.map((line) => line.trim()).filter((line) => !line.startsWith("#"));
    const scripts = code.flatMap((line) => RUNS_ROOT_SCRIPT.exec(line)?.[1] ?? []);
    const dirs = code
      .flatMap((line) => TESTS_MEMBER.exec(line)?.[1] ?? [])
      .flatMap((name) => members.find((member) => member.name === name)?.dir ?? []);
    for (const script of scripts) {
      for (const dir of dirs) {
        if (!readers.has(script)) readers.set(script, new Set());
        readers.get(script).add(dir);
      }
    }
  }
  return sortedListing(readers);
}

/** Two `{ file: memberDirs[] }` listings merged, in the order sortedListing gives. */
function unionListing(a, b) {
  const union = new Map();
  for (const [file, dirs] of [...a, ...b]) {
    if (!union.has(file)) union.set(file, new Set());
    for (const dir of dirs) union.get(file).add(dir);
  }
  return sortedListing(union);
}

/** `spawn` is injected only so a test can assert the kill timeout and the isolated environment. */
function trackedMemberPaths(members, spawn = spawnSync) {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  const args = ["ls-files", "-z", "--", ...members.map(({ dir }) => dir)];
  const result = spawn("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
    timeout: GIT_SPAWN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(
      `\`git ${args.join(" ")}\` failed to run (killed after ${GIT_SPAWN_TIMEOUT_MS}ms?): ${result.error.message}`,
    );
  }
  if (result.status !== 0)
    throw new Error(`\`git ${args.join(" ")}\` exited ${result.status}: ${result.stderr}`);
  return result.stdout.split("\0").filter((path) => path !== "" && !path.endsWith(".md"));
}

const trackedMemberFiles = (members) =>
  trackedMemberPaths(members).map((path) => ({
    path,
    text: readFileSync(join(REPO_ROOT, path), "utf8"),
  }));

describe("ROOT_SCOPE_CONSUMERS", () => {
  it(
    "lists exactly the member directories that name, or whose CI test job runs, each root scripts/ file",
    () => {
      const members = workspaceMembers();
      expect(members.length, "guards against a vacuous pass over an empty listing").toBeGreaterThan(
        10,
      );
      const readers = unionListing(
        rootScriptReaders(trackedMemberFiles(members), members, (path) =>
          existsSync(join(REPO_ROOT, path)),
        ),
        ciRunReaders(readFileSync(CI_WORKFLOW, "utf8"), members),
      );
      expect(readers).toEqual(sortedListing(ROOT_SCOPE_CONSUMERS));
    },
    REAL_TREE_TEST_TIMEOUT_MS,
  );
});

describe("REAL_TREE_TEST_TIMEOUT_MS", () => {
  it("covers both kill timeouts with room left to read the tracked files", () => {
    expect(REAL_TREE_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(
      PNPM_LS_SPAWN_TIMEOUT_MS + GIT_SPAWN_TIMEOUT_MS + 30_000,
    );
  });
});

describe("rootScriptReaders", () => {
  const members = [
    { name: "@waitron/server", dir: "apps/server" },
    { name: "@waitron/till", dir: "apps/till" },
  ];
  const onDisk = new Set(["scripts/bundle-node.mjs", "scripts/dev-server-proxy.ts"]);
  const exists = (path) => onDisk.has(path);

  it("reads a package.json script's path from the member's own directory", () => {
    const files = [
      {
        path: "apps/server/package.json",
        text: '"build": "node ../../scripts/bundle-node.mjs src/bin.ts=dist/server.js"',
      },
    ];
    expect(rootScriptReaders(files, members, exists)).toEqual(
      new Map([["scripts/bundle-node.mjs", ["apps/server"]]]),
    );
  });

  it("resolves a `.js` import to the TypeScript file beside it", () => {
    const files = [
      {
        path: "apps/till/vite.config.ts",
        text: 'import { devServerProxy } from "../../scripts/dev-server-proxy.js";',
      },
    ];
    expect(rootScriptReaders(files, members, exists)).toEqual(
      new Map([["scripts/dev-server-proxy.ts", ["apps/till"]]]),
    );
  });

  it("leaves a member's own scripts/ directory out", () => {
    const files = [
      {
        path: "apps/server/src/demo-seed.ts",
        text: 'import x from "../scripts/demo-seed/seed.js";',
      },
    ];
    expect(rootScriptReaders(files, members, exists)).toEqual(new Map());
  });

  it("reads a path that mixes `./` and `../` segments", () => {
    const files = [
      {
        path: "apps/till/vite.config.ts",
        text: 'import { devServerProxy } from "../.././scripts/dev-server-proxy.js";',
      },
    ];
    expect(rootScriptReaders(files, members, exists)).toEqual(
      new Map([["scripts/dev-server-proxy.ts", ["apps/till"]]]),
    );
  });

  it("reports a root scripts/ path that does not exist, rather than dropping it", () => {
    const files = [{ path: "apps/till/x.ts", text: "see ../../scripts/gone.mjs." }];
    expect(rootScriptReaders(files, members, exists)).toEqual(
      new Map([["scripts/gone.mjs", ["apps/till"]]]),
    );
  });
});

describe("ciRunReaders", () => {
  const members = [
    { name: "@waitron/server", dir: "apps/server" },
    { name: "@waitron/till", dir: "apps/till" },
  ];
  const workflow = (...jobLines) =>
    ["on:", "  push:", "    branches: [main]", "jobs:", ...jobLines, ""].join("\n");

  it("attributes a script a job runs to the member whose tests that job runs", () => {
    const text = workflow(
      "  test-server:",
      "    steps:",
      "      - run: |",
      "          node scripts/setup-x.mjs",
      '          pnpm --filter "@waitron/server" test:shard --shard=1/3',
    );
    expect(ciRunReaders(text, members)).toEqual(
      new Map([["scripts/setup-x.mjs", ["apps/server"]]]),
    );
  });

  it("attributes a script to nobody when its job runs no member's tests", () => {
    const text = workflow(
      "  changes:",
      "    steps:",
      "      - run: node scripts/setup-x.mjs",
      "      - run: pnpm --filter @waitron/server build",
    );
    expect(ciRunReaders(text, members)).toEqual(new Map());
  });

  it("attributes a script to the member its own job tests, not a member another job tests", () => {
    const text = workflow(
      "  test-till:",
      "    steps:",
      "      - run: node scripts/setup-x.mjs",
      '      - run: pnpm --filter "@waitron/till" test:coverage',
      "  test-server:",
      "    steps:",
      '      - run: pnpm --filter "@waitron/server" test:shard',
    );
    expect(ciRunReaders(text, members)).toEqual(new Map([["scripts/setup-x.mjs", ["apps/till"]]]));
  });

  it("counts neither a comment naming the command nor a script fed from a pipe", () => {
    const text = workflow(
      "  test-server:",
      "    steps:",
      "      # node scripts/setup-x.mjs",
      "      - run: |",
      '          pnpm --filter "@waitron/server" ls --depth -1 --json \\',
      "            | node scripts/changed-packages.mjs runnable test:coverage",
      '          pnpm --filter "@waitron/server" test:shard',
    );
    expect(ciRunReaders(text, members)).toEqual(new Map());
  });

  it("still refuses a listed entry that neither a member file nor a CI job names", () => {
    const text = workflow(
      "  test-server:",
      "    steps:",
      "      - run: node scripts/setup-x.mjs",
      '      - run: pnpm --filter "@waitron/server" test:shard',
    );
    const files = [{ path: "apps/till/vite.config.ts", text: "../../scripts/dev-server-proxy.ts" }];
    const readers = unionListing(
      rootScriptReaders(files, members, () => true),
      ciRunReaders(text, members),
    );
    expect(readers).toEqual(
      new Map([
        ["scripts/dev-server-proxy.ts", ["apps/till"]],
        ["scripts/setup-x.mjs", ["apps/server"]],
      ]),
    );
    const listed = new Map([
      ["scripts/dev-server-proxy.ts", ["apps/till"]],
      ["scripts/setup-x.mjs", ["apps/server"]],
      ["scripts/unread.mjs", ["apps/till"]],
    ]);
    expect(readers).not.toEqual(sortedListing(listed));
  });
});

describe("trackedMemberPaths", () => {
  const members = [{ name: "@waitron/till", dir: "apps/till" }];

  it("passes the kill timeout and keeps the location overrides out of the child's environment", () => {
    const seen = [];
    const saved = GIT_LOCATION_OVERRIDES.map((name) => [name, process.env[name]]);
    try {
      for (const name of GIT_LOCATION_OVERRIDES) process.env[name] = "/poisoned";
      const paths = trackedMemberPaths(members, (command, args, options) => {
        seen.push({ command, args, options });
        return { status: 0, stdout: "apps/till/a.ts\0apps/till/README.md\0", stderr: "" };
      });
      expect(paths).toEqual(["apps/till/a.ts"]);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(seen).toEqual([
      {
        command: "git",
        args: ["ls-files", "-z", "--", "apps/till"],
        options: expect.objectContaining({ cwd: REPO_ROOT, timeout: GIT_SPAWN_TIMEOUT_MS }),
      },
    ]);
    // An ABSENT `env` is inherited, not isolated, so it is asserted present before it is asserted
    // clean.
    const childEnv = seen[0]?.options.env;
    expect(childEnv).toBeDefined();
    expect(GIT_LOCATION_OVERRIDES.filter((name) => childEnv?.[name] !== undefined)).toEqual([]);
  });

  it("throws, naming the kill timeout, when git could not run", () => {
    const spawn = () => ({ error: new Error("spawn git ETIMEDOUT"), status: null });
    expect(() => trackedMemberPaths(members, spawn)).toThrow(
      `\`git ls-files -z -- apps/till\` failed to run (killed after ${GIT_SPAWN_TIMEOUT_MS}ms?): spawn git ETIMEDOUT`,
    );
  });

  it("throws with git's stderr when it exits non-zero", () => {
    const spawn = () => ({ status: 128, stdout: "", stderr: "fatal: not a git repository" });
    expect(() => trackedMemberPaths(members, spawn)).toThrow(
      "`git ls-files -z -- apps/till` exited 128: fatal: not a git repository",
    );
  });
});
