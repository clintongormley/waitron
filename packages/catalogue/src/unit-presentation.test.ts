import { describe, expect, it } from "vitest";
import { unitPresentation } from "./unit-presentation.js";

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
