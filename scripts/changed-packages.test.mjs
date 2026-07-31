import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classify } from "../.github/scripts/changed-scope.mjs";
import { formatScope, packagesForPaths, workspacePackages } from "./changed-packages.mjs";

const ROOT = "/repo";

/** One `pnpm ls -r --depth -1 --json` entry for a workspace member. */
const member = (name, dir) => ({ name, version: "0.0.0", path: `${ROOT}/${dir}`, private: true });

/**
 * A `pnpm ls -r --depth -1 --json` result. The workspace ROOT is always the first entry — that is
 * what the real command emits (run in this workspace: 16 entries, the first named `waitron` with a
 * `path` equal to the repository root), and excluding it is the first thing workspacePackages does.
 */
const ls = (...members) =>
  JSON.stringify([{ name: "waitron", path: ROOT, private: true }, ...members]);

const WORKSPACE = workspacePackages(
  ls(
    member("@waitron/db", "packages/db"),
    member("@waitron/payments", "packages/payments"),
    member("@waitron/server", "apps/server"),
    member("@waitron/bench-pglite", "bench/pglite-throughput"),
  ),
  ROOT,
);

describe("workspacePackages", () => {
  it("excludes the workspace root, whose path IS the repository root", () => {
    expect(workspacePackages(ls(member("@waitron/db", "packages/db")), ROOT)).toEqual([
      { name: "@waitron/db", dir: "packages/db" },
    ]);
  });

  it("reports each member's directory relative to the repository root", () => {
    expect(WORKSPACE).toEqual([
      { name: "@waitron/db", dir: "packages/db" },
      { name: "@waitron/payments", dir: "packages/payments" },
      { name: "@waitron/server", dir: "apps/server" },
      { name: "@waitron/bench-pglite", dir: "bench/pglite-throughput" },
    ]);
  });

  // Every caller treats null as "we could not read the workspace", which is a reason to run
  // everything. The empty ARRAY would be the definite answer "this workspace has no members", and
  // nothing produces it today — but the two must not be conflated, for the same reason
  // packagesInScope keeps them apart in .github/scripts/changed-scope.mjs.
  it("returns null when pnpm emitted nothing at all", () => {
    expect(workspacePackages("", ROOT)).toBeNull();
    expect(workspacePackages("   ", ROOT)).toBeNull();
  });

  it("returns null for output that is not JSON", () => {
    expect(workspacePackages("ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND", ROOT)).toBeNull();
  });

  // `pnpm ls --json` reports its OWN failures as valid JSON on stdout (measured on pnpm 9.15.0 and
  // recorded in .github/scripts/changed-scope.mjs's packagesInScope). It parses, so only the shape
  // check tells it apart from a real result.
  it("returns null for pnpm's own error object, which is valid JSON", () => {
    expect(
      workspacePackages('{"error":{"code":"pnpm","message":"Unsupported package selector"}}', ROOT),
    ).toBeNull();
  });

  it("returns null for an entry missing a name or a path", () => {
    expect(workspacePackages(JSON.stringify([{ path: `${ROOT}/packages/db` }]), ROOT)).toBeNull();
    expect(workspacePackages(JSON.stringify([{ name: "@waitron/db" }]), ROOT)).toBeNull();
  });

  // A member outside the checkout cannot own any path in the diff, and the relative path to it
  // would escape upwards ("../elsewhere"). Rather than silently dropping it — which would attribute
  // its files to nothing and quietly widen every run to global — the whole read fails closed.
  it("returns null for a member that is not inside the repository root", () => {
    expect(
      workspacePackages(JSON.stringify([{ name: "@waitron/x", path: "/elsewhere" }]), ROOT),
    ).toBeNull();
  });

  it("tolerates a repository root given with a trailing slash", () => {
    expect(workspacePackages(ls(member("@waitron/db", "packages/db")), `${ROOT}/`)).toEqual([
      { name: "@waitron/db", dir: "packages/db" },
    ]);
  });
});

