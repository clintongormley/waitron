import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { workspacePackages } from "./changed-packages.mjs";

/**
 * Two properties of how this workspace declares the commands its bundles produce.
 *
 * A `bin` target must be a file GIT TRACKS. pnpm links `bin` into every dependent's
 * `node_modules/.bin` during `pnpm install` and warns — more than once per declaration — when the
 * target is not there yet. No member builds at install time (`main` points at TypeScript source),
 * so a `bin` under `dist/` is absent exactly when pnpm reads it, and building it afterwards does
 * not link it until the NEXT install. Tracked-or-not rather than exists-or-not because a build
 * output is git-ignored: on a machine where someone ran `pnpm --filter … build` an existence check
 * is green for everyone else's broken install — both answers look alike (CLAUDE.md §1). Operator
 * commands are declared under `waitron.commands` instead, which pnpm ignores; restoring a `bin`
 * entry is only correct alongside something that puts the file there before the link.
 *
 * A `waitron.commands` target must be NAMED by an `--outfile=` in its own member's `build` script.
 * Only `apps/server`'s copy is read anywhere (`scripts/deploy-image-env.test.ts`), so the rest would
 * otherwise be a hardcoded list nothing checks (CLAUDE.md §2). One-directional: a build may write
 * files that are no command.
 *
 * LIMITATION, stated because this half reads TEXT: it matches `--outfile=` against the build
 * script's STRING and never observes what a build writes. A build that put the file there another
 * way — `--outdir=`, a wrapper script, a quoted value — is reported unbuilt, and a build script that
 * merely MENTIONS the path passes. Same shape, and same reason, as the disclosures in
 * scripts/dashboard-browser-purity.test.ts and scripts/enum-add-value-safety.test.ts.
 *
 * Lives in the ROOT project (CLAUDE.md §4): it reads every member's manifest, and a
 * package-resident guard only runs when its own package is in scope.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

// Two bounds per child, for the reasons scripts/ci-workflow.test.mjs records above its own pair:
// the kernel-level kill for a hung child (Vitest's timer cannot interrupt a blocked `spawnSync`)
// and the larger per-test bound for a slow-but-completing cold CI runner. The per-test bound covers
// whichever child the test spawns, `pnpm ls` or `git`.
const PNPM_LS_SPAWN_TIMEOUT_MS = 30_000;
const GIT_SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_TEST_TIMEOUT_MS = 60_000;

/**
 * Git's own location overrides, each of which outranks the `cwd` a child is spawned in. Git exports
 * `GIT_DIR` to every hook and `.husky/pre-push` runs this suite, so an inherited one sends
 * `git ls-files` to another repository's index, where a committed file reads as untracked. Same
 * list, and same reason, as scripts/check-signoff.test.mjs, whose header carries the receipt.
 */
const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

/**
 * The caller's environment minus anything that relocates the repository. The caller's git CONFIG
 * stays: unlike check-signoff's throwaway fixtures, this suite asks about THIS repository.
 */
function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  return env;
}

type SpawnOptions = { cwd: string; encoding: "utf8"; timeout: number; env?: NodeJS.ProcessEnv };

type Spawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => { error?: Error; status: number | null; stdout: string; stderr: string };

/**
 * Runs `git` isolated from whoever is running the suite, and throws unless it exits 0 or with a
 * status the caller declared `expected`. EVERY git in this file goes through here, the fixtures
 * included: a location override outranks `cwd`, and an unisolated child fails by answering the
 * wrong question rather than by failing. Measured, git 2.55.0: with `GIT_DIR` exported,
 * `git init --quiet <dir>` exits 0, leaves `<dir>/.git` absent and reinitialises the repository
 * `GIT_DIR` names. A status nobody expected is likewise an error rather than a "no" (CLAUDE.md §1).
 * `spawn` is injected only so a test can redirect the child or assert the kill timeout is passed.
 */
