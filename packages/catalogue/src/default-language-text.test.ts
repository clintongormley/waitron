import { describe, expect, it } from "vitest";

import { defaultLanguageDescriptions, defaultLanguageText } from "./default-language-text.js";

describe("defaultLanguageDescriptions", () => {
  it("gives every receipt key the default content language's text", () => {
    expect(
      defaultLanguageDescriptions({ es: "Café", ca: "Cafè" }, ["ca-ES", "es-ES"], "es"),
    ).toEqual({ "ca-ES": "Café", "es-ES": "Café" });
  });

  it("takes the alphabetically first other language's text when the default has none", () => {
    expect(
      defaultLanguageDescriptions({ fr: "Croissant", ca: "Croissant CA" }, ["es-ES"], "es"),
    ).toEqual({ "es-ES": "Croissant CA" });
  });

  it("answers an empty string for every key when no language has text", () => {
    expect(defaultLanguageDescriptions({}, ["ca-ES", "es-ES"], "es")).toEqual({
      "ca-ES": "",
      "es-ES": "",
    });
  });
});

describe("defaultLanguageText", () => {
  it("keeps one entry, under the default content language", () => {
    expect(defaultLanguageText({ ca: "u.", es: "ud", en: "ea" }, "es")).toEqual({ es: "ud" });
  });

  it("keeps a missing map missing", () => {
    expect(defaultLanguageText(null, "es")).toBeNull();
  });
});
