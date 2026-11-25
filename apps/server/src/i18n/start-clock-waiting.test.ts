import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";
import { START_CLOCK_WAITING_WORDS } from "./start-clock-waiting.js";

describe("restore's clock-waiting page wording", () => {
  it.each([
    ["en-GB", "Master key", "Enter the selected backup’s master key."],
    ["es-ES", "Clave maestra", "Introduce la clave maestra de la copia elegida."],
  ] as const)("names the key in %s as every master-key field does", (locale, label, refused) => {
    expect(START_CLOCK_WAITING_WORDS[locale].keyLabel).toBe(label);
    expect(START_CLOCK_WAITING_WORDS[locale].keyRefused).toBe(refused);
  });

  it.each([
    ["en-GB", "en"],
    ["es-ES", "es"],
  ] as const)("its field's words in %s are every master-key field's", (locale, pack) => {
    const words = START_CLOCK_WAITING_WORDS[locale];
    const field = MASTER_KEY_FIELD_WORDS[pack];
    expect(words.keyLabel).toBe(field.label);
    expect(words.wrongKey.replace("{keyName}", "2026-11-23 · QZJV")).toBe(
      field.wrongKey("2026-11-23 · QZJV"),
    );
  });

  it("ends its explanation asking for the master key", () => {
    expect(START_CLOCK_WAITING_WORDS["en-GB"].why).toMatch(
      / If that page is closed, type the master key below to confirm the time from this device\.$/,
    );
    expect(START_CLOCK_WAITING_WORDS["es-ES"].why).toMatch(
      / Si esa página está cerrada, escribe abajo la clave maestra para confirmar la hora desde este dispositivo\.$/,
    );
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
