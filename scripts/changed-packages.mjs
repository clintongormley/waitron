import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  PACKAGES_WITHOUT_TESTS,
  ROOT_SCOPE_CONSUMERS,
  classify,
  isImageInputPath,
  isInertPath,
  isRootScopePath,
} from "./changed-scope.mjs";

// Answers, in ONE call, the only question either gate asks about a diff: is this documentation, is
// it something that could reach anything, or is it a specific set of packages? BOTH gates ask it
// here — `.husky/pre-push` about a push's range, ci.yml's `changes` job about a pull request's — so
// the two cannot drift apart.
//
// pnpm's own changed-since filter cannot be that mechanism: it reports nothing in a `git worktree`
// (zero bytes and exit 0, the same output as a filter that matched nothing), and it attributes a
// path belonging to NO workspace member, such as `tsconfig.base.json`, to the workspace ROOT, which
// runs no tests.
//
// So the attribution is ours and it fails CLOSED: a path is attributed to the innermost workspace
// member DIRECTORY that contains it, and anything outside every member is GLOBAL. Expanding a changed
// package to its dependents is still pnpm's, via the `--filter "...<pkg>"` arguments both callers
// build from this file's output.

/**
 * The workspace's members as `{name, dir}`, `dir` being relative to `repoRoot` — or `null` when the
 * input cannot be read.
 *
 * The two callers fail closed on that `null` in OPPOSITE directions: `scopeForPaths` runs
 * everything, and `scriptRunCheck` refuses, because a guard that cannot tell whether a run happened
 * must not report that one did.
 *
 * Input is the stdout of `pnpm ls -r --depth -1 --json`, which also lists the workspace ROOT. The
 * root is dropped by path rather than by name, because a member's name is a manifest field anyone can
 * change while its path is a fact about the tree.
 *
 * The `Array.isArray` and per-entry type checks separate a real result from pnpm reporting its OWN
 * failure, which it does as valid JSON on stdout (see changed-scope.mjs's packagesInScope).
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

    // `relative` returns platform-native separators, while every path it is compared with comes from
    // `git diff --name-only`, which is always `/`-delimited. Where they differ nothing would ever be
    // attributed, and every push would silently fall back to a global run.
    const dir = relative(root, resolve(entry.path)).split(sep).join("/");

    // The workspace root "contains" every path, so leaving it in would attribute the whole diff to
    // it and never report a global run at all.
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
 * Innermost, not first: no member's directory contains another's today, but one line in
 * pnpm-workspace.yaml would make a real nesting, and the failure would be silent in the dangerous
 * direction: the outer package's suite runs, the inner one's does not.
 *
 * The trailing slash makes this a directory test rather than a string-prefix test. The case it
 * catches is a sibling directory that is NOT a member: without it, `packages/db-extra/src/a.ts` would
 * be attributed to `@waitron/db` instead of widening the run to global.
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
 * The whole verdict on a push's changed paths, from ONE call:
 * `{ kind, packages, root, deploy, reason }`, where `kind` is one of FOUR outcomes and the hook
 * does something different for each.
 *
 *   "documentation"  every changed path is inert (see `isInertPath`).
 *   "root"           every changed CODE path is the repository's own machinery (`isRootScopePath`)
 *                    and none is a file `ROOT_SCOPE_CONSUMERS` lists. The repo-level Vitest
 *                    project is the only suite that runs; no package is typechecked or tested.
 *   "global"         run everything: a path outside every package that is not root scope, an
 *                    unreadable workspace, or a push whose contents could not be determined at all.
 *   "packages"       `packages` names the members to narrow to. Non-empty exactly here.
 *
 * `root` and `deploy` are orthogonal to `kind`. `root` is true whenever ANY changed path is root
 * scope, so a push of `scripts/x.mjs` beside `packages/db/src/y.ts` is `kind: "packages"` with
 * `root: true`. `deploy` is true whenever a changed path is one of the box image's inputs
 * (`isImageInputPath`).
 *
 * `loadPackages` is a THUNK, not a value: the hook's thunk shells out to `pnpm ls -r`, and the
 * documentation, undetermined and root outcomes return without calling it.
 *
 * When `kind` is not "packages" the list is EMPTY rather than partial, so a caller that reads it
 * without checking `kind` narrows to nothing visible instead of to a plausible-looking subset.
 */
