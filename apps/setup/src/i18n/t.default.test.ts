import { expect, it } from "vitest";
import { currentLocale, t } from "./t.js";

// Asserts the module's startup default, so this file must never call setLocale.

it("starts in British English", () => {
  expect(currentLocale()).toBe("en-GB");
  expect(t("shell.document_title")).toBe("Waitron — set up your server");
});
