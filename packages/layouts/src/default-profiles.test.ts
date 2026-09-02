import { describe, expect, it } from "vitest";
import { FORM_FACTORS } from "./profile.js";
import { validateProfile } from "./validate-profile.js";
import { DEFAULT_PROFILES } from "./default-profiles.js";

describe("default profiles", () => {
  it("ships a profile for every form factor", () => {
    for (const f of FORM_FACTORS) expect(DEFAULT_PROFILES[f]).toBeDefined();
  });
  it("every default profile passes validateProfile", () => {
    for (const f of FORM_FACTORS) expect(() => validateProfile(DEFAULT_PROFILES[f])).not.toThrow();
  });
  it("the till default is a selling profile (has the sale-critical cards)", () => {
    const till = validateProfile(DEFAULT_PROFILES.till);
    const placed = new Set(till.tabs.flatMap((t) => t.cards.map((c) => c.type)));
    for (const c of ["product-grid", "basket", "total", "tender-pay"])
      expect(placed.has(c as never)).toBe(true);
  });
});
