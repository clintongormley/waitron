import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md holds the rules and points at topic files under docs/developers/ for the receipts; a
 * renamed or deleted file leaves a reader directed at nothing. Checks markdown links and backticked
 * paths. CLAUDE.md's SIZE is deliberately not gated.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLAUDE_MD = join(ROOT, "CLAUDE.md");

const TOPIC_FILES = [
  "docs/developers/ci-and-gates.md",
  "docs/developers/conventions-ui.md",
  "docs/developers/conventions-data.md",
  "docs/developers/testing-guide.md",
  "docs/developers/workflow-guide.md",
  "docs/developers/design-system.md",
  "docs/developers/writing-claims.md",
];

/**
 * Only paths rooted at a real top-level directory are checked. A backtick also holds commands,
 * globs, runtime artefacts a test writes (`coverage/.tmp/…`) and relative shapes describing a
 * family of files (`src/index.ts`, meaning "every package's"), none of which name a file in this
 * tree.
 */
const REPO_ROOTS = [
  "apps/",
  "packages/",
  "docs/",
  "scripts/",
  "deploy/",
  "bench/",
  ".github/",
  ".husky/",
];
const PATH_LIKE =
  /^[A-Za-z0-9_.][A-Za-z0-9_./-]*\.(?:ts|tsx|md|mjs|js|json|sql|yml|yaml|css|sh|conf|example)$/;

function markdownLinkTargets(markdown: string): string[] {
  const targets = new Set<string>();
  for (const [, target] of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    targets.add(target.split("#")[0]!);
  }
  return [...targets];
}

function backtickedPaths(markdown: string): string[] {
  const targets = new Set<string>();
  for (const [, token] of markdown.matchAll(/`([^`\n]+)`/g)) {
    const t = token.trim();
    if (!REPO_ROOTS.some((r) => t.startsWith(r))) continue;
    if (/[*?[\]\s]/.test(t)) continue;
    if (!PATH_LIKE.test(t)) continue;
    targets.add(t);
  }
  return [...targets];
}

/** CLAUDE.md and every topic file it defers to, design-system.md included. */
function governedFiles(): { name: string; markdown: string }[] {
  return [
    { name: "CLAUDE.md", markdown: readFileSync(CLAUDE_MD, "utf8") },
    ...TOPIC_FILES.map((f) => ({ name: f, markdown: readFileSync(join(ROOT, f), "utf8") })),
  ];
}

describe("the extractors themselves", () => {
  // Without these, a broken regex returns [] and every check below passes having examined nothing.
  it("finds the markdown links and backticked paths that are really there", () => {
    const markdown = readFileSync(CLAUDE_MD, "utf8");
    expect(markdownLinkTargets(markdown)).toContain("docs/developers/conventions-data.md");
    expect(backtickedPaths(markdown)).toContain("scripts/journal-monotonic.test.ts");
  });

  it("rejects a planted pointer to a file that does not exist (positive control)", () => {
    const planted = "See [nope](docs/developers/not-a-file.md) and `scripts/not-a-guard.test.ts`.";
    const found = [...markdownLinkTargets(planted), ...backtickedPaths(planted)];
    expect(found).toEqual(
      expect.arrayContaining(["docs/developers/not-a-file.md", "scripts/not-a-guard.test.ts"]),
    );
    expect(found.filter((f) => !existsSync(join(ROOT, f)))).toHaveLength(2);
  });

  it("ignores backticks that are not repository paths", () => {
    const noise =
      "`pnpm --filter x test` `coverage/.tmp/coverage-41.json` `src/index.ts` `scripts/**/*.ts`";
    expect(backtickedPaths(noise)).toEqual([]);
  });
});

describe("CLAUDE.md pointers", () => {
  it("points only at files that exist, in CLAUDE.md and every topic file", () => {
    const missing: string[] = [];
    for (const { name, markdown } of governedFiles()) {
      // A markdown link resolves relative to the file's OWN directory, the way a reader following
      // it on GitHub resolves it; a repo-root fallback would pass a link that 404s.
      const dir = join(ROOT, name, "..");
      for (const target of markdownLinkTargets(markdown)) {
        if (!existsSync(join(dir, target))) missing.push(`${name} -> ${target} (link)`);
      }
      // A backticked path is a citation, root-relative by this repository's convention.
      for (const target of backtickedPaths(markdown)) {
        if (!existsSync(join(ROOT, target))) missing.push(`${name} -> ${target} (path)`);
      }
    }
    expect(missing, `pointers to files that do not exist:\n${missing.join("\n")}`).toEqual([]);
  });

  it("names a topic file for each area it defers detail to", () => {
    const markdown = readFileSync(CLAUDE_MD, "utf8");
    for (const file of TOPIC_FILES) {
      expect(markdown, `CLAUDE.md no longer points at ${file}`).toContain(file);
      expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true);
    }
  });
});
