import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WAITING_PAGE_WORDS } from "./waiting-page.js";

describe("waiting page wording", () => {
  // Reads the module's source as text; it does not observe what loads at runtime.
  it("imports only types", () => {
    const source = readFileSync(new URL("./waiting-page.ts", import.meta.url), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type\b/);
  });

  it("gives every language the same parts", () => {
    for (const words of Object.values(WAITING_PAGE_WORDS)) {
      expect(words.title).toHaveLength(2);
      expect(words.body).toHaveLength(2);
      expect(words.otherBox).not.toBe("");
    }
  });
});
