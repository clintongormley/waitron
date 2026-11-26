import { describe, expect, it } from "vitest";
import {
  validateOptionalTranslations,
  mergeOptionalTranslations,
} from "./optional-translations.js";

it("reports a malformed translation map as a content translation refusal", () => {
  expect(() => validateOptionalTranslations({ en: 1 })).toThrowError(
    expect.objectContaining({ code: "content.translation_invalid" }),
  );
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

it("saves and clears sparse enabled regional names independently of their main", () => {
  const config = { defaultLanguage: "en", languages: ["en", "en-US"] };
  expect(mergeOptionalTranslations(null, { "en-US": " fries " }, config)).toEqual({
    "en-US": "fries",
  });
  expect(
    mergeOptionalTranslations(
      { en: "chips", "en-US": "fries" },
      { en: "chips", "en-US": " " },
      config,
    ),
  ).toEqual({ en: "chips" });
  expect(
    mergeOptionalTranslations(
      { "en-US": "fries" },
      { en: "chips" },
      { ...config, languages: ["en"] },
    ),
  ).toEqual({ en: "chips", "en-US": "fries" });
});
