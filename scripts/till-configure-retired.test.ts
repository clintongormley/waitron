import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

// Git's own location overrides each outrank the `cwd` a child is spawned in. Git exports `GIT_DIR`
// to every hook and `.husky/pre-push` runs this suite, so an inherited one would send `git grep` to
// another repository and answer the wrong question. Cleared for the child, with `cwd` at the repo
// root so git discovers THIS repo. Same list, and same reason, as scripts/manifest-commands.test.ts.
const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  return env;
}

// Reads TEXT, not types: the permission is passed as `Permission | (string & {})`, so a stray
// `"till.configure"` on a missed route compiles clean. This guard is the safety net the typechecker
// cannot be — it greps the source for the QUOTED value form, the shape a live gate uses. It does NOT
// police bare-word/backtick mentions in comments (a comment cannot gate a route); those are stale doc
// thinned on touch. A value built from pieces at runtime would also escape it.
describe("till.configure is retired", () => {
  it("appears as a permission value in no production source under packages/ or apps/", () => {
    let out: string;
    try {
      // -F fixed string, the double-quoted literal — the value form, never the comment form.
      out = execFileSync("git", ["grep", "-lF", '"till.configure"', "--", "packages", "apps"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: isolatedGitEnv(),
      });
    } catch (err) {
      // `git grep` exit codes: 0 matches, 1 no matches, >1 a real error. execFileSync throws on any
      // non-zero exit; `.status` holds the code. ONLY 1 is the clean empty case — anything else (a
      // broken or misdirected repo, an unrunnable git) is rethrown so the guard fails LOUD rather
      // than silently passing on an error it mistook for "no offenders" (CLAUDE.md §1).
      if ((err as { status?: number }).status === 1) {
        out = "";
      } else {
        throw err;
      }
    }
    const offenders = out.split("\n").filter((f) => f.length > 0 && !f.endsWith(".test.ts"));
    expect(offenders).toEqual([]);
  });
});
