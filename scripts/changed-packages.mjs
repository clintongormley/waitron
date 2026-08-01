import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { PACKAGES_WITHOUT_TESTS, classify, isInertPath } from "./changed-scope.mjs";

// Answers, in ONE call, the only question either gate asks about a diff: is this documentation, is
// it something that could reach anything, or is it a specific set of packages? BOTH gates ask it
// here — `.husky/pre-push` about a push's range, ci.yml's `changes` job about a pull request's —
// which is the point. Two mechanisms answering the same question is two mechanisms that can drift,
// and the one CI used to run drifted in the silent direction; docs/backlog.md's entry on it has the
// receipts.
//
// pnpm's own changed-since filter is what CI ran, and it CANNOT be the shared mechanism, for two
// independent reasons — the second is the defect, the first is why the hook never used it:
//
//   1. It reports nothing in a `git worktree`. Run in both directions on 2026-07-31, pnpm 9.15.0,
//      one commit touching `packages/db/README.md` on top of `main`, the identical two commands in
//      each place:
//
//        git diff --name-only main...HEAD          → packages/db/README.md   (both)
//        pnpm --filter "...[main]" ls --depth -1 --json
//          in a `git worktree add`ed checkout      → 0 bytes, exit 0
//          in a plain `git clone` of the same repo → 2760 bytes, 11 packages
//
//      Zero bytes and exit 0 is the same output pnpm gives for a filter that matched nothing, so in
//      a worktree it reads as "no package is affected" rather than as an error, while git in the
//      SAME directory reports the changed path perfectly well. (Why pnpm's own change detection
//      behaves differently there was not established — only that it does.) Every branch in this
//      repository is developed in a `git worktree` (CLAUDE.md §6).
//
//   2. It attributes a path belonging to NO workspace member — `tsconfig.base.json`,
//      `pnpm-lock.yaml`, `.github/**` — to the workspace ROOT, which is a package that runs no
//      tests. Run on 2026-08-01 in a `git clone --no-hardlinks` of this repository, one commit
//      touching `tsconfig.base.json` on top of `main`: `pnpm --filter "...[main]" ls --depth -1
//      --json` printed exactly one entry, `{"name": "waitron"}`. That is the WRONG DIRECTION for a
//      gate — the change every package inherits, resolved to the narrowest possible scope.
//
// So the attribution is ours and it fails CLOSED. The unit it works in is the package DIRECTORY,
// not the package graph: a path is attributed to the innermost workspace member that contains it,
// and anything that lands outside every member is GLOBAL — it could affect anything, so nothing may
// be narrowed away on account of it. The OTHER half — expanding a changed package to its
// dependents — is still pnpm's, via the `--filter "...<pkg>"` arguments both callers build from
// this file's output.

/**
 * The workspace's members as `{name, dir}`, `dir` being relative to `repoRoot` — or `null` when the
 * input cannot be read, which every caller treats as a reason to run everything.
 *
 * Input is the stdout of `pnpm ls -r --depth -1 --json`. Run in this worktree on 2026-07-31 that is
 * 16 entries: the fifteen workspace members plus the workspace ROOT, whose `name` is `waitron` and
 * whose `path` is the repository root itself. The root is dropped here rather than by name, because
 * a member's name is a manifest field anyone can change while its path is a fact about the tree.
 *
 * `null` and the empty array are deliberately different answers, the same distinction
 * `packagesInScope` keeps in scripts/changed-scope.mjs: `null` is "we do not know", which
 * `scopeForPaths` turns into a global run, while an empty array would be the definite answer
 * "this workspace has no members".
 *
 * The `Array.isArray` and per-entry type checks are what separate a real result from pnpm reporting
 * its OWN failure — which it does as valid JSON on stdout, not as a diagnostic on stderr (measured
 * on pnpm 9.15.0; the transcript is in changed-scope.mjs's packagesInScope). Getting that wrong
 * reads a pnpm failure as "no packages exist", attributes every path to nothing, and lands on a
 * global run — which is at least the safe direction here, but by accident rather than by design.
 */
