import { afterEach, expect, it, vi } from "vitest";
import { conjunctionList } from "./list.js";

afterEach(() => {
  vi.restoreAllMocks();
});

it.each([
  ["en-GB", "Wine, Beer and Soup"],
  ["es-ES", "Wine, Beer y Soup"],
])("joins the items as an 'and' list in the locale given (%s)", (locale, joined) => {
  expect(conjunctionList(["Wine", "Beer", "Soup"], locale)).toBe(joined);
});

it("builds one list formatter per language and reuses it", () => {
  const Original = Intl.ListFormat;
  const built: string[] = [];
  const options: (Intl.ListFormatOptions | undefined)[] = [];
  vi.spyOn(Intl, "ListFormat").mockImplementation(function (
    locale?: Intl.LocalesArgument,
    given?: Intl.ListFormatOptions,
  ) {
    built.push(String(locale));
    options.push(given);
    return new Original(locale, given);
  } as unknown as typeof Intl.ListFormat);
  // Locales no other case in this file uses, so neither is cached before the spy is in place.
  for (const locale of ["fr-FR", "de-DE", "fr-FR", "de-DE"]) {
    conjunctionList(["A", "B"], locale);
    conjunctionList(["A", "B", "C"], locale);
  }
  expect(built).toEqual(["fr-FR", "de-DE"]);
  expect(options).toEqual([{ type: "conjunction" }, { type: "conjunction" }]);
  expect(conjunctionList(["A", "B"], "fr-FR")).toBe("A et B");
  expect(conjunctionList(["A", "B"], "de-DE")).toBe("A und B");
});
