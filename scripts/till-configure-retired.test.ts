import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Reads TEXT, not types: the permission is passed as `Permission | (string & {})`, so a stray
// `"till.configure"` on a missed route compiles clean. This guard is the safety net the typechecker
// cannot be — it greps the source for the QUOTED value form, the shape a live gate uses. It does NOT
// police bare-word/backtick mentions in comments (a comment cannot gate a route); those are stale doc
// thinned on touch. A value built from pieces at runtime would also escape it.
describe("till.configure is retired", () => {
  it("appears as a permission value in no production source under packages/ or apps/", () => {
    let out = "";
    try {
      // -F fixed string, the double-quoted literal — the value form, never the comment form.
      out = execFileSync("git", ["grep", "-lF", '"till.configure"', "--", "packages", "apps"], {
        encoding: "utf8",
      });
    } catch {
      out = ""; // git grep exits non-zero when there are no matches
    }
    const offenders = out
      .split("\n")
      .filter((f) => f.length > 0 && !f.endsWith(".test.ts"));
    expect(offenders).toEqual([]);
  });
});
