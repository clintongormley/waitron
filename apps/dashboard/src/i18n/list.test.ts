import { afterEach, expect, it, vi } from "vitest";
import { conjunctionList } from "./list.js";
import { setLocale } from "./t.js";

afterEach(() => {
  vi.restoreAllMocks();
  setLocale("es-ES");
});

it.each([
  ["en-GB", "Wine, Beer and Soup"],
  ["es-ES", "Wine, Beer y Soup"],
])("joins the items as an 'and' list in the current locale (%s)", (locale, joined) => {
  setLocale(locale);
  expect(conjunctionList(["Wine", "Beer", "Soup"])).toBe(joined);
});

it("builds one list formatter per language and reuses it", () => {
  const Original = Intl.ListFormat;
  const built: string[] = [];
  vi.spyOn(Intl, "ListFormat").mockImplementation(function (
    locale?: Intl.LocalesArgument,
    options?: Intl.ListFormatOptions,
  ) {
    built.push(String(locale));
    return new Original(locale, options);
  } as unknown as typeof Intl.ListFormat);
  // Locales no other case in this file uses, so neither is cached before the spy is in place.
  for (const locale of ["fr-FR", "de-DE", "fr-FR", "de-DE"]) {
    setLocale(locale);
    conjunctionList(["A", "B"]);
    conjunctionList(["A", "B", "C"]);
  }
  expect(built).toEqual(["fr-FR", "de-DE"]);
  setLocale("fr-FR");
  expect(conjunctionList(["A", "B"])).toBe("A et B");
});