function git(
  args: string[],
  options: { cwd?: string; expected?: number[]; spawn?: Spawn } = {},
): { status: number | null; stdout: string } {
  const { cwd = REPO_ROOT, expected = [], spawn = spawnSync } = options;
  const result = spawn("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_SPAWN_TIMEOUT_MS,
    env: isolatedGitEnv(),
  });
  if (result.error !== undefined) {
    throw new Error(
      `\`git ${args.join(" ")}\` failed to run (killed after ${GIT_SPAWN_TIMEOUT_MS}ms?): ${result.error.message}`,
    );
  }
  if (result.status !== 0 && !expected.includes(result.status as number)) {
    throw new Error(`\`git ${args.join(" ")}\` exited ${result.status}: ${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout };
}

type Manifest = {
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  waitron?: { commands?: Record<string, string> };
};

/** What `bin` declares, as `[command, target]`, for both spellings npm accepts. */
function declaredBins(manifest: Manifest, packageName: string): [string, string][] {
  const { bin } = manifest;
  if (bin === undefined) return [];
  // The string spelling names one command after the package itself.
  if (typeof bin === "string") return [[packageName, bin]];
  return Object.entries(bin);
}

/** The declared commands whose target is not a committed file — the set pnpm warns about. */
function phantomBins(
  manifest: Manifest,
  packageName: string,
  dir: string,
  isTracked: (path: string) => boolean,
): string[] {
  return declaredBins(manifest, packageName)
    .filter(([, target]) => !isTracked(join(dir, target)))
    .map(([command, target]) => `${packageName}: ${command} -> ${target}`);
}

/** esbuild's `--outfile=` targets in a member's `build` script — the files that build writes. */
const OUTFILE = /--outfile=(\S+)/g;

/** The operator commands whose target this member's own `build` script never writes. */
function unbuiltCommands(manifest: Manifest, packageName: string): string[] {
  const built = new Set(
    [...(manifest.scripts?.build ?? "").matchAll(OUTFILE)].map(([, out]) => normalize(out!)),
  );
  return Object.entries(manifest.waitron?.commands ?? {})
    .filter(([, target]) => !built.has(normalize(target)))
    .map(([command, target]) => `${packageName}: ${command} -> ${target}`);
}

/** `git ls-files --error-unmatch` exits 1 when nothing matched; any other non-zero is git failing. */
const GIT_LS_FILES_UNMATCHED = 1;

/** `git check-ignore --quiet` exits 1 when the path is not ignored; any other non-zero is a failure. */
const GIT_CHECK_IGNORE_NOT_IGNORED = 1;

/**
 * Whether git tracks `path` as a file of ITS OWN — false for a build output, which is ignored, and
 * false for a DIRECTORY, which `--error-unmatch` also exits 0 for once any descendant is tracked
 * (`git ls-files --error-unmatch -- scripts` exits 0 here) while pnpm refuses such a bin target:
 * a pnpm 9.15.0 install of a workspace whose `bin` named `./src` printed `EISDIR: illegal operation
 * on a directory, read`. `-z` rather than a byte comparison against git's default output, which
 * QUOTES a path carrying a non-ASCII byte (`"caf\303\251/bin.js"`) and would read a tracked file as
 * untracked. `spawn` is injected only so a test can redirect the child or assert the kill timeout is
 * passed (CLAUDE.md §4).
 */
function trackedByGit(path: string, spawn: Spawn = spawnSync): boolean {
  const target = relative(REPO_ROOT, path);
  const result = git(["ls-files", "-z", "--error-unmatch", "--", target], {
    expected: [GIT_LS_FILES_UNMATCHED],
    spawn,
  });
  if (result.status === GIT_LS_FILES_UNMATCHED) return false;
  return result.stdout.split("\0").includes(target);
}

/** Whether git's ignore rules cover `path` — what makes the build-output fixture below a control. */
function ignoredByGit(path: string): boolean {
  const result = git(["check-ignore", "--quiet", "--", relative(REPO_ROOT, path)], {
    expected: [GIT_CHECK_IGNORE_NOT_IGNORED],
  });
  return result.status === 0;
}

/**
 * Every workspace member, as `pnpm ls` lists them — the same source the pre-push hook and CI scope
 * from, so a new workspace root in pnpm-workspace.yaml is covered without editing this file.
 * `spawn` is injected only so a test can assert the kill timeout is passed.
 */
function members(spawn: Spawn = spawnSync): { name: string; dir: string }[] {
  const args = ["ls", "-r", "--depth", "-1", "--json"];
  const result = spawn("pnpm", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: PNPM_LS_SPAWN_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    throw new Error(
      `\`pnpm ${args.join(" ")}\` failed to run (killed after ${PNPM_LS_SPAWN_TIMEOUT_MS}ms?): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`\`pnpm ${args.join(" ")}\` exited ${result.status}: ${result.stderr}`);
  }
  const listed = workspacePackages(result.stdout, REPO_ROOT);
  if (listed === null) throw new Error("`pnpm ls` returned no parsable workspace listing");
  return listed;
}

