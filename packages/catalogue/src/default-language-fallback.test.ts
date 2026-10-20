import { describe, expect, it } from "vitest";
import { defaultLanguageDescriptions, defaultLanguageText } from "./default-language-text.js";

describe("new default-language snapshots", () => {
  it.each<Record<string, string>>([
    {},
    { fr: "Unrelated customer text" },
    { en: "  ", fr: "Unrelated customer text" },
  ])("uses staff text for receipt keys when the default is absent in %j", (text) => {
    expect(defaultLanguageDescriptions(text, ["es-ES", "en-GB"], "en", "Staff dish")).toEqual({
      "es-ES": "Staff dish",
      "en-GB": "Staff dish",
    });
  });

  it("keeps the default text under exactly the receipt keys", () => {
    expect(
      defaultLanguageDescriptions(
        { en: "Customer dish", fr: "Other text" },
        ["es-ES"],
        "en",
        "Staff dish",
      ),
    ).toEqual({ "es-ES": "Customer dish" });
  });

  it.each<Record<string, string> | null>([null, {}, { fr: "other" }])(
    "prepares an absent default map %j from staff text",
    (text) => {
      expect(defaultLanguageText(text, "en", "staff-unit")).toEqual({ en: "staff-unit" });
    },
  );
});
