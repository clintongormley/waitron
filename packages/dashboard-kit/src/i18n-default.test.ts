import { expect, it } from "vitest";
import { currentLocale, registerCatalogue, t } from "./i18n.js";

it("shows English before a locale choice arrives", () => {
  registerCatalogue({ en: { "default.greeting": "Hello" }, es: { "default.greeting": "Hola" } });
  expect(currentLocale()).toBe("en-GB");
  expect(t("default.greeting")).toBe("Hello");
});
