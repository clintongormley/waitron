import { afterEach, expect, it } from "vitest";
import { guideHref } from "./help-guide.js";
import { currentLocale, setLocale } from "./i18n/t.js";

const originalLocale = currentLocale();

afterEach(() => setLocale(originalLocale));

it("builds an English link for an English or unknown locale and a Spanish one for es-*, keeping the section", () => {
  const link = "products.nutrition-at-the-till";
  expect(guideHref(link, "en-GB")).toBe("/help/en/products#nutrition-at-the-till");
  expect(guideHref(link, "es-ES")).toBe("/help/es/products#nutrition-at-the-till");
  expect(guideHref(link, "es")).toBe("/help/es/products#nutrition-at-the-till");
  expect(guideHref(link, "fr-FR")).toBe("/help/en/products#nutrition-at-the-till");
});

it("follows the till's language when no locale is given", () => {
  setLocale("es");
  expect(guideHref("products.nutrition-at-the-till")).toBe(
    "/help/es/products#nutrition-at-the-till",
  );
  setLocale("en");
  expect(guideHref("products.nutrition-at-the-till")).toBe(
    "/help/en/products#nutrition-at-the-till",
  );
});
