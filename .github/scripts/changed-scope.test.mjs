import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classify, formatOutput, isInertPath, needsHeavyShard } from "./changed-scope.mjs";

describe("isInertPath", () => {
  it.each(["docs/backlog.md", "docs/superpowers/specs/some-design.md", "docs/compliance/x.md"])(
    "treats %s as inert",
    (path) => {
      expect(isInertPath(path)).toBe(true);
    },
  );

  it.each(["CLAUDE.md", "README.md", "CONTRIBUTING.md"])(
    "treats the root-level %s as inert",
    (path) => {
      expect(isInertPath(path)).toBe(true);
    },
  );

  // The case that rules out a `**/*.md` shortcut. packages/verifactu/schemas/README.md is a test
  // FIXTURE: schemas.test.ts:40-48 asserts each AEAT schema's SHA-256 appears in it, precisely to
  // catch someone editing a primary source to make a test pass. Classifying it as documentation
  // would let that edit skip the only test guarding it.
  it("treats packages/verifactu/schemas/README.md as code, not documentation", () => {
    expect(isInertPath("packages/verifactu/schemas/README.md")).toBe(false);
  });

  it.each([
    "packages/db/src/index.ts",
    "packages/db/README.md",
    "apps/server/README.md",
    ".github/workflows/ci.yml",
    ".husky/pre-push",
    "pnpm-workspace.yaml",
    "eslint.config.js",
    ".prettierignore",
  ])("treats %s as code", (path) => {
    expect(isInertPath(path)).toBe(false);
  });
});

describe("classify", () => {
  it("reports no code work when every path is inert", () => {
    expect(classify(["docs/backlog.md", "CLAUDE.md"]).code).toBe(false);
  });

  it("reports code work when a single path is not inert", () => {
    expect(classify(["docs/backlog.md", "CLAUDE.md", "packages/db/src/index.ts"]).code).toBe(true);
  });

  // Fails CLOSED, the same principle as the pre-push hook running the gate when stdin carries no
  // refs: an empty list means we could not work out what changed, not that nothing did.
  it("reports code work for an empty path list", () => {
    const result = classify([]);
    expect(result.code).toBe(true);
    expect(result.reason).toMatch(/no changed paths/i);
  });

  it("ignores blank lines, which a git diff pipe can produce", () => {
    expect(classify(["docs/backlog.md", "", "  "]).code).toBe(false);
  });

  it("explains itself by naming the first non-inert path", () => {
    expect(classify(["docs/a.md", "packages/db/src/index.ts"]).reason).toContain(
      "packages/db/src/index.ts",
    );
  });
});

describe("needsHeavyShard", () => {
  const ls = (...names) => JSON.stringify(names.map((name) => ({ name })));

  it("is true when @waitron/db is in the resolved scope", () => {
    expect(needsHeavyShard(ls("@waitron/db", "@waitron/payments"))).toBe(true);
  });

  it("is false when it is not", () => {
    expect(needsHeavyShard(ls("@waitron/payments", "@waitron/server"))).toBe(false);
  });

  it("is false for an empty scope, which means nothing matched", () => {
    expect(needsHeavyShard("")).toBe(false);
    expect(needsHeavyShard("   ")).toBe(false);
    expect(needsHeavyShard("[]")).toBe(false);
  });

  // Fails CLOSED: unparseable output means we do not know, and running a shard we did not need
  // costs 189s, while skipping one we did need ships an untested packages/db.
  it("is true when the output cannot be parsed", () => {
    expect(needsHeavyShard("No projects matched the filters")).toBe(true);
  });
});

describe("formatOutput", () => {
  it("emits a GitHub Actions output line for a code change", () => {
    expect(formatOutput(["packages/db/src/index.ts"])).toBe("code=true");
  });

  it("emits a GitHub Actions output line for a docs change", () => {
    expect(formatOutput(["docs/backlog.md"])).toBe("code=false");
  });
});

// The CLI is only reachable by running the file, so these spawn it. What they add over the unit
// tests above is the part no exported function can show: WHICH STREAM each line goes to. The
// workflow appends this process's stdout straight to $GITHUB_OUTPUT, so a stray line there becomes
// a bogus job output — and the human-readable reason has to land on stderr for that to hold.
describe("the CLI", () => {
  const script = join(import.meta.dirname, "changed-scope.mjs");

  /** Runs the script with `input` on stdin, keeping its two streams apart. */
  const run = (input, ...args) => {
    const result = spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8" });
    expect(result.status).toBe(0);
    return result;
  };

  it("writes only the output line to stdout, for a docs-only diff", () => {
    expect(run("docs/backlog.md\nCLAUDE.md\n").stdout).toBe("code=false\n");
  });

  it("writes only the output line to stdout, for a diff touching a package", () => {
    expect(run("docs/backlog.md\npackages/db/src/index.ts\n").stdout).toBe("code=true\n");
  });

  // The all-zero `github.event.before` path: the workflow pipes an empty `paths` in, and the run
  // must fail closed to a full one rather than skipping everything.
  it("fails closed on empty stdin", () => {
    expect(run("").stdout).toBe("code=true\n");
    expect(run("\n").stdout).toBe("code=true\n");
  });

  it("answers the heavy subcommand from pnpm ls output", () => {
    const ls = JSON.stringify([{ name: "@waitron/db" }, { name: "@waitron/shared" }]);
    expect(run(ls, "heavy").stdout).toBe("heavy=true\n");
    expect(run(JSON.stringify([{ name: "@waitron/shared" }]), "heavy").stdout).toBe(
      "heavy=false\n",
    );
  });

  // An empty match is what `pnpm ls --json` really emits when the filter selects nothing: zero
  // bytes on stdout, zero on stderr, exit 0 — not `[]`, and no message. Measured on pnpm 9.15.0
  // against `--filter "@waitron/nonexistent"`, `--filter "...[main]"` and
  // `--filter "...[origin/main]"`, in both a worktree and a fresh clone.
  it("reads an empty pnpm ls result as no work for the heavy shard", () => {
    expect(run("", "heavy").stdout).toBe("heavy=false\n");
  });

  it("puts the reason on stderr, where it cannot reach $GITHUB_OUTPUT", () => {
    const { stdout, stderr } = run("docs/backlog.md\n");
    expect(stderr).toContain("are documentation");
    expect(stdout).not.toContain("documentation");
  });
});