describe("packagesForPaths", () => {
  it("attributes a source file to the package that owns it", () => {
    expect(packagesForPaths(["packages/db/src/index.ts"], WORKSPACE)).toMatchObject({
      packages: ["@waitron/db"],
      global: false,
    });
  });

  it("attributes a file at a package's own root, not only under src/", () => {
    expect(packagesForPaths(["packages/db/package.json"], WORKSPACE).packages).toEqual([
      "@waitron/db",
    ]);
  });

  it("deduplicates and sorts the packages it attributes", () => {
    expect(
      packagesForPaths(
        [
          "packages/payments/src/reconcile.ts",
          "packages/db/src/index.ts",
          "packages/db/src/schema.ts",
        ],
        WORKSPACE,
      ).packages,
    ).toEqual(["@waitron/db", "@waitron/payments"]);
  });

  it("ignores blank lines, which a git diff pipe can produce", () => {
    expect(packagesForPaths(["packages/db/src/index.ts", "", "  "], WORKSPACE)).toMatchObject({
      packages: ["@waitron/db"],
      global: false,
    });
  });

  // The whole point of the `global` flag: these paths can affect anything, so nothing may be
  // narrowed away on account of them.
  it.each([
    ".github/workflows/ci.yml",
    ".github/scripts/changed-scope.mjs",
    ".husky/pre-push",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
    "eslint.config.js",
    "vitest.config.ts",
    "package.json",
    "scripts/changed-packages.mjs",
  ])("reports a global run for %s, which belongs to no package", (path) => {
    expect(packagesForPaths([path], WORKSPACE).global).toBe(true);
  });

  // `global` and a package list are not two answers to be combined by the caller — the list is
  // empty precisely so a caller that reads it without checking `global` narrows to nothing rather
  // than to a plausible-looking subset.
  it("empties the package list when the run is global", () => {
    expect(packagesForPaths(["packages/db/src/index.ts", "tsconfig.base.json"], WORKSPACE)).toEqual(
      {
        packages: [],
        global: true,
        reason: expect.stringContaining("tsconfig.base.json"),
      },
    );
  });

  // Documentation must NOT force a global run. CLAUDE.md §7 tells every branch to update CLAUDE.md
  // and docs/backlog.md in the same change that makes them stale, so a rule that widened on any
  // docs/ path would widen on nearly every branch in this repository.
  it("does not let a documentation path widen the run", () => {
    expect(
      packagesForPaths(["docs/backlog.md", "CLAUDE.md", "packages/db/src/index.ts"], WORKSPACE),
    ).toMatchObject({ packages: ["@waitron/db"], global: false });
  });

  // Same predicate as the docs gate, so the hook cannot classify a push as "has code work" and then
  // find no code path to attribute. isInertPath is imported from .github/scripts/changed-scope.mjs
  // rather than reimplemented, which is what makes this hold by construction.
  it("treats exactly the paths classify() calls documentation as documentation", () => {
    const docsOnly = ["docs/superpowers/specs/x.md", "README.md"];
    expect(classify(docsOnly).code).toBe(false);
    expect(packagesForPaths(docsOnly, WORKSPACE).global).toBe(true);

    const code = [...docsOnly, "packages/verifactu/schemas/README.md"];
    expect(classify(code).code).toBe(true);
    expect(packagesForPaths(code, WORKSPACE).global).toBe(true);
  });

  // Fails CLOSED, the same principle as classify() and as the hook's own deletion guard: an empty
  // list means we could not work out what is being pushed, not that nothing is.
  it("fails closed when no changed path could be determined", () => {
    expect(packagesForPaths([], WORKSPACE)).toMatchObject({ packages: [], global: true });
    expect(packagesForPaths([""], WORKSPACE)).toMatchObject({
      packages: [],
      global: true,
      reason: expect.stringMatching(/running everything/i),
    });
  });

  it("fails closed when the workspace could not be read", () => {
    expect(packagesForPaths(["packages/db/src/index.ts"], null)).toMatchObject({
      packages: [],
      global: true,
    });
  });

  // The sibling directory must NOT be a workspace member for this to test anything. The first
  // version of this test listed both `packages/db` and `packages/db-extra`, and proving it by
  // deletion (CLAUDE.md §4) showed it passing with the directory boundary removed entirely:
  // `startsWith("packages/db")` matches both members, and the innermost-wins rule then picks the
  // longer one, so the right answer came out for the wrong reason. With db alone in the workspace
  // there is nothing to mask it — a bare prefix attributes the path to @waitron/db, whose suite
  // passes, and the run never widens.
  it("does not attribute a path whose directory merely shares a prefix with a package", () => {
    const dbOnly = workspacePackages(ls(member("@waitron/db", "packages/db")), ROOT);
    expect(packagesForPaths(["packages/db-extra/src/a.ts"], dbOnly)).toMatchObject({
      packages: [],
      global: true,
    });
  });

  it("attributes the sibling once it IS a workspace member", () => {
    const workspace = workspacePackages(
      ls(member("@waitron/db", "packages/db"), member("@waitron/db-extra", "packages/db-extra")),
      ROOT,
    );
    expect(packagesForPaths(["packages/db-extra/src/a.ts"], workspace).packages).toEqual([
      "@waitron/db-extra",
    ]);
  });

  // No workspace member contains another today, but pnpm-workspace.yaml is one line from making it
  // so, and the failure would be silent: the outer package's suite runs, the inner one's does not.
  it("attributes a nested package to the innermost directory that contains it", () => {
    const workspace = workspacePackages(
      ls(member("@waitron/outer", "bench"), member("@waitron/inner", "bench/pglite-throughput")),
      ROOT,
    );
    expect(packagesForPaths(["bench/pglite-throughput/src/x.ts"], workspace).packages).toEqual([
      "@waitron/inner",
    ]);
    expect(packagesForPaths(["bench/other.ts"], workspace).packages).toEqual(["@waitron/outer"]);
  });

  it("names the path that forced a global run", () => {
    expect(packagesForPaths([".husky/pre-push"], WORKSPACE).reason).toContain(".husky/pre-push");
  });

  it("names the packages it attributed", () => {
    expect(packagesForPaths(["packages/db/src/index.ts"], WORKSPACE).reason).toContain(
      "@waitron/db",
    );
  });
});

