import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESTRICTED_PAGE_WORDS, STANDING_DOWN_PAGE_WORDS } from "./restricted-page.js";

describe("stepped-down page wording", () => {
  it.each([
    [
      "en-GB",
      "This box no longer runs the venue",
      "It takes no sales and sends nothing to the tax agency. The box taking over the venue is ",
      "This page could not be shown.",
    ],
    [
      "es-ES",
      "El local ya no funciona con este servidor",
      "No hace ventas ni envía nada a Hacienda. El servidor que pasa a llevar el local es ",
      "No se ha podido mostrar esta página.",
    ],
  ] as const)("provides the %s title, body and failure heading", (locale, title, body, failed) => {
    expect(RESTRICTED_PAGE_WORDS[locale].title).toBe(title);
    expect(RESTRICTED_PAGE_WORDS[locale].body).toEqual([body, "."]);
    expect(RESTRICTED_PAGE_WORDS[locale].failed).toBe(failed);
  });

  it.each([
    ["en-GB", "This box is standing down", "Another box now runs the venue.", "Restarting…"],
    [
      "es-ES",
      "Este servidor se está retirando",
      "Otro servidor lleva ahora el local.",
      "Reiniciando…",
    ],
  ] as const)("provides the %s standing-down words", (locale, title, body, restarting) => {
    expect(STANDING_DOWN_PAGE_WORDS[locale]).toEqual({ title, body, restarting });
  });

  // Reads the module's source as text; it does not observe what loads at runtime.
  it("imports only types", () => {
    const source = readFileSync(new URL("./restricted-page.ts", import.meta.url), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type\b/);
  });
});
