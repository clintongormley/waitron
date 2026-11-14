import { describe, expect, it } from "vitest";
import {
  validateOptionalTranslations,
  mergeOptionalTranslations,
} from "./optional-translations.js";

describe("optional translation maps", () => {
  it.each([
    null,
    undefined,
    [],
    "text",
    42,
    new Date(),
    { es: null },
    { es: 1 },
    { not_a_language: "x" },
    { "es-ES": "Hola" },
    { ES: "Hola" },
  ])("refuses malformed maps or noncanonical keys: %j", (value) => {
    expect(() => validateOptionalTranslations(value)).toThrowError(
      expect.objectContaining({ code: "content.translation_invalid" }),
    );
  });

  it("accepts empty and partial maps without adding a default or staff value", () => {
    expect(validateOptionalTranslations({})).toEqual({});
    expect(
      validateOptionalTranslations({
        en: " Potatoes ",
        es: "  ",
        "ca-ES-valencia": "Valencian potatoes",
      }),
    ).toEqual({ en: "Potatoes", "ca-ES-valencia": "Valencian potatoes" });
  });

  it("bounds each nonblank value by UTF-8 bytes after trimming", () => {
    expect(validateOptionalTranslations({ es: ` ${"é".repeat(2048)} ` })).toEqual({
      es: "é".repeat(2048),
    });
    expect(() => validateOptionalTranslations({ es: "é".repeat(2048) + "a" })).toThrowError(
      expect.objectContaining({ code: "content.translation_invalid" }),
    );
  });
});

describe("full-field replacement", () => {
  const config = { defaultLanguage: "es", languages: ["es", "en"] };
  const stored = { es: "ES potatoes", en: "Potatoes", fr: "FR potatoes" };

  it("replaces enabled values and preserves disabled entries without mutating its inputs", () => {
    const supplied = { en: " Spuds " };
    expect(mergeOptionalTranslations(stored, supplied, config)).toEqual({
      en: "Spuds",
      fr: "FR potatoes",
    });
    expect(stored).toEqual({ es: "ES potatoes", en: "Potatoes", fr: "FR potatoes" });
    expect(supplied).toEqual({ en: " Spuds " });
  });

  it.each([null, {}])("clears enabled entries while retaining disabled text: %j", (supplied) => {
    expect(mergeOptionalTranslations(stored, supplied, config)).toEqual({ fr: "FR potatoes" });
    expect(mergeOptionalTranslations({ es: "ES potatoes" }, supplied, config)).toBeNull();
    expect(mergeOptionalTranslations(null, supplied, config)).toBeNull();
  });

  it("accepts unchanged disabled text but refuses replacing, adding or clearing it", () => {
    expect(mergeOptionalTranslations(stored, { en: "Chips", fr: "FR potatoes" }, config)).toEqual({
      en: "Chips",
      fr: "FR potatoes",
    });
    const changes: Record<string, string>[] = [{ fr: "Frites" }, { de: "Kartoffeln" }, { fr: " " }];
    for (const supplied of changes) {
      expect(() => mergeOptionalTranslations(stored, supplied, config)).toThrowError(
        expect.objectContaining({ code: "content.translation_invalid" }),
      );
    }
  });
});
