import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGES_WITHOUT_TESTS, classify } from "./changed-scope.mjs";
import {
  formatScope,
  scopeForPaths,
  scriptRunCheck,
  workspacePackages,
} from "./changed-packages.mjs";

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

  // Every path this is compared against comes from `git diff --name-only`, which is `/`-delimited on
  // every platform, so `dir` must be too — `path.relative` returns the platform's own separator.
  // This passes trivially on darwin and in CI (`sep` is `/` there); it exists so that a separator
  // where it is not cannot silently turn scoping off by attributing nothing and going global.
  it("reports directories with forward slashes, whatever the platform separator is", () => {
    const nested = workspacePackages(ls(member("@waitron/bench", "bench/pglite-throughput")), ROOT);

    expect(nested).toEqual([{ name: "@waitron/bench", dir: "bench/pglite-throughput" }]);
    expect(nested[0].dir).not.toContain("\\");
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
  // packagesInScope keeps them apart in scripts/changed-scope.mjs.
  it("returns null when pnpm emitted nothing at all", () => {
    expect(workspacePackages("", ROOT)).toBeNull();
    expect(workspacePackages("   ", ROOT)).toBeNull();
  });

  it("returns null for output that is not JSON", () => {
    expect(workspacePackages("ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND", ROOT)).toBeNull();
  });

  // `pnpm ls --json` reports its OWN failures as valid JSON on stdout (measured on pnpm 9.15.0 and
  // recorded in scripts/changed-scope.mjs's packagesInScope). It parses, so only the shape
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

/** `scopeForPaths`'s workspace argument, as a thunk that records whether it was called. */
const loader = (packages) => {
  const load = () => {
    load.called = true;
    return packages;
  };
  load.called = false;
  return load;
};

/** The common case: a workspace that is there when asked for. */
const workspace = (packages = WORKSPACE) => loader(packages);

describe("scopeForPaths", () => {
  it("attributes a source file to the package that owns it", () => {
    expect(scopeForPaths(["packages/db/src/index.ts"], workspace())).toMatchObject({
      kind: "packages",
      packages: ["@waitron/db"],
    });
  });

  it("attributes a file at a package's own root, not only under src/", () => {
    expect(scopeForPaths(["packages/db/package.json"], workspace()).packages).toEqual([
      "@waitron/db",
    ]);
  });

  it("deduplicates and sorts the packages it attributes", () => {
    expect(
      scopeForPaths(
        [
          "packages/payments/src/reconcile.ts",
          "packages/db/src/index.ts",
          "packages/db/src/schema.ts",
        ],
        workspace(),
      ).packages,
    ).toEqual(["@waitron/db", "@waitron/payments"]);
  });

  it("ignores blank lines, which a git diff pipe can produce", () => {
    expect(scopeForPaths(["packages/db/src/index.ts", "", "  "], workspace())).toMatchObject({
      kind: "packages",
      packages: ["@waitron/db"],
    });
  });

  // The whole point of the `global` outcome: these paths can affect anything, so nothing may be
  // narrowed away on account of them.
  it.each([
    ".github/workflows/ci.yml",
    "scripts/changed-scope.mjs",
    ".husky/pre-push",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
    "eslint.config.js",
    "vitest.config.ts",
    "package.json",
    "scripts/changed-packages.mjs",
  ])("reports a global run for %s, which belongs to no package", (path) => {
    expect(scopeForPaths([path], workspace()).kind).toBe("global");
  });

  // `kind` and the package list are not two answers to be combined by the caller — the list is
  // empty precisely so a caller that reads it without checking `kind` narrows to nothing rather
  // than to a plausible-looking subset.
  it("empties the package list when the run is global", () => {
    expect(scopeForPaths(["packages/db/src/index.ts", "tsconfig.base.json"], workspace())).toEqual({
      kind: "global",
      packages: [],
      reason: expect.stringContaining("tsconfig.base.json"),
    });
  });

  // Documentation must NOT force a global run. CLAUDE.md §7 tells every branch to update CLAUDE.md
  // and docs/backlog.md in the same change that makes them stale, so a rule that widened on any
  // docs/ path would widen on nearly every branch in this repository.
  it("does not let a documentation path widen the run", () => {
    expect(
      scopeForPaths(["docs/backlog.md", "CLAUDE.md", "packages/db/src/index.ts"], workspace()),
    ).toMatchObject({ kind: "packages", packages: ["@waitron/db"] });
  });

  // Root config no gate reads takes the documentation route rather than the global one. A push of
  // `.codex/config.toml` alone belongs to no package, so it landed on `global` and ran the whole
  // workspace.
  it("does not let root config no gate reads widen the run", () => {
    expect(scopeForPaths([".codex/config.toml"], workspace())).toMatchObject({
      kind: "documentation",
      packages: [],
    });
  });

  // THE distinction this function exists for. Its predecessor, packagesForPaths, returned the same
  // object for both — `{packages: [], global: true, reason: "no changed code path could be
  // determined — running everything"}` — so a documentation-only push read as "run everything", and
  // was only narrowed because the hook happened to consult a SECOND classifier first and exit. That
  // ordering contract lived in the shell, not here, so any other caller got it wrong by default.
  // The reason string was false in the docs case too: the paths WERE determined, they were prose.
  it("gives a documentation-only push its own outcome, distinct from an undetermined one", () => {
    const docs = scopeForPaths(["docs/backlog.md", "CLAUDE.md"], workspace());
    const undetermined = scopeForPaths([], workspace());

    expect(docs.kind).toBe("documentation");
    expect(undetermined.kind).toBe("global");
    expect(docs).not.toEqual(undetermined);
  });

  it("says the paths were documentation, not that they could not be determined", () => {
    expect(scopeForPaths(["docs/backlog.md", "CLAUDE.md"], workspace()).reason).toBe(
      "all 2 changed path(s) are documentation",
    );
    expect(scopeForPaths([], workspace()).reason).toBe(
      "no changed paths could be determined — running everything",
    );
  });

  // The measured reason for computing the documentation verdict FIRST: resolving the workspace
  // means `pnpm ls -r --depth -1 --json`, which cost 195ms of a 5.5s docs-path budget. A thunk, not
  // a value, is what lets this be asserted rather than reasoned about.
  it("does not read the workspace at all for a documentation-only push", () => {
    const load = workspace();
    expect(scopeForPaths(["docs/backlog.md", "CLAUDE.md"], load).kind).toBe("documentation");
    expect(load.called).toBe(false);
  });

  it("does not read the workspace when no changed path could be determined either", () => {
    const load = workspace();
    expect(scopeForPaths([""], load).kind).toBe("global");
    expect(load.called).toBe(false);
  });

  it("reads the workspace when there is a code path to attribute", () => {
    const load = workspace();
    scopeForPaths(["packages/db/src/index.ts"], load);
    expect(load.called).toBe(true);
  });

  // Same predicate as the docs gate, so the hook cannot classify a push as "has code work" and then
  // find no code path to attribute. isInertPath is imported from scripts/changed-scope.mjs
  // rather than reimplemented, which is what makes this hold by construction.
  it("treats exactly the paths classify() calls documentation as documentation", () => {
    const docsOnly = ["docs/superpowers/specs/x.md", "README.md"];
    expect(classify(docsOnly).code).toBe(false);
    expect(scopeForPaths(docsOnly, workspace()).kind).toBe("documentation");

    const code = [...docsOnly, "packages/verifactu/schemas/README.md"];
    expect(classify(code).code).toBe(true);
    expect(scopeForPaths(code, workspace()).kind).toBe("global");
  });

  // Fails CLOSED, the same principle as classify() and as the hook's own deletion guard: an empty
  // list means we could not work out what is being pushed, not that nothing is.
  it("fails closed when no changed path could be determined", () => {
    expect(scopeForPaths([], workspace())).toMatchObject({ kind: "global", packages: [] });
    expect(scopeForPaths([""], workspace())).toMatchObject({
      kind: "global",
      packages: [],
      reason: expect.stringMatching(/running everything/i),
    });
  });

  it("fails closed when the workspace could not be read", () => {
    expect(scopeForPaths(["packages/db/src/index.ts"], workspace(null))).toMatchObject({
      kind: "global",
      packages: [],
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
    expect(scopeForPaths(["packages/db-extra/src/a.ts"], workspace(dbOnly))).toMatchObject({
      kind: "global",
      packages: [],
    });
  });

  it("attributes the sibling once it IS a workspace member", () => {
    const both = workspacePackages(
      ls(member("@waitron/db", "packages/db"), member("@waitron/db-extra", "packages/db-extra")),
      ROOT,
    );
    expect(scopeForPaths(["packages/db-extra/src/a.ts"], workspace(both)).packages).toEqual([
      "@waitron/db-extra",
    ]);
  });

  // No workspace member contains another today, but pnpm-workspace.yaml is one line from making it
  // so, and the failure would be silent: the outer package's suite runs, the inner one's does not.
  it("attributes a nested package to the innermost directory that contains it", () => {
    const nested = workspacePackages(
      ls(member("@waitron/outer", "bench"), member("@waitron/inner", "bench/pglite-throughput")),
      ROOT,
    );
    expect(scopeForPaths(["bench/pglite-throughput/src/x.ts"], workspace(nested)).packages).toEqual(
      ["@waitron/inner"],
    );
    expect(scopeForPaths(["bench/other.ts"], workspace(nested)).packages).toEqual([
      "@waitron/outer",
    ]);
  });

  it("names the path that forced a global run", () => {
    expect(scopeForPaths([".husky/pre-push"], workspace()).reason).toContain(".husky/pre-push");
  });

  it("names the packages it attributed", () => {
    expect(scopeForPaths(["packages/db/src/index.ts"], workspace()).reason).toContain(
      "@waitron/db",
    );
  });
});

describe("formatScope", () => {
  it("emits the docs verdict, the outcome and the package list, in that order", () => {
    expect(formatScope(scopeForPaths(["packages/db/src/index.ts"], workspace()))).toBe(
      "code=true\nscope=packages\npackages=@waitron/db",
    );
  });

  it("emits an empty package list for a global run", () => {
    expect(formatScope(scopeForPaths([".husky/pre-push"], workspace()))).toBe(
      "code=true\nscope=global\npackages=",
    );
  });

  // The third outcome, which the hook reads to skip lint, typecheck and the tests while still
  // running format:check. It must not be spelled the same as a global run.
  it("emits its own line for a documentation-only push", () => {
    expect(formatScope(scopeForPaths(["docs/backlog.md"], workspace()))).toBe(
      "code=false\nscope=documentation\npackages=",
    );
  });

  // `code` is ci.yml's docs gate: `bundle-smoke`, `typecheck`, both test shards and both mutation
  // jobs are gated on it. It is the SAME verdict as `scope=documentation`, emitted here rather than
  // computed by the workflow's shell so the two cannot drift — that is the whole point of CI and the
  // hook sharing one classifier. Asserted as an equivalence, in both directions, rather than as two
  // separate expectations that could agree by accident.
  it.each([
    [["docs/backlog.md", "CLAUDE.md"], false],
    [["packages/db/src/index.ts"], true],
    [["tsconfig.base.json"], true],
    [[], true],
  ])("emits code=<classify's verdict> for %s", (paths, expected) => {
    const scope = scopeForPaths(paths, workspace());
    expect(formatScope(scope).split("\n")[0]).toBe(`code=${expected}`);
    expect(classify(paths).code).toBe(expected);
  });

  // The hook splits this on whitespace to build one `--filter "...<pkg>"` argument per name, so the
  // separator is part of the contract.
  it("separates several packages with a single space", () => {
    expect(
      formatScope(
        scopeForPaths(["packages/db/src/a.ts", "packages/payments/src/b.ts"], workspace()),
      ),
    ).toBe("code=true\nscope=packages\npackages=@waitron/db @waitron/payments");
  });
});

// A workspace member's `scripts` block, as the reader hands it back.
const declaring = (...names) => Object.fromEntries(names.map((name) => [name, "vitest run"]));

/** A reader that answers from a `{dir: scripts}` map, and `null` for anything else. */
const scriptsFor = (byDir) => (dir) => byDir[dir] ?? null;

describe("scriptRunCheck", () => {
  const members = [
    { name: "@waitron/db", dir: "packages/db" },
    { name: "@waitron/payments", dir: "packages/payments" },
  ];
  const bothDeclare = scriptsFor({
    "packages/db": declaring("test:coverage"),
    "packages/payments": declaring("test:coverage"),
  });

  it("passes when every selected package declares the script", () => {
    expect(scriptRunCheck(members, "test:coverage", bothDeclare)).toMatchObject({ ok: true });
  });

  it("names the script and the count in its reason", () => {
    const { reason } = scriptRunCheck(members, "test:coverage", bothDeclare);
    expect(reason).toContain("test:coverage");
    expect(reason).toContain("2");
  });

  // THE case this exists for, and the shape of the defect it closes. ci.yml used to resolve its
  // scope with `pnpm --filter "...[origin/$BASE_REF]"`, which answers a root-config change with the
  // workspace ROOT — and `pnpm --filter "waitron" --no-sort test:coverage` then selects nothing and
  // exits 0. workspacePackages drops the root by path, so the guard sees an empty selection.
  it("fails when the filter selected no workspace member at all", () => {
    expect(scriptRunCheck([], "test:coverage", bothDeclare)).toMatchObject({ ok: false });
    expect(scriptRunCheck([], "test:coverage", bothDeclare).reason).toMatch(/no workspace member/i);
  });

  // Fails CLOSED, but in the opposite direction from scopeForPaths: there, not knowing means run
  // everything; here, not knowing means we cannot claim anything ran, and a guard that cannot tell
  // must not report success. Both are the same principle — never be quietly green.
  it("fails when the workspace layout could not be read", () => {
    expect(scriptRunCheck(null, "test:coverage", bothDeclare)).toMatchObject({ ok: false });
  });

  // The reader answers `null` for `packages/payments`, which is not the same answer as `{}`:
  // "we could not look" is a reason to refuse, "it declares nothing" is a reason to look at the
  // exemption list.
  it("fails when a selected package's manifest could not be read", () => {
    const check = scriptRunCheck(
      members,
      "test:coverage",
      scriptsFor({ "packages/db": declaring("test:coverage") }),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("@waitron/payments");
    expect(check.reason).toContain("could not be read");
  });

  // The enforcement docs/backlog.md asked for: a member that declares no test script is a decision
  // someone has to make deliberately, not something that silently costs a shard its whole run.
  it("fails when a selected package declares no such script and is not exempt", () => {
    const check = scriptRunCheck(
      members,
      "test:coverage",
      scriptsFor({
        "packages/db": declaring("test:coverage"),
        "packages/payments": declaring("typecheck"),
      }),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("@waitron/payments");
    expect(check.reason).toContain("PACKAGES_WITHOUT_TESTS");
  });

  // @waitron/bench-pglite defines no test script and holds no *.test.ts, deliberately and for
  // documented reasons (bench/pglite-throughput/README.md). A push touching only it must not be
  // blocked by a guard whose whole purpose is elsewhere.
  it("passes when an exempt package declares no such script", () => {
    const withBench = [...members, { name: PACKAGES_WITHOUT_TESTS[0], dir: "bench/x" }];
    const check = scriptRunCheck(
      withBench,
      "test:coverage",
      scriptsFor({
        "packages/db": declaring("test:coverage"),
        "packages/payments": declaring("test:coverage"),
        "bench/x": declaring("bench"),
      }),
    );
    expect(check).toMatchObject({ ok: true });
  });

  // Nothing runs, and that is the honest answer rather than a failure — but it has to be SAID, or
  // the shard reports success with an empty log and no way to tell it apart from a real run.
  it("passes and says so when every selected package is exempt", () => {
    const check = scriptRunCheck(
      [{ name: PACKAGES_WITHOUT_TESTS[0], dir: "bench/x" }],
      "test:coverage",
      scriptsFor({ "bench/x": declaring("bench") }),
    );
    expect(check.ok).toBe(true);
    expect(check.reason).toMatch(/nothing to run/i);
    expect(check.reason).toContain(PACKAGES_WITHOUT_TESTS[0]);
  });
});

// The CLI is only reachable by running the file, so these spawn it. What they add over the unit
// tests above is what no exported function can show: that it resolves the REAL workspace by running
// `pnpm ls -r --depth -1 --json` itself, and that the two streams stay apart — the hook reads
// stdout with `sed -n 's/^scope=//p'` and `sed -n 's/^packages=//p'`, so a stray line there that
// happened to start with either prefix would become a bogus scope.
describe("the CLI", () => {
  const repoRoot = join(import.meta.dirname, "..");
  const script = join(import.meta.dirname, "changed-packages.mjs");

  /** Runs the script with `input` on stdin, from the repository root, keeping its streams apart. */
  const run = (input, ...args) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      input,
      encoding: "utf8",
      cwd: repoRoot,
    });
    expect(result.status).toBe(0);
    return result;
  };

  it("resolves this workspace and attributes a real package directory", () => {
    expect(run("packages/db/src/index.ts\n").stdout).toBe(
      "code=true\nscope=packages\npackages=@waitron/db\n",
    );
  });

  it("attributes several real package directories", () => {
    expect(run("packages/db/src/index.ts\napps/server/src/boot.ts\n").stdout).toBe(
      "code=true\nscope=packages\npackages=@waitron/db @waitron/server\n",
    );
  });

  it("reports a global run for root configuration", () => {
    expect(run("tsconfig.base.json\n").stdout).toBe("code=true\nscope=global\npackages=\n");
  });

  it("reports a documentation-only push through the CLI too", () => {
    expect(run("docs/backlog.md\nCLAUDE.md\n").stdout).toBe(
      "code=false\nscope=documentation\npackages=\n",
    );
  });

  it("fails closed on empty stdin", () => {
    expect(run("").stdout).toBe("code=true\nscope=global\npackages=\n");
    expect(run("\n").stdout).toBe("code=true\nscope=global\npackages=\n");
  });

  it("puts the reason on stderr, where the hook's sed cannot reach it", () => {
    const { stdout, stderr } = run("packages/db/src/index.ts\n");
    expect(stderr).toContain("@waitron/db");
    expect(stdout).not.toContain("changed-packages:");
  });
});

// The guard both test shards and the hook run before `pnpm <filters> test:coverage`. It reads a
// `pnpm <the same filters> ls --depth -1 --json` result and answers with an EXIT CODE, which is the
// only part of it the shell can act on — so these spawn it rather than calling scriptRunCheck.
//
// Every input below is a real path in this checkout, because the reader this CLI passes in is
// `readFileSync` on `<dir>/package.json`: pointing it at a fabricated directory would only ever
// exercise the unreadable-manifest branch.
describe("the runnable CLI", () => {
  const repoRoot = join(import.meta.dirname, "..");
  const script = join(import.meta.dirname, "changed-packages.mjs");

  /** One `pnpm ls --depth -1 --json` entry, with an absolute path as pnpm emits. */
  const entry = (name, dir) => ({ name, version: "0.0.0", path: join(repoRoot, dir) });

  const runnable = (entries) =>
    spawnSync(process.execPath, [script, "runnable", "test:coverage"], {
      input: JSON.stringify(entries),
      encoding: "utf8",
      cwd: repoRoot,
    });

  it("exits 0 when a selected package really declares test:coverage", () => {
    const result = runnable([entry("@waitron/db", "packages/db")]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("test:coverage");
  });

  // The defect this branch closes, end to end: `pnpm --filter "...[origin/main]"` answered a
  // root-config-only pull request with the workspace root alone, and the light shard's
  // `pnpm --filter "waitron" --no-sort test:coverage` then printed `No projects matched the filters`
  // and exited 0. Run in this workspace on 2026-08-01 — `pnpm --filter "waitron" --no-sort
  // format:check` prints exactly that and exits 0.
  it("exits 1 for a selection that is the workspace root and nothing else", () => {
    const result = runnable([{ name: "waitron", version: "0.0.0", path: repoRoot }]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no workspace member/i);
  });

  // `pnpm ls` emits zero bytes on both streams, exit 0, when its filter matches nothing. The guard
  // has to read that as "nothing would run", not as "no packages needed running".
  it("exits 1 on an empty pnpm ls result", () => {
    const empty = spawnSync(process.execPath, [script, "runnable", "test:coverage"], {
      input: "",
      encoding: "utf8",
      cwd: repoRoot,
    });
    expect(empty.status).toBe(1);
  });

  it("exits 0 when the only selected package is the exempt one", () => {
    const result = runnable([entry(PACKAGES_WITHOUT_TESTS[0], "bench/pglite-throughput")]);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/nothing to run/i);
  });

  // Same real directory, a name that is not on the exemption list — which is what a NEW member with
  // no test:coverage script would look like.
  it("exits 1 for an unexempt package that declares no test:coverage script", () => {
    const result = runnable([entry("@waitron/newcomer", "bench/pglite-throughput")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@waitron/newcomer");
  });

  it("exits 1 when a selected package's manifest cannot be read", () => {
    const result = runnable([entry("@waitron/gone", "packages/does-not-exist")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@waitron/gone");
  });
});
