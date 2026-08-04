import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Task 3's English-only guard (packages/db/src/english-only.ts) scans `GENERIC_PACKAGES`
 * ("db", "core", "fiscal", "shared", "payments", "scheduler", "credentials", "workforce",
 * "reporting", "identity") and explicitly names this package — alongside packages/verifactu — in
 * `EXEMPT_PACKAGES`.
 *
 * Its constants are read here as SOURCE TEXT rather than imported from `@waitron/db`, and that is
 * not merely a style choice carried over from packages/fiscal/src/no-regime-vocabulary.test.ts's
 * identical stance (reached there for a single small helper). It is load-bearing: english-only.ts
 * computes `PACKAGES_ROOT` from `import.meta.dirname` as a top-level module-scope constant, and
 * `drizzle-kit generate` loads `@waitron/db`'s barrel transitively the moment any schema file here
 * imports a core table from it. Under drizzle-kit's own CJS-transformed loader,
 * `import.meta.dirname` is `undefined`, and `join(undefined, "..", "..")` throws immediately —
 * verified live, re-exporting english-only.ts from packages/db/src/index.ts broke
 * `drizzle-kit generate` for this package outright. Reading the file's text, rather than
 * importing it, is what keeps this test able to run at all in the same process that also runs
 * drizzle-kit.
 */
const englishOnlySource = readFileSync(
  fileURLToPath(new URL("../../db/src/english-only.ts", import.meta.url)),
  "utf8",
);

describe("the English-only vocabulary guard is scoped out of this package", () => {
  it("does not scan fiscal-verifactu", () => {
    expect(englishOnlySource).toMatch(
      /GENERIC_PACKAGES\s*=\s*\[\s*"db",\s*"core",\s*"fiscal",\s*"shared",\s*"payments",\s*"scheduler",\s*"credentials",\s*"workforce",\s*"reporting",\s*"identity",?\s*\]/,
    );
  });

  it("explicitly exempts fiscal-verifactu, alongside verifactu and workforce-es", () => {
    expect(englishOnlySource).toMatch(
      /EXEMPT_PACKAGES\s*=\s*\["verifactu",\s*"fiscal-verifactu",\s*"workforce-es"\]/,
    );
  });

  it("would flag this package's schema outright if it ever were in scope", () => {
    // The assertions above are worthless alone — a guard covering nothing at all satisfies them
    // just as well as a guard that is merely under-reaching. This re-implements just enough of
    // english-only.ts's own tokeniser (verbatim, see its doc comment) to run the real detection
    // logic over a file the guard deliberately does not cover, proving the wordlist still has
    // teeth AND that this package is excluded by scope rather than by the guard having quietly
    // stopped working. If someone widens GENERIC_PACKAGES, the two tests above fail; if someone
    // guts the wordlist, this one does.
    function tokenise(line: string): string[] {
      return line
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(Boolean);
    }

    const wordlistMatch = englishOnlySource.match(/SPANISH_WORDS = new Set\(\[([\s\S]*?)]\);/);
    expect(wordlistMatch).not.toBeNull();
    const wordlist = new Set(
      [...(wordlistMatch?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map(([, w]) => w),
    );
    // A positive control on the wordlist extraction itself, before trusting it below.
    expect(wordlist.has("huella")).toBe(true);
    expect(wordlist.has("registro")).toBe(true);

    const src = readFileSync(
      fileURLToPath(new URL("./schema/registros.ts", import.meta.url)),
      "utf8",
    );
    const tokens = new Set(tokenise(src));
    const wouldFlag = [...wordlist].filter((w) => tokens.has(w));
    expect(wouldFlag).toEqual(
      expect.arrayContaining(["registro", "registros", "facturacion", "huella", "secuencia"]),
    );
  });
});

/**
 * The reverse direction: Task 11's narrower guard (packages/fiscal/src/no-regime-vocabulary.test.ts)
 * must not reach INTO this package either. That guard has no exported surface at all — it is a
 * self-contained test file whose `sources` are gathered via `import.meta.glob(["./**\/*.ts", ...])`,
 * a pattern resolved by Vite/Vitest relative to the FILE THAT CALLS IT. A relative,
 * non-parent-escaping glob (no leading `../`) is therefore structurally incapable of walking out
 * of `packages/fiscal/src` and into a sibling package, regardless of what that sibling contains.
 *
 * Proving this without importing that file's (unexported) internals means reading its own source
 * text — the same cross-package-read-for-verification shape scripts/english-only.test.ts already
 * uses in its "the wordlist is not decorative" block, which reads real Spanish source out of
 * packages/verifactu. (That suite sat in packages/db/src until 2026-08-01, when it moved to the
 * repo-level Vitest project; the module it tests did not move, which is why the path read at the
 * top of this file is unchanged.)
 */
describe("Task 11's no-regime-vocabulary guard is scoped to packages/fiscal, not here", () => {
  const noRegimeVocabularySource = readFileSync(
    fileURLToPath(new URL("../../fiscal/src/no-regime-vocabulary.test.ts", import.meta.url)),
    "utf8",
  );

  it("gathers its sources with a relative glob rooted at its own file", () => {
    expect(noRegimeVocabularySource).toContain('import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]');
  });

  it("never mentions this package, by path or by name", () => {
    expect(noRegimeVocabularySource).not.toContain("fiscal-verifactu");
    expect(noRegimeVocabularySource).not.toContain("../");
  });
});
