import { expect, it } from "vitest";
import { currentLocale, t } from "./t.js";

// Asserts the PRISTINE module startup default. Under Vitest's per-file isolation t.js is imported fresh
// here; because this file NEVER calls setLocale, currentLocale() reads the shipped value unmasked by
// sibling t.test.ts's afterEach reset. Keep this file mutation-free.

it("ships English (en-GB) as the module startup default locale", () => {
  expect(currentLocale()).toBe("en-GB");
  expect(t("action.pay")).toBe("Pay");
});