export function scopeForPaths(changedPaths, loadPackages) {
  const meaningful = changedPaths.map((path) => path.trim()).filter((path) => path.length > 0);
  const { code, reason } = classify(meaningful);

  // Fails CLOSED on an undetermined diff (empty list), exactly as `code` does.
  const deploy = meaningful.length === 0 || meaningful.some(isImageInputPath);

  if (!code) return { kind: "documentation", packages: [], root: false, deploy, reason };

  // An empty list means we could not work out what is being pushed, not that nothing is.
  if (meaningful.length === 0) return { kind: "global", packages: [], root: false, deploy, reason };

  const codePaths = meaningful.filter((path) => !isInertPath(path));
  const rootPaths = codePaths.filter(isRootScopePath);
  const root = rootPaths.length > 0;
  const attributable = codePaths.filter((path) => !isRootScopePath(path));
  const consumed = rootPaths.filter((path) => ROOT_SCOPE_CONSUMERS.has(path));

  if (attributable.length === 0 && consumed.length === 0) {
    return {
      kind: "root",
      packages: [],
      root: true,
      deploy,
      reason: `${rootPaths.length} changed path(s) are the repository's own machinery — repo-level suite only`,
    };
  }

  const packages = loadPackages();
  if (packages === null) {
    return {
      kind: "global",
      packages: [],
      root,
      deploy,
      reason: "the workspace layout could not be read — running everything",
    };
  }

  const attributed = new Set();

  for (const path of attributable) {
    const owner = owningPackage(path, packages);
    // `pnpm-workspace.yaml`, `tsconfig.base.json`, the root manifest, the lockfile and the lint and
    // format config all land here. Those can affect anything.
    if (owner === undefined) {
      return {
        kind: "global",
        packages: [],
        root,
        deploy,
        reason: `${path} belongs to no package — running everything`,
      };
    }
    attributed.add(owner.name);
  }

  for (const path of consumed) {
    for (const dir of ROOT_SCOPE_CONSUMERS.get(path)) {
      const consumer = packages.find((pkg) => pkg.dir === dir);
      if (consumer === undefined) {
        return {
          kind: "global",
          packages: [],
          root,
          deploy,
          reason: `${path} is read by ${dir}, which is not a workspace member — running everything`,
        };
      }
      attributed.add(consumer.name);
    }
  }

  const names = [...attributed].sort();
  return {
    kind: "packages",
    packages: names,
    root,
    deploy,
    reason: `${attributable.length + consumed.length} changed code path(s) map to ${names.join(", ")}`,
  };
}

/**
 * Renders a scope as the five lines its two callers read.
 *
 * `code` is ci.yml's gate on every job that builds, typechecks, tests or mutates a PACKAGE, which
 * is why `kind: "root"` answers it false alongside `documentation`: ci.yml's UNGATED `lint` job is
 * what runs the repo-level project a root change does reach. `root=` is emitted for the record and
 * read by no consumer today.
 *
 * A single space separates the package names, and that separator is the contract between this file
 * and its callers. Both callers WORD-SPLIT that line, so a name containing whitespace would come
 * apart into two filters.
 */
export function formatScope({ kind, packages, root, deploy }) {
  const code = kind === "packages" || kind === "global";
  return `code=${code}\nscope=${kind}\npackages=${packages.join(" ")}\nroot=${root}\ndeploy=${deploy}`;
}

/**
 * Whether `pnpm <filters> <script>` will actually run something, given the `pnpm <the same filters>
 * ls --depth -1 --json` result already read by `workspacePackages` — `{ok, reason}`.
 *
 * This exists because pnpm answers "nothing to do" with SUCCESS, in two different ways, both on
 * STDOUT and both exit **0**:
 *
 *   pnpm --filter "@waitron/nope" test:coverage          → No projects matched the filters in "…"
 *   pnpm --filter "...@waitron/bench-pglite" test:cov…   → None of the selected packages has a
 *                                                          "test:coverage" script
 *
 * The message is not what is checked here — a wording change would silently switch the guard off,
 * which is the quiet direction — the SELECTION is.
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
//     changed paths on stdin, one per line → five `<name>=<value>` lines on stdout.
//   node scripts/changed-packages.mjs runnable <script>
//     a `pnpm <filters> ls --depth -1 --json` result on stdin → nothing on stdout, and an EXIT CODE
//     that is 1 when that selection would run no `<script>` at all. The exit code is the only part
//     of it a shell step can act on, which is why this is a subcommand rather than a sixth line.
//
// In the default shape the workspace layout is resolved HERE, because stdin already carries the
// changed paths. A `pnpm ls` that fails leaves no array on stdout — nothing when the spawn itself
// failed (`?? ""` below makes that empty), or pnpm's JSON error object — and `workspacePackages`
// returns `null` for empty, unparsable or non-array input, which `scopeForPaths` turns into a
// global run. `pnpm ls` needs no `pnpm install` first, which matters because the hook classifies
// before installing and ci.yml's `changes` job never installs.
//
// stdout carries the five lines and NOTHING else: both callers `sed` the `<name>=` lines out of it,
// so a stray line that happened to carry a prefix would become a bogus job output or scope. The
// human-readable reason goes to stderr.
//
// Ignored for coverage because the tests run it in a CHILD process, which the v8 provider does not
// measure.
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
