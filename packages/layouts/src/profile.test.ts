// packages/layouts/src/profile.test.ts
import { describe, expect, it } from "vitest";
import { CARD_TYPES, CAPABILITY_FLAGS, FORM_FACTORS } from "./profile.js";

const noDupes = (t: readonly string[]) => new Set(t).size === t.length;

describe("catalogue tuples", () => {
  it("form factors are unique and include till/phone/kds", () => {
    expect(noDupes(FORM_FACTORS)).toBe(true);
    for (const f of ["till", "phone-portrait", "kds"]) expect(FORM_FACTORS).toContain(f);
  });
  it("card types are unique and include the counter sale cards + big cards", () => {
    expect(noDupes(CARD_TYPES)).toBe(true);
    for (const c of ["product-grid", "basket", "total", "tender-pay", "floor-plan", "kds-board"])
      expect(CARD_TYPES).toContain(c);
  });
  it("capability flags are unique and include payment/drawer/kds", () => {
    expect(noDupes(CAPABILITY_FLAGS)).toBe(true);
    for (const c of ["integrated-card-payment", "open-cash-drawer", "act-as-kds"])
      expect(CAPABILITY_FLAGS).toContain(c);
  });
});
