import { describe, expect, it } from "vitest";
import { prepareUnitSnapshot, unitPresentation } from "./unit-presentation.js";
import { grossBasketWithOptions, priceBasket, rateLines } from "./pricing.js";

const config = { defaultLanguage: "en", languages: ["en", "es"] };
const unit = {
  staffName: "Staff kilogram",
  staffAbbreviation: "staff-kg",
  name: { en: "English kilogram", es: "Spanish kilogram", fr: "Disabled kilogram" },
  abbreviation: { en: "en-kg", es: "es-kg", fr: "fr-kg" },
};

describe("unitPresentation", () => {
  it("resolves the requested enabled language without mutating stored maps", () => {
    const stored = structuredClone(unit);
    expect(unitPresentation(unit, "es-ES", config)).toEqual({
      name: "Spanish kilogram",
      abbreviation: "es-kg",
    });
    expect(unit).toEqual(stored);
  });

  it.each([
    [{ es: "Spanish kilogram" }, { en: "en-kg" }, "Spanish kilogram", "en-kg"],
    [{ en: "English kilogram" }, { es: "es-kg" }, "English kilogram", "es-kg"],
    [{}, { en: "en-kg" }, "Staff kilogram", "en-kg"],
    [{ en: "English kilogram" }, {}, "English kilogram", "staff-kg"],
    [{}, {}, "Staff kilogram", "staff-kg"],
    [{ es: "  " }, { es: "  " }, "Staff kilogram", "staff-kg"],
    [{ fr: "Disabled kilogram" }, { fr: "fr-kg" }, "Staff kilogram", "staff-kg"],
  ] as const)(
    "resolves each field independently (%j, %j)",
    (name, abbreviation, wantName, wantAbbreviation) => {
      expect(unitPresentation({ ...unit, name, abbreviation }, "es", config)).toEqual({
        name: wantName,
        abbreviation: wantAbbreviation,
      });
    },
  );

  it.each(["fr", "fr-FR", "invalid_!", ""])("ignores an unavailable preference %j", (language) => {
    expect(unitPresentation(unit, language, config)).toEqual({
      name: "English kilogram",
      abbreviation: "en-kg",
    });
  });
});

describe("preparing a future unit snapshot", () => {
  it.each([
    [{}, "staff-kg"],
    [{ fr: "fr-kg" }, "staff-kg"],
    [{ es: "es-kg" }, "staff-kg"],
    [{ en: "en-kg", es: "es-kg" }, "en-kg"],
  ] as const)("freezes only the default abbreviation from %j", (abbreviation, want) => {
    const source = { ...unit, abbreviation, precision: 3 };
    const original = structuredClone(source);
    const prepared = prepareUnitSnapshot(source, config);
    expect(prepared).toEqual({ ...original, abbreviation: { en: want } });
    expect(prepared).not.toBe(source);
    expect(source).toEqual(original);
  });

  it("keeps quantities, prices and VAT while carrying a prepared staff abbreviation", () => {
    const prepared = prepareUnitSnapshot(
      { ...unit, name: {}, abbreviation: {}, precision: 3 },
      config,
    );
    const product = {
      name: "Staff coffee",
      descriptions: { en: "Guest coffee" },
      unit: prepared,
      unitPrice: "12.10",
      vatClass: "general" as const,
      category: "Drinks",
    };
    const direct = priceBasket([{ product, quantity: "0.500" }], "2026-09-27");
    const withOptions = rateLines(
      grossBasketWithOptions([{ product, quantity: "0.500", options: [] }]),
      "2026-09-27",
    );
    expect(direct).toEqual(withOptions);
    expect(direct).toMatchObject({
      total: "6.05",
      vatBreakdown: [{ rate: "21.00", base: "5.00", tax: "1.05" }],
      lines: [
        {
          quantity: "0.500",
          unitName: { en: "staff-kg" },
          unitPrecision: 3,
          lineGross: "6.05",
          lineTotal: "5.00",
          unitPrice: "10.00",
          vatRate: "21.00",
        },
      ],
    });
  });
});
