import { describe, expect, it } from "vitest";

import { defaultLanguageDescriptions, defaultLanguageText } from "./default-language-text.js";

describe("defaultLanguageDescriptions", () => {
  it("gives every receipt key the default content language's text", () => {
    expect(
      defaultLanguageDescriptions(
        { es: "Customer coffee", ca: "Other coffee" },
        ["ca-ES", "es-ES"],
        "es",
        "Staff dish",
      ),
    ).toEqual({ "ca-ES": "Customer coffee", "es-ES": "Customer coffee" });
  });

  it("uses the staff name when the default has none", () => {
    expect(
      defaultLanguageDescriptions(
        { fr: "Croissant", ca: "Croissant CA" },
        ["es-ES"],
        "es",
        "Staff pastry",
      ),
    ).toEqual({ "es-ES": "Staff pastry" });
  });

  it("uses the staff name for every key when no language has text", () => {
    expect(defaultLanguageDescriptions({}, ["ca-ES", "es-ES"], "es", "Staff dish")).toEqual({
      "ca-ES": "Staff dish",
      "es-ES": "Staff dish",
    });
  });
});

describe("defaultLanguageText", () => {
  it("keeps one entry, under the default content language", () => {
    expect(defaultLanguageText({ ca: "u.", es: "ud", en: "ea" }, "es", "staff-unit")).toEqual({
      es: "ud",
    });
  });

  it("fills a missing map from the staff value", () => {
    expect(defaultLanguageText(null, "es", "staff-unit")).toEqual({ es: "staff-unit" });
  });
});
