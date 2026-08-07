import { describe, expect, it } from "vitest";
// Deep import (not the barrel) so the browser test doesn't pull the whole catalogue —
// the same decoupling the till already uses for `@waitron/catalogue/src/pricing.js`.
// This ties the name table to Task 1's canonical list so a drift in either is caught here.
import { ALLERGEN_CODES } from "@waitron/catalogue/src/allergens.js";

import { ALLERGEN_NAMES, allergenName } from "./allergen-names.js";

describe("allergen names", () => {
  it("names exactly the EU-14 codes, each with a non-empty en and es", () => {
    // Key set must equal Task 1's ALLERGEN_CODES exactly — none missing, none extra.
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
});
