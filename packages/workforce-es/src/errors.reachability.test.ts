import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mirrors packages/workforce/src/errors.reachability.test.ts (and the copies in db/core/fiscal/
 * credentials/payments) for the same reason it exists in each: a package that augments `ErrorParams`
 * must keep the augmenting file transitively reachable from that package's own public barrel
 * (`./index.ts`), not merely present somewhere under `src/`.
 *
 * This package's own `pnpm typecheck` loads `./errors.ts` regardless of whether anything imports it
 * (tsconfig `include`s all of `src`), so nothing that runs from INSIDE this package would ever catch
 * `./errors.ts` becoming unreachable from `./index.ts`. Only a program that sees the public barrel
 * alone (an external consumer of `@waitron/workforce-es`) would notice.
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
