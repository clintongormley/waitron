import { expect, it } from "vitest";
import { currentLocale, t } from "./t.js";

// Asserts the module's startup default, so this file must never call setLocale.

it("ships English (en-GB) as the module startup default locale", () => {
  expect(currentLocale()).toBe("en-GB");
  expect(t("action.pay")).toBe("Pay");
});
