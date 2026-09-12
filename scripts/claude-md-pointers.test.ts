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
 * Two ways the split rots, both guarded here. A pointer can go stale — a renamed or deleted topic
 * file leaves CLAUDE.md directing a reader at nothing, which is worse than the long file it replaced,
 * because a rule whose receipt cannot be found reads as unsupported. And the file can simply grow
 * back, one "while I'm here" paragraph at a time, until it is 70KB again.
 *
 * Root project, same reasoning as scripts/journal-monotonic.test.ts: it reads the repository root, so
 * a package-resident copy would only run when its own package happened to be in scope.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLAUDE_MD = join(ROOT, "CLAUDE.md");

/**
 * The ceiling is a budget, not a measurement of what the file should be — it sits deliberately above
 * today's size so an ordinary new rule lands without ceremony. Hitting it means the receipts have
 * crept back in: move them to the matching docs/developers/ file and leave the rule behind.
 */
const MAX_BYTES = 45_000;

/** Markdown links whose target is a repository path rather than a URL or an anchor. */
function repoLinkTargets(markdown: string): string[] {
  const targets = new Set<string>();
  for (const [, target] of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    targets.add(target.split("#")[0]!);
  }
  return [...targets].sort();
}

describe("CLAUDE.md pointers", () => {
  const markdown = readFileSync(CLAUDE_MD, "utf8");

  it("points only at files that exist", () => {
    const missing = repoLinkTargets(markdown).filter((target) => !existsSync(join(ROOT, target)));
    expect(missing, `CLAUDE.md links to files that do not exist: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("names a topic file for each area it defers detail to", () => {
    // The table at the top of CLAUDE.md is how a session learns which file to open before working in
    // an area. If one of these is gone, the rules it holds have stopped being findable.
    const required = [
      "docs/developers/ci-and-gates.md",
      "docs/developers/conventions-ui.md",
      "docs/developers/conventions-data.md",
      "docs/developers/testing-guide.md",
      "docs/developers/workflow-guide.md",
      "docs/developers/design-system.md",
    ];
    for (const file of required) {
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
