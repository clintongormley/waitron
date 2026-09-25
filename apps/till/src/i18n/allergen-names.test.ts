import { describe, expect, it } from "vitest";
// Deep import, not the barrel, so the browser test does not pull in the whole catalogue.
import { ALLERGEN_CODES } from "@waitron/catalogue/src/allergens.js";

import { ALLERGEN_NAMES, allergenName } from "./allergen-names.js";

describe("allergen names", () => {
  it("names exactly the EU-14 codes, each with a non-empty en and es", () => {
    expect(Object.keys(ALLERGEN_NAMES).sort()).toEqual([...ALLERGEN_CODES].sort());
    for (const c of ALLERGEN_CODES) {
      expect(ALLERGEN_NAMES[c]?.en).toBeTruthy();
      expect(ALLERGEN_NAMES[c]?.es).toBeTruthy();
    }
  });

  it("resolves by locale and falls back to en then the raw code", () => {
    expect(allergenName("milk", "es")).toBe("Leche");
    expect(allergenName("milk", "fr")).toBe(ALLERGEN_NAMES.milk!.en);
    expect(allergenName("unknown", "es")).toBe("unknown");
  });

  it("strips a BCP-47 region subtag before the lookup (es-ES → Spanish)", () => {
    expect(allergenName("milk", "es-ES")).toBe("Leche");
  });
});
