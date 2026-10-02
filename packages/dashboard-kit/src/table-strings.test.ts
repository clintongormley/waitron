import { afterEach, expect, it } from "vitest";
import { setLocale } from "./i18n.js";
import { tableNoMatches } from "./table-strings.js";

afterEach(() => {
  setLocale("es-ES");
});

it("says the search or the filters hide every row, in English", () => {
  expect(tableNoMatches("en")).toBe("Nothing matches your search or filters.");
});

it("says the search or the filters hide every row, in Spanish", () => {
  expect(tableNoMatches("es")).toBe("Nada coincide con tu búsqueda ni con tus filtros.");
});

it("strips a region from the locale", () => {
  expect(tableNoMatches("es-ES")).toBe("Nada coincide con tu búsqueda ni con tus filtros.");
});

it("falls back to English for a language it has no sentence for", () => {
  expect(tableNoMatches("fr")).toBe("Nothing matches your search or filters.");
});

it("reads the active locale when none is passed", () => {
  setLocale("en-GB");
  expect(tableNoMatches()).toBe("Nothing matches your search or filters.");
  setLocale("es-ES");
  expect(tableNoMatches()).toBe("Nada coincide con tu búsqueda ni con tus filtros.");
});
