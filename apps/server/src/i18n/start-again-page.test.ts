import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Start again page wording", () => {
  // Reads the module's source as text; it does not observe what loads at runtime.
  it("imports only types", () => {
    const source = readFileSync(new URL("./start-again-page.ts", import.meta.url), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type\b/);
  });
});
