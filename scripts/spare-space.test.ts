/**
 * Only the allowed files name the box's spare file or the functions that delete and write it: the
 * start's emptying and the repair host release it (`first-setup-entry.ts`), and only a start with
 * room writes it back (`node-entry.ts`).
 *
 * Weaker than its name: it reads TEXT — a non-test `.ts` file under `apps/<app>/src` or
 * `packages/<package>/src` naming `SPARE_SPACE_FILE`, the literal `"spare-space"`, `releaseSpare`,
 * `releaseSpareBeforeStartAgain` or `topUpSpare` — so a path built another way, or a function
 * reached under another name, escapes it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const NAMES: ReadonlyArray<{ pattern: RegExp; allowed: readonly string[] }> = [
  {
    pattern: /\bSPARE_SPACE_FILE\b|"spare-space"/,
    allowed: [
      "apps/server/src/spare-space.ts",
      "packages/provisioning/src/first-setup-backup-workspace.ts",
      "packages/provisioning/src/index.ts",
      "packages/provisioning/src/spare-space-name.ts",
    ],
  },
  {
    pattern: /\breleaseSpare\b|\breleaseSpareBeforeStartAgain\b/,
    allowed: ["apps/server/src/first-setup-entry.ts", "apps/server/src/spare-space.ts"],
  },
  {
    pattern: /\btopUpSpare\b/,
    allowed: ["apps/server/src/node-entry.ts", "apps/server/src/spare-space.ts"],
  },
];

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (stats.isFile() && entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function srcRoots(): string[] {
  const roots: string[] = [];
  for (const top of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, top))) {
      const src = join(ROOT, top, entry, "src");
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // A package with no src folder has nothing to scan.
      }
    }
  }
  return roots;
}

/** Each file that names a guarded name without being allowed to, with the name's pattern. */
function strays(files: ReadonlyArray<{ path: string; text: string }>): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    for (const { pattern, allowed } of NAMES) {
      if (pattern.test(text) && !allowed.includes(path)) found.push(`${path}: ${pattern.source}`);
    }
  }
  return found.sort();
}

describe("the spare file guard (weaker than its name: reads text)", () => {
  it("only the allowed files name the spare file or delete or write it", () => {
    const files = srcRoots()
      .flatMap(sourceFilesIn)
      .map((file) => ({
        path: relative(ROOT, file).split(sep).join("/"),
        text: readFileSync(file, "utf8"),
      }));
    expect(strays(files)).toEqual([]);
    // Each allowed name is still found, so a renamed function or file cannot leave the guard idle.
    for (const { pattern } of NAMES) {
      expect(
        files.some(({ text }) => pattern.test(text)),
        pattern.source,
      ).toBe(true);
    }
  });

  it("passes each allowed file's legitimate use and refuses the same use elsewhere", () => {
    const releases =
      'import { releaseSpare, releaseSpareBeforeStartAgain } from "./spare-space.js";';
    const tops = 'import { SPARE_SPACE_BYTES, topUpSpare } from "./spare-space.js";';
    const named = 'import { SPARE_SPACE_FILE } from "./spare-space-name.js";';
    expect(
      strays([
        { path: "apps/server/src/first-setup-entry.ts", text: releases },
        { path: "apps/server/src/node-entry.ts", text: tops },
        { path: "packages/provisioning/src/first-setup-backup-workspace.ts", text: named },
        {
          path: "packages/provisioning/src/spare-space-name.ts",
          text: 'export const SPARE_SPACE_FILE = "spare-space";',
        },
      ]),
    ).toEqual([]);
    expect(
      strays([
        { path: "apps/server/src/free-space-now.ts", text: releases },
        { path: "apps/server/src/first-setup-entry.ts", text: tops },
        { path: "apps/server/src/start-space.ts", text: 'join(stateDir, "spare-space")' },
      ]),
    ).toEqual([
      "apps/server/src/first-setup-entry.ts: \\btopUpSpare\\b",
      "apps/server/src/free-space-now.ts: \\breleaseSpare\\b|\\breleaseSpareBeforeStartAgain\\b",
      'apps/server/src/start-space.ts: \\bSPARE_SPACE_FILE\\b|"spare-space"',
    ]);
  });
});
