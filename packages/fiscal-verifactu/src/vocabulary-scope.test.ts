import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The narrower guard in packages/fiscal (no-regime-vocabulary.test.ts, which forbids ENGLISH
 * regime terms in the regime-neutral contract package) must not reach INTO this package. It has no
 * exported surface — its sources come from `import.meta.glob(["./**\/*.ts", …])`, resolved
 * relative to the calling file, so a relative, non-parent-escaping glob is structurally incapable
 * of walking out of `packages/fiscal/src`. Proving that without importing its internals means
 * reading its source text.
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
