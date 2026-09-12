import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { workspacePackages } from "./changed-packages.mjs";

/**
 * A command a manifest declares under `bin` must exist when `pnpm install` runs, because that is
 * when pnpm links it into every dependent's `node_modules/.bin` and it warns once per dependent
 * when the target is missing. No member of this workspace builds at install time — `main` points at
 * TypeScript source — so a `bin` target under `dist/` can never be there, and the link is never
 * created: the command does not exist afterwards either.
 *
 * The operator commands the bundles DO produce are declared under `waitron.commands`, which pnpm
 * ignores; `scripts/deploy-image-env.test.ts` reads the server's copy to check the image ships
 * every one of them. Restoring a `bin` entry is only correct alongside something that puts the file
 * there before the link — this guard is what makes that a decision rather than an accident.
 *
 * The target is checked against git rather than the filesystem on purpose. A build output is
 * ignored, so on a machine where someone has run `pnpm --filter … build` the file IS on disk and an
 * "does it exist" check reports the same green as a genuinely committed launcher — a measurement
 * where both answers look alike (CLAUDE.md §1). Tracked-or-not gives the same verdict everywhere.
 *
 * Lives in the ROOT project (CLAUDE.md §4): it reads every member's manifest, and a
 * package-resident guard only runs when its own package is in scope.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

// Two bounds for the one `pnpm ls` spawn, for the reasons scripts/ci-workflow.test.mjs records above
// its own pair: the kernel-level kill for a hung child (Vitest's timer cannot interrupt a blocked
// `spawnSync`) and the larger per-test bound for a slow-but-completing cold CI runner.
const PNPM_LS_SPAWN_TIMEOUT_MS = 30_000;
const PNPM_LS_TEST_TIMEOUT_MS = 60_000;
const GIT_SPAWN_TIMEOUT_MS = 30_000;

type Manifest = { bin?: string | Record<string, string> };

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

/** Whether git has `path` in the index — false for a build output, which is ignored. */
function trackedByGit(path: string): boolean {
  const result = spawnSync("git", ["ls-files", "--error-unmatch", relative(REPO_ROOT, path)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: GIT_SPAWN_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    throw new Error(`\`git ls-files\` failed to run: ${result.error.message}`);
  }
  return result.status === 0;
}

type Spawn = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: "utf8"; timeout: number },
) => { error?: Error; status: number | null; stdout: string; stderr: string };

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

describe("every command a workspace manifest declares under bin", () => {
  it(
    "points at a committed file, so it is there when pnpm links it",
    () => {
      const listed = members();
      // A listing that came back empty would pass every assertion below (CLAUDE.md §2).
      expect(listed.length).toBeGreaterThan(0);

      const phantoms = listed.flatMap(({ name, dir }) => {
        const manifest = JSON.parse(
          readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8"),
        ) as Manifest;
        return phantomBins(manifest, name, join(REPO_ROOT, dir), trackedByGit);
      });

      expect(phantoms).toEqual([]);
    },
    PNPM_LS_TEST_TIMEOUT_MS,
  );

  it(
    "bounds the pnpm listing it reads so a hung child cannot outlive the suite",
    () => {
      let passed: number | undefined;
      members((command, args, options) => {
        passed = options.timeout;
        return { status: 0, stdout: "[]", stderr: "" };
      });
      expect(passed).toBe(PNPM_LS_SPAWN_TIMEOUT_MS);
    },
    PNPM_LS_TEST_TIMEOUT_MS,
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
  });

  it("resolves the target against the package directory, not the repository root", () => {
    const seen: string[] = [];
    phantomBins({ bin: { "waitron-thing": "./dist/thing.js" } }, "@waitron/thing", "/pkg", (p) => {
      seen.push(p);
      return true;
    });
    expect(seen).toEqual(["/pkg/dist/thing.js"]);
  });
});

describe("asking git rather than the filesystem", () => {
  it("counts a committed file as present", () => {
    expect(trackedByGit(join(REPO_ROOT, "package.json"))).toBe(true);
  });

  it("still refuses a build output that is sitting on disk", () => {
    // The control for this guard: a machine where someone ran `pnpm --filter … build` has the file
    // there, and a plain existence check would go green for everyone else's broken install.
    const dir = join(REPO_ROOT, "packages/credentials/dist");
    const target = join(dir, "bin.js");
    const preexisting = existsSync(target);
    if (!preexisting) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(target, "// placed by a test\n");
    }
    try {
      expect(existsSync(target)).toBe(true);
      expect(trackedByGit(target)).toBe(false);
    } finally {
      if (!preexisting) rmSync(dir, { recursive: true, force: true });
    }
  });
});