describe("formatScope", () => {
  it("emits the global flag and the package list, in that order", () => {
    expect(formatScope(packagesForPaths(["packages/db/src/index.ts"], WORKSPACE))).toBe(
      "global=false\npackages=@waitron/db",
    );
  });

  it("emits an empty package list for a global run", () => {
    expect(formatScope(packagesForPaths([".husky/pre-push"], WORKSPACE))).toBe(
      "global=true\npackages=",
    );
  });

  // The hook splits this on whitespace to build one `--filter "...<pkg>"` argument per name, so the
  // separator is part of the contract.
  it("separates several packages with a single space", () => {
    expect(
      formatScope(
        packagesForPaths(["packages/db/src/a.ts", "packages/payments/src/b.ts"], WORKSPACE),
      ),
    ).toBe("global=false\npackages=@waitron/db @waitron/payments");
  });
});

// The CLI is only reachable by running the file, so these spawn it. What they add over the unit
// tests above is what no exported function can show: that it resolves the REAL workspace by running
// `pnpm ls -r --depth -1 --json` itself, and that the two streams stay apart — the hook reads
// stdout with `grep`/`cut`, so a stray line there becomes a bogus scope.
describe("the CLI", () => {
  const repoRoot = join(import.meta.dirname, "..");
  const script = join(import.meta.dirname, "changed-packages.mjs");

  /** Runs the script with `input` on stdin, from the repository root, keeping its streams apart. */
  const run = (input) => {
    const result = spawnSync(process.execPath, [script], {
      input,
      encoding: "utf8",
      cwd: repoRoot,
    });
    expect(result.status).toBe(0);
    return result;
  };

  it("resolves this workspace and attributes a real package directory", () => {
    expect(run("packages/db/src/index.ts\n").stdout).toBe("global=false\npackages=@waitron/db\n");
  });

  it("attributes several real package directories", () => {
    expect(run("packages/db/src/index.ts\napps/server/src/boot.ts\n").stdout).toBe(
      "global=false\npackages=@waitron/db @waitron/server\n",
    );
  });

  it("reports a global run for root configuration", () => {
    expect(run("tsconfig.base.json\n").stdout).toBe("global=true\npackages=\n");
  });

  it("fails closed on empty stdin", () => {
    expect(run("").stdout).toBe("global=true\npackages=\n");
    expect(run("\n").stdout).toBe("global=true\npackages=\n");
  });

  it("puts the reason on stderr, where the hook's grep cannot reach it", () => {
    const { stdout, stderr } = run("packages/db/src/index.ts\n");
    expect(stderr).toContain("@waitron/db");
    expect(stdout).not.toContain("changed-packages:");
  });
});