export function workspacePackages(pnpmLsJson, repoRoot) {
  const raw = pnpmLsJson.trim();
  if (raw === "") return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const root = resolve(repoRoot);
  const members = [];

  for (const entry of parsed) {
    if (typeof entry?.name !== "string" || typeof entry?.path !== "string") return null;

    // `relative` returns platform-native separators, and every comparison downstream is against a
    // path from `git diff --name-only`, which is always `/`-delimited on every platform. On a
    // separator where `sep` is not `/` the two could never match, so `owningPackage` would attribute
    // nothing and every push would fall back to a global run — scoping silently switched off rather
    // than broken, which is the quiet direction.
    //
    // Not a bug reachable today: CI is `ubuntu-latest`, the hook is POSIX `sh` run by husky, and
    // `sep` is `/` on both. Verified only on darwin, where `relative()` already returns `/` and this
    // join is a no-op — so this normalises the comparison rather than adding Windows support, which
    // nothing here tests. Raised by Copilot on PR #31.
    const dir = relative(root, resolve(entry.path)).split(sep).join("/");

    // The workspace root: `pnpm ls -r` lists it alongside the members, and it "contains" every path
    // in the repository, so leaving it in would attribute the whole diff to it and never report a
    // global run at all.
    if (dir === "") continue;

    // A member outside the checkout owns no path in this diff, and `relative` walks upwards to say
    // so. Dropping it silently would attribute its files to nothing — indistinguishable from a root
    // config change — so the whole read fails closed instead.
    if (dir === ".." || dir.startsWith("../")) return null;

    members.push({ name: entry.name, dir });
  }

  return members;
}

/**
 * The innermost workspace member containing `path`, or `undefined`.
 *
 * Innermost, not first: nothing in this workspace nests today (checked against
 * `pnpm ls -r --depth -1 --json` on 2026-07-31 — no member's directory is a prefix of another's),
 * but one line in pnpm-workspace.yaml would change that, and the failure would be silent in the
 * dangerous direction: the outer package's suite runs, the inner one's does not.
 *
 * The trailing slash is what makes this a directory test rather than a string-prefix test, and the
 * case it catches is narrower than it first looks. Established by deletion, twice. Against the
 * first version of the test — `packages/db` AND `packages/db-extra` both workspace members — a bare
 * `startsWith(pkg.dir)` matched both, the innermost rule above picked the longer, and the whole
 * suite still passed: the right answer for the wrong reason. What actually breaks is a sibling
 * directory that is NOT a member. `packages/db-extra/src/a.ts` then matches `packages/db` alone and
 * is attributed to `@waitron/db`, whose suite passes, instead of widening the run to global — and
 * with the test rewritten to that shape, deleting the slash fails it and nothing else.
 */
function owningPackage(path, packages) {
  let owner;
  for (const pkg of packages) {
    if (!path.startsWith(`${pkg.dir}/`)) continue;
    if (owner === undefined || pkg.dir.length > owner.dir.length) owner = pkg;
  }
  return owner;
}

/**
 * The whole verdict on a push's changed paths, from ONE call: `{ kind, packages, reason }`, where
 * `kind` is one of THREE outcomes and the hook does something different for each.
 *
 *   "documentation"  every changed path is prose. format:check still reads it (`.prettierignore`
 *                    excludes `docs/` but NOT a root-level `CLAUDE.md` or `README.md` — run here on
 *                    2026-08-01: `prettier --file-info docs/backlog.md` is `"ignored": true`,
 *                    `--file-info CLAUDE.md` is `"ignored": false, "inferredParser": "markdown"`,
 *                    and appending a mis-formatted heading to CLAUDE.md makes `prettier --check`
 *                    exit 1). Nothing else can read it.
 *   "global"         run everything: a path outside every package, an unreadable workspace, or a
 *                    push whose contents could not be determined at all.
 *   "packages"       `packages` names the members to narrow to. Non-empty exactly here.
 *
 * The predecessor returned ONE object for the first two — `{packages: [], global: true, reason: "no
 * changed code path could be determined — running everything"}` — so a documentation-only push read
 * as "run everything" from this module, and was narrowed only because the hook consulted a SECOND
 * classifier first and exited before asking. That ordering contract lived in the shell rather than
 * here, so any other caller got it wrong by default; and the reason string was false in the docs
 * case, because the paths WERE determined, they were prose.
 *
 * `loadPackages` is a THUNK, not a value, and the documentation and undetermined outcomes return
 * without calling it. The hook's thunk shells out to `pnpm ls -r --depth -1 --json`: timed here on
 * 2026-08-01 by wrapping ten `subprocess.run` calls in `time.time()`, that command took 191-200ms
 * every time, which a docs-only push has no use for. `scripts/changed-packages.test.mjs` asserts
 * the thunk is untouched on both outcomes, so that is a tested property rather than a reading of
 * the control flow.
 *
 * DOCUMENTATION is decided by `classify` from scripts/changed-scope.mjs — the same function
 * CI's docs gate calls — and the per-path filter below by that module's `isInertPath`, so "what
 * counts as documentation" has exactly one definition and this cannot report code work and then
 * find no code path to attribute. Without the exception a global run would be the common case, not
 * the rare one: CLAUDE.md §7 and docs/backlog.md's own closing section both tell every branch to
 * update those files in the change that makes them stale, so nearly every push in this repository
 * carries a `docs/` or root-Markdown path.
 *
 * When `kind` is not "packages" the list is EMPTY rather than partial, so a caller that reads it
 * without checking `kind` narrows to nothing visible instead of to a plausible-looking subset.
 */
