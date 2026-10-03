import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "../packages/shared/src/source-comments.js";

/**
 * A package that augments `@waitron/shared`'s `ErrorParams` in its `src/errors.ts` must keep that
 * file reachable from its public barrel (`src/index.ts`). Nothing inside the package notices it
 * going unreachable: every package's `tsconfig.json` includes all of `src`, so its own typecheck
 * loads `errors.ts` regardless, and only a consumer that sees the barrel alone loses the
 * augmentation.
 *
 * It walks relative `import`/`export … from` specifiers from `index.ts` after blanking comments.
 * The shared reader guesses whether `/` opens a regular expression, so a wrong guess can still
 * hide code or expose a comment. A matching specifier inside a string can fake an edge, and a
 * dynamic `import("./errors.js")` is not followed.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const IMPORT_SPECIFIER = /(?:from|import)\s+["'](\.\.?\/[^"']+)["']/g;

function relativeImportsOf(absolutePath: string): string[] {
  let source: string;
  try {
    source = readFileSync(absolutePath, "utf8");
  } catch {
    // A directory or a missing path cannot be `errors.ts`, so it yields no edges.
    return [];
  }
  const dir = dirname(absolutePath);
  return [...blankComments(source).matchAll(IMPORT_SPECIFIER)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined)
    .map((specifier) => resolve(dir, specifier.replace(/\.js$/, ".ts")));
}

function reachableFrom(entryPath: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entryPath];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const next of relativeImportsOf(file)) stack.push(next);
  }
  return seen;
}

/** Every `packages/*` that ships both a public barrel and an `errors.ts`. */
function packagesWithBarrelAndErrors(): string[] {
  return readdirSync(PACKAGES_DIR)
    .filter((name) => {
      const src = join(PACKAGES_DIR, name, "src");
      return existsSync(join(src, "index.ts")) && existsSync(join(src, "errors.ts"));
    })
    .sort();
}

describe("errors.ts is reachable from each package's public barrel", () => {
  const packages = packagesWithBarrelAndErrors();

  it("does not count an import inside a comment as a reachable edge", () => {
    const dir = mkdtempSync(join(tmpdir(), "errors-reachable-"));
    try {
      const entry = join(dir, "index.ts");
      const target = join(dir, "errors.ts");
      writeFileSync(entry, '// import "./errors.js";\n/* export * from "./errors.js"; */\n');
      writeFileSync(target, "export {};\n");
      expect(reachableFrom(entry).has(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("follows a real import after a slash-star inside a string", () => {
    const dir = mkdtempSync(join(tmpdir(), "errors-reachable-"));
    try {
      const entry = join(dir, "index.ts");
      const target = join(dir, "errors.ts");
      writeFileSync(entry, 'const marker = "/*";\nexport * from "./errors.js";\n');
      writeFileSync(target, "export {};\n");
      expect(reachableFrom(entry).has(target)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers the packages to check (guards against a vacuous pass)", () => {
    // `it.each([])` below would report all-green, so anchor on packages that are not going away.
    expect(packages).toContain("core");
    expect(packages).toContain("db");
    expect(packages).toContain("shared");
    expect(packages.length).toBeGreaterThanOrEqual(10);
  });

  it.each(packages)("%s: errors.ts is imported, directly or transitively, from index.ts", (pkg) => {
    const src = join(PACKAGES_DIR, pkg, "src");
    const entry = join(src, "index.ts");
    const target = join(src, "errors.ts");
    expect(reachableFrom(entry).has(target)).toBe(true);
  });
});
