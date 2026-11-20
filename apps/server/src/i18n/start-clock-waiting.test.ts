import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { START_CLOCK_WAITING_WORDS } from "./start-clock-waiting.js";

describe("restore's clock-waiting page wording", () => {
  // Copied from apps/setup's `restore.allocation_node_key` and `restore.allocation_key_missing`,
  // so the key is named as on the restore page.
  it.each([
    ["en-GB", "Selected backup’s server key", "Enter the selected backup’s server key."],
    [
      "es-ES",
      "Clave del servidor de la copia elegida",
      "Introduce la clave del servidor de la copia elegida.",
    ],
  ] as const)("names the key in %s as the restore page does", (locale, label, refused) => {
    expect(START_CLOCK_WAITING_WORDS[locale].keyLabel).toBe(label);
    expect(START_CLOCK_WAITING_WORDS[locale].keyRefused).toBe(refused);
  });

  it("never calls the key a node recovery key", () => {
    for (const words of Object.values(START_CLOCK_WAITING_WORDS))
      for (const text of Object.values(words)) expect(text).not.toMatch(/node recovery|del nodo/i);
  });

  // Reads the module's source as text; it does not observe what loads at runtime.
  it("imports only types", () => {
    const source = readFileSync(new URL("./start-clock-waiting.ts", import.meta.url), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type\b/);
  });
});
