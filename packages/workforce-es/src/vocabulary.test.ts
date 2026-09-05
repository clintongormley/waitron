import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORKFORCE_ES_VOCABULARY } from "./vocabulary.js";

/**
 * The english-only guard's tokeniser (packages/db/src/english-only.ts), copied verbatim: `findSpanish`
 * is deliberately not on `@waitron/db`'s barrel (index.ts) and the enumerated `exports` map forbids a
 * deep import — the same stance packages/fiscal-verifactu's vocabulary-scope.test.ts takes.
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

describe("WORKFORCE_ES_VOCABULARY — the terms this module owns (module-system §3, SP-3b spec §2)", () => {
  it("is a non-empty list of guard-shaped tokens with no duplicates", () => {
    expect(WORKFORCE_ES_VOCABULARY.length).toBeGreaterThan(0);
    for (const term of WORKFORCE_ES_VOCABULARY) expect(term).toMatch(/^[a-z]+$/);
    expect(new Set(WORKFORCE_ES_VOCABULARY).size).toBe(WORKFORCE_ES_VOCABULARY.length);
  });

  it("fires on this package's own source, so the declaration is not decorative", () => {
    // `convenio` names the schema's table; `jornada` is the registro de jornada itself. Delete either
    // from the list and this goes red. The root suite proves the same over the whole package.
    const schema = tokensOf("./schema/convenio-config.ts");
    const jornada = tokensOf("./registro-jornada.ts");
    expect(WORKFORCE_ES_VOCABULARY.filter((w) => schema.has(w))).toContain("convenio");
    expect(WORKFORCE_ES_VOCABULARY.filter((w) => jornada.has(w))).toContain("jornada");
  });
});
