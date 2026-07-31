import { describe, expect, it } from "vitest";
import { classify, isInertPath, needsHeavyShard } from "./changed-scope.mjs";

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
