import { describe, expect, it } from "vitest";
import { newCustomerPresentation, newCustomerText } from "./new-customer-text.js";

const config = { defaultLanguage: "en", languages: ["en", "es"] };

describe("new customer text", () => {
  it.each([
    [null, "es", "Staff coffee"],
    [{}, "es", "Staff coffee"],
    [{ fr: "French coffee" }, "es", "Staff coffee"],
    [{ en: "English coffee", fr: "French coffee" }, "es", "English coffee"],
    [{ en: "English coffee", es: "ES coffee" }, "es", "ES coffee"],
    [{ "es-ES": "Spanish coffee" }, "es", "Spanish coffee"],
    [{ es: "ES coffee" }, "es-MX", "ES coffee"],
    [{ en: "English coffee", fr: "French coffee" }, "fr", "English coffee"],
    [{ fr: "French coffee" }, "invalid_!", "Staff coffee"],
    [{ en: " ", es: " " }, "es", "Staff coffee"],
  ] as const)("resolves %j for %s without a third-language fallback", (map, language, want) => {
    expect(newCustomerText(map, "Staff coffee", language, config)).toBe(want);
  });
});

describe("new extra presentation", () => {
  const source = {
    name: "Staff coffee",
    customerName: { fr: "French coffee" },
    kitchenName: "KITCHEN COFFEE",
    variantName: "Staff double",
    variantCustomerName: { es: "ES double" },
    variantKitchenName: "KITCHEN DOUBLE",
  };

  it("resolves parent and variant independently in the requested language", () => {
    expect(newCustomerPresentation(source, "es", config)).toBe("Staff coffee (ES double)");
    expect(newCustomerPresentation(source, "en", config)).toBe("Staff coffee (Staff double)");
  });

  it("uses each half's default text before its own staff text", () => {
    expect(
      newCustomerPresentation(
        {
          ...source,
          customerName: { en: "English coffee" },
          variantCustomerName: { fr: "French size" },
        },
        "es",
        config,
      ),
    ).toBe("English coffee (Staff double)");
    expect(
      newCustomerPresentation(
        {
          ...source,
          customerName: null,
          variantCustomerName: { en: "English double" },
        },
        "es",
        config,
      ),
    ).toBe("Staff coffee (English double)");
  });

  it("keeps the raw source facts so a future consumer can use another default", () => {
    const before = structuredClone(source);
    expect(newCustomerPresentation(source, "en", config)).toBe("Staff coffee (Staff double)");
    expect(
      newCustomerPresentation(source, "fr", {
        defaultLanguage: "fr",
        languages: ["fr", "es"],
      }),
    ).toBe("French coffee (Staff double)");
    expect(source).toEqual(before);
  });

  it("omits a nonexistent variant and avoids empty parentheses", () => {
    expect(newCustomerPresentation({ ...source, variantName: null }, "es", config)).toBe(
      "Staff coffee",
    );
    expect(
      newCustomerPresentation(
        { ...source, variantName: "", variantCustomerName: null },
        "en",
        config,
      ),
    ).toBe("Staff coffee");
    expect(newCustomerPresentation({ ...source, name: "", customerName: null }, "en", config)).toBe(
      "Staff double",
    );
  });
});
