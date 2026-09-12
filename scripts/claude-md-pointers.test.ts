import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md holds the RULES and points at topic files under docs/developers/ for the receipts that
 * paid for them. That split is what keeps the file loadable: it is read into context at the start of
 * every session, so a paragraph there is paid for on every turn of every session, while a paragraph
 * in a topic file is paid for only when somebody opens it.
 *
 * Two ways the split rots, both guarded here. A pointer can go stale — a renamed or deleted file
 * leaves a reader directed at nothing, which is worse than the long file it replaced, because a rule
 * whose receipt cannot be found reads as unsupported. And the file can grow back, one "while I'm
 * here" paragraph at a time, until it is 70KB again.
 *
 * Root project, same reasoning as scripts/journal-monotonic.test.ts: it reads the repository root, so
 * a package-resident copy would only run when its own package happened to be in scope.
 *
 * Backticked paths are checked as well as markdown links. The first version of this guard checked
 * only markdown links while CLAUDE.md claimed it caught missing pointers generally; the run-it review
 * falsified that by appending a backticked path to a file that does not exist and watching all three
 * tests pass (2026-09-12).
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
];

/**
 * The ceiling is a budget, not a measurement of what the file should be — it sits deliberately above
 * today's size so an ordinary new rule lands without ceremony. Hitting it means the receipts have
 * crept back in: move them to the matching docs/developers/ file and leave the rule behind.
 */
const MAX_BYTES = 45_000;

/**
 * Only paths rooted at a real top-level directory are checked. A backtick also holds commands,
 * globs, runtime artefacts a test writes (`coverage/.tmp/…`) and relative shapes describing a family
 * of files (`src/index.ts`, meaning "every package's"), none of which name a file in this tree.
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

/**
 * Every file whose pointers this guard is responsible for — CLAUDE.md and every topic file it defers
 * to, design-system.md included. An earlier version excluded design-system.md silently while the test
 * was still named "every topic file"; it had no broken pointers at the time, so the exclusion hid
 * nothing and nothing kept it that way.
 */
function governedFiles(): { name: string; markdown: string }[] {
  return [
    { name: "CLAUDE.md", markdown: readFileSync(CLAUDE_MD, "utf8") },
    ...TOPIC_FILES.map((f) => ({ name: f, markdown: readFileSync(join(ROOT, f), "utf8") })),
  ];
}

describe("the extractors themselves", () => {
  // Without these, a broken regex returns [] and every check below passes having examined nothing —
  // the vacuous shape scripts/english-only.test.ts and packages/fiscal's guards each anchor against.
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
      // A markdown link resolves the way a reader following it resolves it: relative to the file's
      // OWN directory. Accepting a repo-root fallback here would pass a link that 404s on GitHub —
      // `docs/developers/x.md` written inside docs/developers/ resolves to docs/developers/docs/…
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

  it("stays within its context budget", () => {
    const bytes = statSync(CLAUDE_MD).size;
    expect(
      bytes,
      `CLAUDE.md is ${bytes} bytes, over the ${MAX_BYTES} budget. It is loaded into every session, ` +
        `so move the receipts — the mechanism, the measurement, the incident — into the matching ` +
        `docs/developers/ file and leave the rule and its pointer here.`,
    ).toBeLessThanOrEqual(MAX_BYTES);
  });
});