export function scopeForPaths(changedPaths, loadPackages) {
  const meaningful = changedPaths.map((path) => path.trim()).filter((path) => path.length > 0);
  const { code, reason } = classify(meaningful);

  // Prose only. `classify`'s own reason already says so — "all N changed path(s) are documentation".
  if (!code) return { kind: "documentation", packages: [], reason };

  // Fails CLOSED, the same principle as `classify` itself and as the hook's deletion guard: an empty
  // list means we could not work out what is being pushed, not that nothing is. `classify` says
  // "no changed paths could be determined — running everything", which is what this does.
  if (meaningful.length === 0) return { kind: "global", packages: [], reason };

  const packages = loadPackages();
  if (packages === null) {
    return {
      kind: "global",
      packages: [],
      reason: "the workspace layout could not be read — running everything",
    };
  }

  const codePaths = meaningful.filter((path) => !isInertPath(path));
  const attributed = new Set();

  for (const path of codePaths) {
    const owner = owningPackage(path, packages);
    // `.github/`, `.husky/`, `scripts/`, `pnpm-workspace.yaml`, `tsconfig.base.json`, the root
    // manifest and the lockfile all land here. Those can affect anything.
    if (owner === undefined) {
      return {
        kind: "global",
        packages: [],
        reason: `${path} belongs to no package — running everything`,
      };
    }
    attributed.add(owner.name);
  }

  const names = [...attributed].sort();
  return {
    kind: "packages",
    packages: names,
    reason: `${codePaths.length} changed code path(s) map to ${names.join(", ")}`,
  };
}

/**
 * Renders a scope as the three lines its two callers read.
 *
 * `code` is ci.yml's documentation gate — `bundle-smoke`, `typecheck`, both test shards and both
 * mutation jobs are gated on it — and it is the SAME verdict as `kind === "documentation"`, which
 * is why it is emitted from here rather than recomputed by the workflow's shell. ci.yml appends all
 * three lines straight to `$GITHUB_OUTPUT`; the hook reads two of them with `sed` and ignores this
 * one, because a documentation-only push is `scope=documentation` to it.
 *
 * A single space separates the package names, and that separator is the contract between this file
 * and its callers, asserted as such below. Both still WORD-SPLIT that line — `for pkg in
 * $scope_packages` — so a name containing whitespace would still come apart into two filters. What
 * they do after the split is append each word with `set -- "$@" --filter "...$pkg"` rather than
 * concatenating into a string for `eval`, so there is no second shell pass to reinterpret a quote,
 * a `$`, a backtick or a glob in a name.
 */
export function formatScope({ kind, packages }) {
  return `code=${kind !== "documentation"}\nscope=${kind}\npackages=${packages.join(" ")}`;
}

/**
 * Whether `pnpm <filters> <script>` will actually run something, given the `pnpm <the same filters>
 * ls --depth -1 --json` result already read by `workspacePackages` — `{ok, reason}`.
 *
 * This exists because pnpm answers "nothing to do" with SUCCESS, in two different ways, both
 * measured in this workspace on 2026-08-01 (pnpm 9.15.0), both on STDOUT and both exit **0**:
 *
 *   pnpm --filter "@waitron/nope" test:coverage          → No projects matched the filters in "…"
 *   pnpm --filter "...@waitron/bench-pglite" test:cov…   → None of the selected packages has a
 *                                                          "test:coverage" script
 *
 * A shard that printed either and reported green is the failure this branch exists to close: with
 * `pnpm --filter "...[origin/main]"` resolving a root-config change to the workspace ROOT, the
 * light shard's `pnpm --filter "waitron" --no-sort test:coverage` was the first of those. The
 * message is not what is checked here — a wording change would silently switch the guard off, which
 * is the quiet direction — the SELECTION is.
 *
 * Fails closed, which for a guard means the opposite of what it means in `scopeForPaths`: not
 * knowing there means run everything, and not knowing here means refuse to claim anything ran. So
 * an unreadable workspace, an unreadable manifest and an empty selection are all failures.
 *
 * `readScripts(dir)` returns that member's `scripts` object (`{}` if it declares none) or `null`
 * when the manifest could not be read at all.
 */
