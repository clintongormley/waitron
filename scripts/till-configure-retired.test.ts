import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

// Git exports `GIT_DIR` to every hook and `.husky/pre-push` runs this suite; an inherited override
// would point `git grep` at another repository.
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

// Reads TEXT for the quoted value form: the permission parameter is typed
// `Permission | (string & {})`, so a stray `"till.configure"` compiles clean. A value built from
// pieces at runtime escapes it.
describe("till.configure is retired", () => {
  it("appears as a permission value in no production source under packages/ or apps/", () => {
    let out: string;
    try {
      out = execFileSync("git", ["grep", "-lF", '"till.configure"', "--", "packages", "apps"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: isolatedGitEnv(),
      });
    } catch (err) {
      // `git grep` exits 1 for no matches; any other failure is rethrown rather than read as clean.
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
