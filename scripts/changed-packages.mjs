import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { isInertPath } from "../.github/scripts/changed-scope.mjs";

// Maps a push's changed paths onto workspace packages, so `.husky/pre-push` can typecheck and test
// only what the push can reach. CI answers the same question with pnpm's own changed-since filter
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
 * `packagesInScope` keeps in .github/scripts/changed-scope.mjs: `null` is "we do not know", which
 * `packagesForPaths` turns into a global run, while an empty array would be the definite answer
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

    const dir = relative(root, resolve(entry.path));

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
 * Maps a push's changed paths onto the packages that must be typechecked and tested.
 *
 * Returns `{ packages, global, reason }`. When `global` is true the package list is EMPTY rather
 * than partial — a caller that reads the list without checking the flag then narrows to nothing
 * visible instead of to a plausible-looking subset.
 *
 * Fails closed in three ways, all of them onto a global run:
 *
 *   - the workspace could not be read (`packages` is `null`);
 *   - no changed path could be determined — the hook could work out no push range, so it does not
 *     know what is being pushed. Same principle as `classify` in changed-scope.mjs and as the
 *     deletion guard in the hook itself;
 *   - a path lands outside every package: `.github/`, `.husky/`, `scripts/`, `pnpm-workspace.yaml`,
 *     `tsconfig.base.json`, the root manifest and lockfile. Those can affect anything.
 *
 * DOCUMENTATION is dropped before attribution rather than making the run global, and that is a
 * deliberate exception with a cost if it is got wrong. `isInertPath` is imported from
 * .github/scripts/changed-scope.mjs rather than reimplemented, so "what counts as documentation"
 * has exactly one definition and the hook cannot classify a push as having code work and then find
 * no code path to attribute. Without the exception a global run would be the common case, not the
 * rare one: CLAUDE.md §7 and docs/backlog.md's own closing section both tell every branch to update
 * those files in the change that makes them stale, so nearly every push in this repository carries
 * a `docs/` or root-Markdown path.
 */
export function packagesForPaths(changedPaths, packages) {
  if (packages === null) {
    return {
      packages: [],
      global: true,
      reason: "the workspace layout could not be read — running everything",
    };
  }

  const meaningful = changedPaths
    .map((path) => path.trim())
    .filter((path) => path.length > 0 && !isInertPath(path));

  if (meaningful.length === 0) {
    return {
      packages: [],
      global: true,
      reason: "no changed code path could be determined — running everything",
    };
  }

  const attributed = new Set();

  for (const path of meaningful) {
    const owner = owningPackage(path, packages);
    if (owner === undefined) {
      return {
        packages: [],
        global: true,
        reason: `${path} belongs to no package — running everything`,
      };
    }
    attributed.add(owner.name);
  }

  const names = [...attributed].sort();
  return {
    packages: names,
    global: false,
    reason: `${meaningful.length} changed code path(s) map to ${names.join(", ")}`,
  };
}

/**
 * Renders a scope as the two lines the hook reads.
 *
 * A single space separates the package names, because the hook splits the line on whitespace to
 * build one `--filter "...<pkg>"` argument per name. Workspace package names carry no whitespace
 * and no shell glob characters (`pnpm ls -r --depth -1 --json` in this worktree on 2026-07-31: all
 * fifteen members are `@waitron/<lowercase-and-hyphens>`), which is what makes that split safe.
 */
export function formatScope({ packages, global }) {
  return `global=${global}\npackages=${packages.join(" ")}`;
}

// CLI: changed paths on stdin, one per line → two `<name>=<value>` lines on stdout.
//
// The workspace layout is resolved HERE rather than passed in, because the two inputs cannot share
// stdin and threading a JSON document through argv or a temporary file buys nothing. A `pnpm ls`
// that fails for any reason — not installed, not a workspace, killed — leaves `stdout` null or
// empty, which `workspacePackages` reads as `null` and `packagesForPaths` turns into a global run.
//
// stdout carries the two lines and NOTHING else: the hook reads it with `grep`/`cut`, so a stray
// line there becomes a bogus scope. The human-readable reason goes to stderr, where the hook prints
// it for whoever is watching the push.
//
// Ignored for coverage because the tests run it in a CHILD process, and the v8 provider only
// measures the module graph loaded into the test process — so this block reads as 0% however
// thoroughly it is exercised. Ignored for being unmeasurable, not for being untested: delete the
// `describe("the CLI")` suite and five assertions about this block go with it, including the only
// two that run the real `pnpm ls` against the real workspace.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("changed-packages.mjs")) {
  const ls = spawnSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], { encoding: "utf8" });
  const scope = packagesForPaths(
    readFileSync(0, "utf8").split("\n"),
    workspacePackages(ls.stdout ?? "", process.cwd()),
  );

  console.error(`changed-packages: ${scope.reason}`);
  console.log(formatScope(scope));
}
/* v8 ignore stop */
