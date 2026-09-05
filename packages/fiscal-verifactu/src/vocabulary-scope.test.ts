import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FISCAL_VOCABULARY } from "./vocabulary.js";

/**
 * The english-only guard's tokeniser (packages/db/src/english-only.ts), copied verbatim rather than
 * imported: `findSpanish` is deliberately NOT on `@waitron/db`'s barrel (index.ts — the file computes
 * `PACKAGES_ROOT` from `import.meta.dirname` at load time, which drizzle-kit's loader cannot supply),
 * and the package's enumerated `exports` map forbids a deep import.
 */
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

function tokensOf(relativePath: string): Set<string> {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return new Set(tokenise(source));
}

describe("FISCAL_VOCABULARY — the terms this module owns (module-system §3, SP-3b spec §2)", () => {
  it("is a non-empty list of guard-shaped tokens with no duplicates", () => {
    expect(FISCAL_VOCABULARY.length).toBeGreaterThan(0);
    for (const term of FISCAL_VOCABULARY) expect(term).toMatch(/^[a-z]+$/);
    expect(new Set(FISCAL_VOCABULARY).size).toBe(FISCAL_VOCABULARY.length);
  });

  it("fires on this package's own schema, so the declaration is not decorative", () => {
    // The root suite (scripts/english-only.test.ts) proves the same over the whole package; this
    // local control keeps the list honest when only this package's own gate runs. Delete `huella`
    // from the list and this goes red.
    const tokens = tokensOf("./schema/registros.ts");
    const fired = FISCAL_VOCABULARY.filter((w) => tokens.has(w));
    expect(fired).toEqual(
      expect.arrayContaining(["registro", "registros", "facturacion", "huella", "secuencia"]),
    );
  });
});

/**
 * The reverse direction: packages/fiscal's narrower guard (no-regime-vocabulary.test.ts, which forbids
 * ENGLISH regime terms in the regime-neutral contract package) must not reach INTO this package. That
 * guard has no exported surface — its `sources` come from `import.meta.glob(["./**\/*.ts", ...])`,
 * resolved relative to the FILE THAT CALLS IT, so a relative, non-parent-escaping glob is structurally
 * incapable of walking out of `packages/fiscal/src`. Proving that without importing its internals
 * means reading its source text.
 */
describe("packages/fiscal's no-regime-vocabulary guard is scoped to packages/fiscal, not here", () => {
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
