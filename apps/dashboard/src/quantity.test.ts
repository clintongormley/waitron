import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "./i18n/t.js";
import { quantity } from "./quantity.js";

const previousLocale = currentLocale();
afterEach(() => setLocale(previousLocale));
it.each([
  ["en-GB", ["1", "0.5", "1.25", "0.125", "10", "100"]],
  ["es-ES", ["1", "0,5", "1,25", "0,125", "10", "100"]],
] as const)("trims and localises quantities in %s", (locale, expected) => {
  setLocale(locale);
  expect(["1.000", "0.500", "1.250", "0.125", "10.000", "100"].map(quantity)).toEqual(expected);
});
