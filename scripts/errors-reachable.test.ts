import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tree-wide guard for the rule in `packages/shared/src/errors.ts`'s design comment: a package that
 * augments `@waitron/shared`'s `ErrorParams` (by `declare module "@waitron/shared" { … }` in its
 * `src/errors.ts`) must keep that `errors.ts` transitively reachable from its own public barrel
 * (`src/index.ts`), not merely present somewhere under `src/`.
 *
 * WHY THIS HAS TO BE A SEPARATE PROGRAM, AND WHY THE PER-PACKAGE COPIES IT REPLACES DID NOT WORK.
 *
 * TypeScript's declaration merging is a whole-program fact for whichever files a given program
 * loads. A package's own `pnpm typecheck` loads `./errors.ts` regardless of whether anything
 * imports it — every package's `tsconfig.json` `include`s all of `src` — so nothing that runs from
 * INSIDE the package (typecheck, lint, test) can ever notice `./errors.ts` going unreachable from
 * `./index.ts`. Only a program that sees the public barrel ALONE — an external consumer of
 * `@waitron/<pkg>` — would lose the augmentation, and this repo has no such program running in CI.
 *
 * Thirteen packages each carried a hand-copied `src/errors.reachability.test.ts`, in two different
 * shapes, and SIX of them did not test reachability at all. Proven by deletion on 2026-08-11 in the
 * `test/reachability-import-graph` worktree, with `import "./errors.js"` stripped from every file
 * that reaches `errors.ts`:
 *
 *   - `packages/migrations` (a "smoke" copy — it constructs an `AppError` and checks the barrel
 *     loads) passed 2/2 with `errors.ts` FULLY UNREACHABLE. `AppError` validates nothing against
 *     `ErrorParams` at runtime and `vitest run` does not typecheck, so the construction succeeds
 *     regardless of the import graph. The six smoke copies (credentials, migrations, payments-stripe,
 *     identity, reporting, sync) passed for the wrong reason — the exact defect class in CLAUDE.md §4.
 *   - `packages/db` (a "text-walk" copy, the mechanism this guard adopts) FAILED with
 *     `expected false to be true`, and passed again the moment the import was restored.
 *
 * Two augmenting packages (catalogue, provisioning) carried no copy at all. Discovering the packages
 * rather than hand-copying the test is what closes that gap: one guard covers every package that has
 * both files, including the two that were missing and any added later.
 *
 * MECHANISM. This is a reachability check, not a type checker. It reads each source file as TEXT
 * (never evaluating it), matches relative `import`/`export … from` specifiers, and walks the graph
 * from `index.ts`. It cannot see whether anything compiles — only whether some chain of imports,
 * starting at the barrel, reaches `errors.ts`. That is exactly the property each package's
 * side-effect `import "./errors.js"` exists to keep true; removing that import is the one edit this
 * guard exists to catch, and the `db` proof above is that it does.
 *
 * KNOWN LIMITATION, stated rather than papered over (CLAUDE.md §1). The walk matches specifier text:
 * an `import`/`… from` followed by only whitespace and then `"./errors.js"` — matched whether that
 * sits in real code, a COMMENT, or a string literal. So that exact shape in a comment or string on a
 * still-reachable file would fake an edge and let a genuinely-removed import pass. What it does NOT
 * match — all checked by running the regex on 2026-08-11: a keyword reached from its specifier across
 * any NON-whitespace token, where a `//` or `/*` marker between them is enough BUT a bare newline is
 * not (`\s+` spans newlines, so a real multi-line import is still caught); a `declare module "…"`; and
 * a dynamic `import("./errors.js")` (a package reaching `errors.ts` only by dynamic import would be
 * reported unreachable — none does). Grepped tree-wide, every regex-matching reference to a package's
 * own `src/errors.ts` from a barrel-reachable file is a real static import or type re-export. The one
 * comment mention on a reachable non-`errors.ts` file — `reporting/record-daily-close.ts`, where
 * `import` and `"./errors.js"` are split by a `//` marker — does not match: removing that file's real
 * import drops `./errors.js` from the matched set. And the self-referential `import "./errors.js"`
 * mentions that several `errors.ts` carry in their own doc-comments (core, fiscal, shared) cannot fake
 * an edge either, because `errors.ts` is the target the walk reads only AFTER reaching it.
 * Comment-stripping was rejected: a block stripper mishandles a slash-star opener inside a string
 * literal (a glob such as a double-star path pattern), which would drop a REAL import and misfire the
 * guard — a worse failure than the hole it closes.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const IMPORT_SPECIFIER = /(?:from|import)\s+["'](\.\.?\/[^"']+)["']/g;

function relativeImportsOf(absolutePath: string): string[] {
  let source: string;
  try {
    source = readFileSync(absolutePath, "utf8");
  } catch {
    // Not a readable source file: a resolved specifier pointing at a directory (an extensionless
    // import throws EISDIR) or a path that does not exist (ENOENT). It cannot be `errors.ts` — the
    // target, which discovery already confirmed exists — so yielding no edges only ever skips an
    // intermediate, and never crashes the whole guard on one odd import.
    return [];
  }
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

/** Every `packages/*` that ships both a public barrel and an `errors.ts` — i.e. every package whose
 * error-code augmentation has to reach external consumers. `apps/*` are excluded by construction:
 * they have no externally-consumed barrel (no `src/index.ts`), so no augmentation of theirs travels. */
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

  it("discovers the packages to check (guards against a vacuous pass)", () => {
    // `it.each([])` below would generate zero assertions and report all-green, so a discovery that
    // silently found nothing would look identical to every package passing. Anchor on packages that
    // are not going away rather than an exact count — a count that moves is a receipt that goes
    // stale (CLAUDE.md §2) — and set a loose floor well under today's 16.
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
