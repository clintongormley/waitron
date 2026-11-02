import { expect, it } from "vitest";
import { contentLanguageChoices } from "@waitron/shared";
import { validateCatalogueConfiguration } from "./configuration-transfer.js";

const geography = { country: "ES", area: "Barcelona" };
const setting = (languages: unknown, default_language: unknown = "en") => ({
  content_languages: [{ id: 1, default_language, languages }],
});
const invalid = expect.objectContaining({ code: "content.languages_invalid", params: {} });

it("keeps Catalan enabled on import while allowing English as the default", () => {
  expect(() => validateCatalogueConfiguration(setting('["en","es"]'), geography)).toThrowError(
    expect.objectContaining({ code: "content.language_required", params: { language: "ca" } }),
  );
  expect(() =>
    validateCatalogueConfiguration(setting('["en","es","ca"]'), geography),
  ).not.toThrow();
});

it("requires geography for a saved-language row", () => {
  expect(() => validateCatalogueConfiguration(setting('["en"]'))).toThrowError(
    expect.objectContaining({ code: "setup.request_invalid", params: { field: "venue" } }),
  );
});

it("refuses a missing required-language setting but accepts absence without regional requirements", () => {
  expect(() => validateCatalogueConfiguration({ content_languages: [] }, geography)).toThrowError(
    expect.objectContaining({ code: "content.language_required", params: { language: "ca" } }),
  );
  expect(() =>
    validateCatalogueConfiguration({ content_languages: [] }, { country: "GB", area: null }),
  ).not.toThrow();
});

it("refuses multiple saved-language rows before import", () => {
  const row = setting('["en","es","ca"]').content_languages[0]!;
  expect(() =>
    validateCatalogueConfiguration({ content_languages: [row, row] }, geography),
  ).toThrowError(invalid);
});

it.each([
  ["{", "en"],
  ["null", "en"],
  ["{}", "en"],
  ['["en",2]', "en"],
  ['["en","en"]', "en"],
  ['["en"]', "es"],
  ['["en"]', null],
  [["en"], "en"],
  ['["en","not_a_language"]', "en"],
  ['["EN"]', "EN"],
  ['["en","ES-es"]', "en"],
])("refuses malformed language list %j with default %j", (languages, defaultLanguage) => {
  expect(() =>
    validateCatalogueConfiguration(setting(languages, defaultLanguage), geography),
  ).toThrowError(invalid);
});

it("holds an imported setting to 200 languages without changing the saved order", () => {
  const languages = contentLanguageChoices("en")
    .slice(0, 201)
    .map(({ code }) => code);
  const input = setting(JSON.stringify(languages), languages[199]);
  expect(() => validateCatalogueConfiguration(input, { country: "GB", area: null })).toThrowError(
    invalid,
  );
  input.content_languages[0]!.languages = JSON.stringify(languages.slice(0, 200));
  const before = structuredClone(input);
  validateCatalogueConfiguration(input, { country: "GB", area: null });
  expect(input).toEqual(before);
});
