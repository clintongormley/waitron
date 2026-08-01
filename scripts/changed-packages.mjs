import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { classify, isInertPath } from "./changed-scope.mjs";

// Answers, in ONE call, the only question `.husky/pre-push` asks about a push's changed paths: is
// this documentation, is it something that could reach anything, or is it a specific set of
// packages? CI answers the package half with pnpm's own changed-since filter
// (`--filter "...[origin/main]"`, ci.yml's `changes` job); this file exists because that filter
// CANNOT be used here.
//
// Run in both directions on 2026-07-31, pnpm 9.15.0, one commit touching `packages/db/README.md`
// on top of `main`, and the identical two commands in each place:
//
//   git diff --name-only main...HEAD          → packages/db/README.md   (both)
//   pnpm --filter "...[main]" ls --depth -1 --json
//     in a `git worktree add`ed checkout      → 0 bytes, exit 0
//     in a plain `git clone` of the same repo → 2760 bytes, 11 packages
//
// Zero bytes and exit 0 is the same output pnpm gives for a filter that matched nothing, so in a
// worktree it reads as "no package is affected" rather than as an error, while git in the SAME
// directory reports the changed path perfectly well. (Why pnpm's own change detection behaves
// differently there was not established — only that it does.) Every branch in this repository is
// developed in a `git worktree` (CLAUDE.md §6), so a hook built on that filter would narrow every
// push to nothing and run no tests at all. Mapping paths to package directories ourselves is not a
// reimplementation of pnpm's filter for its own sake: it is the only half of it that works here.
// The OTHER half — expanding a changed package to its dependents — is still pnpm's, via the
// `--filter "...<pkg>"` arguments the hook builds from this file's output.
//
// The unit this works in is the package DIRECTORY, not the package graph: a path is attributed to
// the innermost workspace member that contains it, and anything that lands outside every member is
// GLOBAL — it could affect anything, so nothing may be narrowed away on account of it.

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
 * Renders a scope as the two lines the hook reads.
 *
 * A single space separates the package names, and that separator is the contract between this file
 * and the hook, asserted as such below. The hook still WORD-SPLITS this line — `for pkg in
 * $scope_packages` — so a name containing whitespace would still come apart into two filters. What
 * changed is what happens after the split: each word is appended with `set -- "$@" --filter
 * "...$pkg"` rather than concatenated into a string for `eval`, so there is no second shell pass to
 * reinterpret a quote, a `$`, a backtick or a glob in a name.
 */
export function formatScope({ kind, packages }) {
  return `scope=${kind}\npackages=${packages.join(" ")}`;
}

// CLI: changed paths on stdin, one per line → two `<name>=<value>` lines on stdout.
//
// The workspace layout is resolved HERE rather than passed in, because the two inputs cannot share
// stdin and threading a JSON document through argv or a temporary file buys nothing. A `pnpm ls`
// that fails for any reason — not installed, not a workspace, killed — leaves `stdout` null or
// empty, which `workspacePackages` reads as `null` and `scopeForPaths` turns into a global run.
//
// It runs `pnpm ls` from inside the thunk, so a documentation-only push never pays for it. That it
// runs at all without `pnpm install` having happened first — the hook now classifies BEFORE
// installing — was measured rather than assumed: in a `git clone --no-hardlinks` of the main
// checkout, with no `node_modules` directory anywhere in it, `pnpm ls -r --depth -1 --json` exited 0
// with 3917 bytes on stdout, nothing on stderr, and all 16 entries (2026-08-01, pnpm 9.15.0).
//
// stdout carries the two lines and NOTHING else: the hook reads it with `sed -n 's/^scope=//p'` and
// `sed -n 's/^packages=//p'`, so a stray line that happened to carry either prefix would become a
// bogus scope. The human-readable reason goes to stderr, where the hook prints it for whoever is
// watching the push.
//
// Ignored for coverage because the tests run it in a CHILD process, and the v8 provider only
// measures the module graph loaded into the test process — so this block reads as 0% however
// thoroughly it is exercised. Ignored for being unmeasurable, not for being untested: delete the
// `describe("the CLI")` suite and six assertions about this block go with it, including the only
// two that run the real `pnpm ls` against the real workspace.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("changed-packages.mjs")) {
  const scope = scopeForPaths(readFileSync(0, "utf8").split("\n"), () => {
    const ls = spawnSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], { encoding: "utf8" });
    return workspacePackages(ls.stdout ?? "", process.cwd());
  });

  console.error(`changed-packages: ${scope.reason}`);
  console.log(formatScope(scope));
}
/* v8 ignore stop */