export function scriptRunCheck(members, script, readScripts) {
  if (members === null) {
    return {
      ok: false,
      reason: `the workspace layout could not be read — cannot tell whether ${script} would run anything`,
    };
  }

  if (members.length === 0) {
    return {
      ok: false,
      reason: `no workspace member was selected — "${script}" would run nothing`,
    };
  }

  const running = [];
  const skipped = [];

  for (const member of members) {
    const scripts = readScripts(member.dir);
    if (scripts === null) {
      return { ok: false, reason: `${member.name}: ${member.dir}/package.json could not be read` };
    }

    if (scripts[script] !== undefined) running.push(member.name);
    else if (PACKAGES_WITHOUT_TESTS.includes(member.name)) skipped.push(member.name);
    else {
      return {
        ok: false,
        reason:
          `${member.name} is selected but declares no "${script}" script. Add one, or — if it ` +
          `deliberately has no tests — add it to PACKAGES_WITHOUT_TESTS in scripts/changed-scope.mjs`,
      };
    }
  }

  if (running.length === 0) {
    return {
      ok: true,
      reason: `nothing to run: no tests declared in ${skipped.join(", ")}, by design`,
    };
  }

  const note =
    skipped.length === 0 ? "" : ` (no tests declared in ${skipped.join(", ")}, by design)`;
  return { ok: true, reason: `${running.length} selected package(s) declare "${script}"${note}` };
}

// CLI, two shapes:
//
//   node scripts/changed-packages.mjs
//     changed paths on stdin, one per line → three `<name>=<value>` lines on stdout.
//   node scripts/changed-packages.mjs runnable <script>
//     a `pnpm <filters> ls --depth -1 --json` result on stdin → nothing on stdout, and an EXIT CODE
//     that is 1 when that selection would run no `<script>` at all. The exit code is the only part
//     of it a shell step can act on, which is why this is a subcommand rather than a fourth line.
//
// The workspace layout is resolved HERE rather than passed in, because the two inputs cannot share
// stdin and threading a JSON document through argv or a temporary file buys nothing. A `pnpm ls`
// that fails for any reason — not installed, not a workspace, killed — leaves `stdout` null or
// empty, which `workspacePackages` reads as `null` and `scopeForPaths` turns into a global run.
//
// It runs `pnpm ls` from inside the thunk, so a documentation-only push never pays for it. That it
// runs at all without `pnpm install` having happened first — the hook now classifies BEFORE
// installing, and ci.yml's `changes` job never installs at all — was measured rather than assumed:
// in a `git clone --no-hardlinks` of the main checkout, with no `node_modules` directory anywhere in
// it, `pnpm ls -r --depth -1 --json` exited 0 with 3917 bytes on stdout, nothing on stderr, and all
// 16 entries (2026-08-01, pnpm 9.15.0).
//
// stdout carries the three lines and NOTHING else: ci.yml appends it straight to `$GITHUB_OUTPUT`
// and the hook reads it with `sed -n 's/^scope=//p'` and `sed -n 's/^packages=//p'`, so a stray line
// that happened to carry a prefix would become a bogus job output or a bogus scope. The
// human-readable reason goes to stderr, where both print it for whoever is watching.
//
// Ignored for coverage because the tests run it in a CHILD process, and the v8 provider only
// measures the module graph loaded into the test process — so this block reads as 0% however
// thoroughly it is exercised. Ignored for being unmeasurable, not for being untested: delete the
// two `describe("… CLI")` suites and thirteen assertions about this block go with it, including the
// only ones that run the real `pnpm ls` against the real workspace.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("changed-packages.mjs")) {
  const stdin = () => readFileSync(0, "utf8");

  if (process.argv[2] === "runnable") {
    const script = process.argv[3];
    const check = scriptRunCheck(
      workspacePackages(stdin(), process.cwd()),
      script,
      // `null` on ANY read failure — a missing directory, a manifest that is not JSON — because
      // "we could not look" and "it declares nothing" are different answers and only one of them
      // is a reason to let the run proceed.
      (dir) => {
        try {
          return (
            JSON.parse(readFileSync(join(process.cwd(), dir, "package.json"), "utf8")).scripts ?? {}
          );
        } catch {
          return null;
        }
      },
    );

    console.error(`changed-packages: ${check.reason}`);
    process.exit(check.ok ? 0 : 1);
  }

  const scope = scopeForPaths(stdin().split("\n"), () => {
    const ls = spawnSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], { encoding: "utf8" });
    return workspacePackages(ls.stdout ?? "", process.cwd());
  });

  console.error(`changed-packages: ${scope.reason}`);
  console.log(formatScope(scope));
}
/* v8 ignore stop */
