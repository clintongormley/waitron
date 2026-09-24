import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_SCOPE_CONSUMERS } from "./changed-scope.mjs";
import { workspaceMembers } from "./workspace-members.mjs";

// Holds ROOT_SCOPE_CONSUMERS (scripts/changed-scope.mjs) to the tree in both directions: a member
// file that names a root `scripts/` file by relative path is listed there, and every listed pair is
// such a reference.
//
// Weaker than its name: it reads TEXT, so a path assembled from parts (`join(root, "scripts", x)`)
// is invisible to it; it reads tracked files only, and skips Markdown, which no build or test runs;
// and a comment that spells such a path counts as a reference.

const REPO_ROOT = join(import.meta.dirname, "..");
const GIT_SPAWN_TIMEOUT_MS = 30_000;

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

const RELATIVE_SCRIPTS_PATH = /((?:\.\.\/)+scripts\/[\w./-]+)/g;

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

function trackedMemberFiles(members) {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  const result = spawnSync("git", ["ls-files", "-z", "--", ...members.map(({ dir }) => dir)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
    timeout: GIT_SPAWN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(`git ls-files exited ${result.status}: ${result.stderr}`);
  return result.stdout
    .split("\0")
    .filter((path) => path !== "" && !path.endsWith(".md"))
    .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), "utf8") }));
}

describe("ROOT_SCOPE_CONSUMERS", () => {
  it("lists exactly the member directories that name each root scripts/ file", () => {
    const members = workspaceMembers();
    expect(members.length, "guards against a vacuous pass over an empty listing").toBeGreaterThan(
      10,
    );
    const readers = rootScriptReaders(trackedMemberFiles(members), members, (path) =>
      existsSync(join(REPO_ROOT, path)),
    );
    expect(readers).toEqual(sortedListing(ROOT_SCOPE_CONSUMERS));
  }, 90_000);
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

  it("reports a root scripts/ path that does not exist, rather than dropping it", () => {
    const files = [{ path: "apps/till/x.ts", text: "see ../../scripts/gone.mjs." }];
    expect(rootScriptReaders(files, members, exists)).toEqual(
      new Map([["scripts/gone.mjs", ["apps/till"]]]),
    );
  });
});
