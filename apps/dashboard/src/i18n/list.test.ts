import { afterEach, expect, it } from "vitest";
import { conjunctionList } from "./list.js";
import { setLocale } from "./t.js";

afterEach(() => {
  setLocale("es-ES");
});

it.each([
  ["en-GB", "Wine, Beer and Soup"],
  ["es-ES", "Wine, Beer y Soup"],
])("joins the items as an 'and' list in the current locale (%s)", (locale, joined) => {
  setLocale(locale);
  expect(conjunctionList(["Wine", "Beer", "Soup"])).toBe(joined);
});
