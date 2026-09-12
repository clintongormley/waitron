// packages/layouts/src/canvas.test.ts
import { describe, expect, it } from "vitest";
import type { DeviceKind, FormFactor } from "./canvas.js";
import { CARD_TYPES, CAPABILITY_FLAGS, FORM_FACTORS, kindOfFormFactor } from "./canvas.js";

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
  it("capability flags are unique and include payment/drawer/kds/printing", () => {
    expect(noDupes(CAPABILITY_FLAGS)).toBe(true);
    for (const c of ["integrated-card-payment", "open-cash-drawer", "act-as-kds", "print-receipt"])
      expect(CAPABILITY_FLAGS).toContain(c);
  });
});

describe("kindOfFormFactor", () => {
  // Table over EVERY form factor (typed as Record<FormFactor, …>, so a new form factor fails to
  // compile until it gets a row here) → the device kind it collapses to. Two form factors map to
  // `handheld`; the mapping is many-to-one by design.
  const expected: Record<FormFactor, DeviceKind> = {
    till: "till",
    kds: "kds_station",
    "phone-portrait": "handheld",
    "tablet-landscape": "handheld",
  };

  for (const ff of FORM_FACTORS) {
    it(`maps ${ff} to ${expected[ff]}`, () => {
      expect(kindOfFormFactor(ff)).toBe(expected[ff]);
    });
  }
});
