import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mirrors packages/db/src/errors.reachability.test.ts for the same reason it exists there: a
 * package that augments `ErrorParams` must keep the augmenting file transitively reachable from
 * that package's own public barrel (`./index.ts`), not merely present somewhere under `src/`.
 *
 * TypeScript's declaration merging is a whole-program fact for whichever files a given program
 * actually loads. This package's own `pnpm typecheck` loads `./errors.ts` regardless of whether
 * anything imports it (packages/fiscal/tsconfig.json `include`s all of `src`), so nothing that
 * runs from *inside* this package — typecheck, lint, test — would ever catch `./errors.ts`
 * becoming unreachable from `./index.ts`. Only a program that only sees the public barrel (an
 * external consumer of `@waitron/fiscal`) would notice, and this repo has no such program
 * running in CI.
 *
 * This is a reachability check, not a type checker: it parses relative `import`/`export …from`
 * specifiers as text and walks the graph from `./index.ts`. It cannot see whether anything
 * actually compiles — only whether some chain of imports, starting at the barrel, mentions
 * `errors.ts`. That is exactly the property `clock.ts`'s side-effect `import "./errors.js"`
 * exists to keep true; deleting that import is the one edit this test exists to catch.
 */

const SRC_DIR = join(import.meta.dirname);
const IMPORT_SPECIFIER = /(?:from|import)\s+["'](\.\.?\/[^"']+)["']/g;

function relativeImportsOf(absolutePath: string): string[] {
  const source = readFileSync(absolutePath, "utf8");
  const dir = dirname(absolutePath);
  return [...source.matchAll(IMPORT_SPECIFIER)]
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

describe("errors.ts is reachable from the package's own public barrel", () => {
  it("is imported, directly or transitively, from index.ts", () => {
    const entry = join(SRC_DIR, "index.ts");
    const target = join(SRC_DIR, "errors.ts");
    expect(reachableFrom(entry).has(target)).toBe(true);
  });
});
