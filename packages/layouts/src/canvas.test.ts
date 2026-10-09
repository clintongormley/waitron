import { describe, expect, it } from "vitest";
import type { DeviceKind, FormFactor } from "./canvas.js";
import {
  CARD_TYPES,
  CAPABILITY_FLAGS,
  FORM_FACTORS,
  NAVIGATION_SCREENS,
  PROFILE_ACTIONS,
  PROFILE_SCREENS,
  kindOfFormFactor,
} from "./canvas.js";

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
  it("capability flags are unique and include payment/drawer/kds/printing and the three screens", () => {
    expect(noDupes(CAPABILITY_FLAGS)).toBe(true);
    for (const c of [
      "integrated-card-payment",
      "open-cash-drawer",
      "act-as-kds",
      "print-receipt",
      "show-station",
      "show-expo",
      "show-schedule",
    ])
      expect(CAPABILITY_FLAGS).toContain(c);
  });
});

describe("profile actions and screens", () => {
  it("split the capability flags into two subsets that together are the whole list", () => {
    expect(noDupes([...PROFILE_ACTIONS, ...PROFILE_SCREENS])).toBe(true);
    expect([...PROFILE_ACTIONS, ...PROFILE_SCREENS].sort()).toEqual([...CAPABILITY_FLAGS].sort());
  });

  it("names an action for taking orders, cash, both card payments, preparing, handing over, printing and the drawer", () => {
    expect([...PROFILE_ACTIONS].sort()).toEqual(
      [
        "take-orders",
        "take-cash",
        "integrated-card-payment",
        "hand-keyed-card-payment",
        "prepare-orders",
        "hand-over-orders",
        "print-receipt",
        "open-cash-drawer",
      ].sort(),
    );
  });

  it("keeps the show-* switches and the kitchen board as screens, and only the show-* ones are navigation screens", () => {
    expect([...PROFILE_SCREENS].sort()).toEqual(
      ["act-as-kds", "show-station", "show-expo", "show-schedule", "run-the-pass"].sort(),
    );
    expect([...NAVIGATION_SCREENS]).toEqual(["show-station", "show-expo", "show-schedule"]);
  });

  it("keeps every existing flag at its position, adding the new ones after them", () => {
    expect(CAPABILITY_FLAGS.slice(0, 8)).toEqual([
      "integrated-card-payment",
      "open-cash-drawer",
      "act-as-kds",
      "print-receipt",
      "show-station",
      "show-expo",
      "show-schedule",
      "take-cash",
    ]);
  });
});

describe("run-the-pass", () => {
  it("is a screen setting, not an action the server checks", () => {
    expect(CAPABILITY_FLAGS).toContain("run-the-pass");
    expect(PROFILE_SCREENS).toContain("run-the-pass");
    expect(PROFILE_ACTIONS).not.toContain("run-the-pass");
    expect(NAVIGATION_SCREENS).not.toContain("run-the-pass");
  });
});

describe("kindOfFormFactor", () => {
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
