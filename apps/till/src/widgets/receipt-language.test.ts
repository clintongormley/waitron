import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { receiptLanguageLabel } from "./receipt-language.js";
const original = currentLocale();
afterEach(() => setLocale(original));
it("names a supplied receipt variant using the country pack", () => {
  setLocale("en");
  expect(receiptLanguageLabel("ca-ES-valencia")).toBe("Receipt: Valencian");
});