/** Every member's manifest, for the tests that sweep the workspace. */
function manifests(): { name: string; dir: string; manifest: Manifest }[] {
  const listed = members();
  // A listing that came back empty would pass every assertion downstream (CLAUDE.md §2).
  expect(listed.length).toBeGreaterThan(0);
  return listed.map(({ name, dir }) => ({
    name,
    dir,
    manifest: JSON.parse(readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8")) as Manifest,
  }));
}

/** Runs `body` with the caller's git location overrides restored afterwards, set or unset. */
function withSavedGitEnv(body: () => void): void {
  const saved = GIT_LOCATION_OVERRIDES.map((name) => [name, process.env[name]] as const);
  try {
    body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("every command a workspace manifest declares under bin", () => {
  it(
    "points at a committed file, so it is there when pnpm links it",
    () => {
      const phantoms = manifests().flatMap(({ name, dir, manifest }) =>
        phantomBins(manifest, name, join(REPO_ROOT, dir), trackedByGit),
      );

      expect(phantoms).toEqual([]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "bounds the pnpm listing it reads so a hung child cannot outlive the suite",
    () => {
      const seen: SpawnOptions[] = [];
      const fake: Spawn = (_command, _args, options) => {
        seen.push(options);
        return {
          status: 0,
          stdout: JSON.stringify([{ name: "@waitron/x", path: join(REPO_ROOT, "packages/x") }]),
          stderr: "",
        };
      };
      // The parsed result as well as the timeout, so a broken parse cannot hide behind a passing
      // timeout check (scripts/coverage-thresholds.test.ts does the same).
      expect(members(fake)).toEqual([{ name: "@waitron/x", dir: "packages/x" }]);
      expect(seen).toEqual([expect.objectContaining({ timeout: PNPM_LS_SPAWN_TIMEOUT_MS })]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});

describe("every operator command a manifest declares under waitron.commands", () => {
  it(
    "is named by an --outfile= in that package's own build script",
    () => {
      const read = manifests();
      const declared = read.flatMap(({ manifest }) =>
        Object.keys(manifest.waitron?.commands ?? {}),
      );
      // A workspace that declared no commands at all would pass the assertion below.
      expect(declared.length).toBeGreaterThan(0);

      expect(read.flatMap(({ name, manifest }) => unbuiltCommands(manifest, name))).toEqual([]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});

describe("the detector itself", () => {
  const untracked = (): boolean => false;
  const tracked = (): boolean => true;

  it("flags a declared command whose target is not committed", () => {
    const manifest = { bin: { "waitron-thing": "./dist/thing.js" } };
    expect(phantomBins(manifest, "@waitron/thing", "/pkg", untracked)).toEqual([
      "@waitron/thing: waitron-thing -> ./dist/thing.js",
    ]);
  });

  it("passes the same declaration once the target is committed", () => {
    const manifest = { bin: { "waitron-thing": "./dist/thing.js" } };
    expect(phantomBins(manifest, "@waitron/thing", "/pkg", tracked)).toEqual([]);
  });

  it("reads the string spelling of bin under the package's own name", () => {
    expect(phantomBins({ bin: "./dist/thing.js" }, "@waitron/thing", "/pkg", untracked)).toEqual([
      "@waitron/thing: @waitron/thing -> ./dist/thing.js",
    ]);
  });

  it("says nothing about a manifest that declares no commands", () => {
    expect(phantomBins({}, "@waitron/thing", "/pkg", untracked)).toEqual([]);
    expect(unbuiltCommands({}, "@waitron/thing")).toEqual([]);
  });

  it("resolves the target against the package directory, not the repository root", () => {
    const seen: string[] = [];
    phantomBins({ bin: { "waitron-thing": "./dist/thing.js" } }, "@waitron/thing", "/pkg", (p) => {
      seen.push(p);
      return true;
    });
    expect(seen).toEqual(["/pkg/dist/thing.js"]);
  });

  it("flags an operator command no build step writes", () => {
    const manifest = {
      scripts: { build: "esbuild src/bin.ts --bundle --outfile=dist/other.js" },
      waitron: { commands: { "waitron-thing": "./dist/thing.js" } },
    };
    expect(unbuiltCommands(manifest, "@waitron/thing")).toEqual([
      "@waitron/thing: waitron-thing -> ./dist/thing.js",
    ]);
  });

  it("matches a declared target against an --outfile= written without the leading ./", () => {
    const manifest = {
      scripts: { build: 'esbuild src/bin.ts --outfile=dist/thing.js --banner:js="x"' },
      waitron: { commands: { "waitron-thing": "./dist/thing.js" } },
    };
    expect(unbuiltCommands(manifest, "@waitron/thing")).toEqual([]);
  });

  it("lets a build write files that are no command, and flags a package that builds nothing", () => {
    const built = {
      scripts: { build: "esbuild a.ts --outfile=dist/a.js && esbuild b.ts --outfile=dist/b.js" },
      waitron: { commands: { "waitron-a": "./dist/a.js" } },
    };
    expect(unbuiltCommands(built, "@waitron/thing")).toEqual([]);
    expect(
      unbuiltCommands({ waitron: { commands: { "waitron-a": "./dist/a.js" } } }, "@waitron/thing"),
    ).toEqual(["@waitron/thing: waitron-a -> ./dist/a.js"]);
  });
});

describe("asking git rather than the filesystem", () => {
  it(
    "counts a committed file as present",
    () => {
      expect(trackedByGit(join(REPO_ROOT, "package.json"))).toBe(true);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "still refuses a build output that is sitting on disk",
    () => {
      // The control for this guard: a machine where someone ran `pnpm --filter … build` has the file
      // there, and a plain existence check would go green for everyone else's broken install. So the
      // fixture is a real build output at a real git-ignored path inside the repository. The name is
      // unique per run because the cleanup must never remove a path this test did not create.
      const fixture = join(
        REPO_ROOT,
        "packages/credentials",
        `bin-probe-${randomUUID()}.tsbuildinfo`,
      );
      try {
        writeFileSync(fixture, "// placed by a test\n");
        expect(existsSync(fixture)).toBe(true);
        expect(ignoredByGit(fixture)).toBe(true);
        expect(trackedByGit(fixture)).toBe(false);
      } finally {
        rmSync(fixture, { force: true });
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "refuses a directory whose descendants are tracked",
    () => {
      // `git ls-files --error-unmatch -- scripts` exits 0 on the descendants, so the directory
      // answers like a tracked file. Measured: a pnpm 9.15.0 install of a workspace whose `bin`
      // named `./src` printed `EISDIR: illegal operation on a directory, read`.
      expect(existsSync(join(REPO_ROOT, "scripts"))).toBe(true);
      expect(trackedByGit(join(REPO_ROOT, "scripts"))).toBe(false);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "counts a tracked path holding a non-ASCII byte",
    () => {
      // git QUOTES such a path by default, so a byte-exact comparison against its output would call
      // a genuinely tracked file untracked. Built as a throwaway index rather than committed here,
      // because the only way to have this repository track such a path is to commit one to it.
      const fixture = mkdtempSync(join(tmpdir(), "waitron-manifest-commands-utf8-"));
      const target = join("café", "bin.js");
      try {
        const inFixture: Spawn = (command, args, options) =>
          spawnSync(command, args, { ...options, cwd: fixture });
        git(["init", "--quiet", fixture]);
        mkdirSync(join(fixture, "café"));
        writeFileSync(join(fixture, target), "#!/usr/bin/env node\n");
        git(["add", "--", target], { cwd: fixture });

        // The failing case, stated so this is a probe and not a formality: the same index, read the
        // way git answers by DEFAULT. `core.quotePath` is spelled out rather than inherited, so a
        // reader who has turned it off globally sees this control still describe git's default.
        const quoted = git(
          ["-c", "core.quotePath=true", "ls-files", "--error-unmatch", "--", target],
          { cwd: fixture },
        );
        expect(quoted.stdout).toBe('"caf\\303\\251/bin.js"\n');
        expect(trackedByGit(join(REPO_ROOT, target), inFixture)).toBe(true);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "ignores the git location overrides its caller inherited",
    () => {
      const elsewhere = mkdtempSync(join(tmpdir(), "waitron-manifest-commands-"));
      try {
        withSavedGitEnv(() => {
          // Poisoned BEFORE the fixture is built, which is the shape `.husky/pre-push` hands this
          // suite. An unisolated `git init` would exit 0, create the decoy and leave the fixture's
          // own `.git` absent — the control would quietly become "not a git repository at all",
          // which is the weaker half of the question this test asks. The decoy sits inside the
          // temporary directory so a regression here still leaves nothing behind.
          process.env.GIT_DIR = join(elsewhere, "decoy.git");
          git(["init", "--quiet", elsewhere]);
          expect(existsSync(join(elsewhere, ".git"))).toBe(true);

          // Another repository's index, plus an index file git refuses outright: unisolated, the
          // first reports this repository's committed file untracked and the second exits 128.
          process.env.GIT_DIR = join(elsewhere, ".git");
          process.env.GIT_WORK_TREE = elsewhere;
          process.env.GIT_INDEX_FILE = "/dev/null";
          expect(trackedByGit(join(REPO_ROOT, "package.json"))).toBe(true);
        });
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it("passes the kill timeout and keeps the location overrides out of the child's environment", () => {
    const seen: SpawnOptions[] = [];
    withSavedGitEnv(() => {
      for (const name of GIT_LOCATION_OVERRIDES) process.env[name] = "/poisoned";
      const isTracked = trackedByGit(
        join(REPO_ROOT, "package.json"),
        (_command, _args, options) => {
          seen.push(options);
          // NUL-terminated, as `-z` makes real git answer.
          return { status: 0, stdout: "package.json\0", stderr: "" };
        },
      );
      expect(isTracked).toBe(true);
    });
    expect(seen).toEqual([expect.objectContaining({ timeout: GIT_SPAWN_TIMEOUT_MS })]);
    // An ABSENT `env` is not an isolated one — the child would then inherit every override — so the
    // child's environment is asserted present before it is asserted clean.
    const childEnv = seen[0]?.env;
    expect(childEnv).toBeDefined();
    expect(GIT_LOCATION_OVERRIDES.filter((name) => childEnv?.[name] !== undefined)).toEqual([]);
  });

  it(
    'throws rather than answering "no" when git could not run',
    () => {
      // A real git that cannot run: /dev/null is not an index file, and it exits 128 rather than the
      // 1 that means "nothing matched".
      expect(() =>
        trackedByGit(join(REPO_ROOT, "package.json"), (command, args, options) =>
          spawnSync(command, args, {
            ...options,
            env: { ...options.env, GIT_INDEX_FILE: "/dev/null" },
          }),
        ),
      ).toThrow(/exited 128/);
      expect(() =>
        trackedByGit(join(REPO_ROOT, "package.json"), () => ({
          error: new Error("spawn git ENOENT"),
          status: null,
          stdout: "",
          stderr: "",
        })),
      ).toThrow(/failed to run/);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});
