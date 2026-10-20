import { describe, expect, it } from "vitest";
import { ALLERGEN_CODES, CEREAL_KINDS, NUT_KINDS } from "../packages/catalogue/src/allergens.js";
import {
  ALLERGEN_NAMES as printedNames,
  kitchenAllergenLabel,
  KITCHEN_ALLERGY_WORDS,
} from "../apps/server/src/i18n/kitchen-allergy.js";
import { ALLERGEN_NAMES, allergenLabel } from "../apps/till/src/i18n/allergen-names.js";
import { en, es } from "../apps/till/src/i18n/strings.js";

describe("A669 kitchen words", () => {
  it("captures the same EU-14 names and every allowed cereal/nut kind that the till shows", () => {
    expect(printedNames).toEqual(ALLERGEN_NAMES);
    for (const locale of ["en", "es"] as const) {
      for (const code of ALLERGEN_CODES) {
        expect(kitchenAllergenLabel(code, {}, locale)).toBe(allergenLabel(code, {}, locale));
      }
      for (const [code, kinds] of [
        ["gluten", CEREAL_KINDS],
        ["nuts", NUT_KINDS],
      ] as const) {
        for (const kind of kinds)
          expect(kitchenAllergenLabel(code, { kinds: [kind] }, locale)).toBe(
            allergenLabel(code, { kinds: [kind] }, locale),
          );
      }
    }
  });
  it("uses the same change/removal packet on paper and screens in both languages", () => {
    for (const language of ["en", "es"] as const) {
      const strings = language === "en" ? en : es;
      expect(strings["station.notice.allergy_changed"].toLocaleUpperCase(language)).toBe(
        KITCHEN_ALLERGY_WORDS[language].changed,
      );
      expect(strings["station.notice.allergy_removed"].toLocaleUpperCase(language)).toBe(
        KITCHEN_ALLERGY_WORDS[language].removed,
      );
      expect(strings["kitchen_allergy.clash"].toLocaleUpperCase(language)).toBe(
        KITCHEN_ALLERGY_WORDS[language].clash.replace(/^!! /, "").toLocaleUpperCase(language),
      );
    }
  });
});
