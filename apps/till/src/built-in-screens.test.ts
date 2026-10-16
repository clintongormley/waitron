import { describe, expect, it } from "vitest";
import type { FormFactor } from "./layout.js";
import { builtInScreensFor, homeScreenFor, resolveBuiltInScreen } from "./built-in-screens.js";

describe("fixed device destinations", () => {
  const cases = [
    { formFactor: "till", screens: ["counter", "floor"], home: "counter" },
    { formFactor: "phone-portrait", screens: ["floor", "order"], home: "floor" },
    { formFactor: "tablet-landscape", screens: ["floor", "order"], home: "floor" },
    { formFactor: "kds", screens: ["kitchen"], home: "kitchen" },
  ] satisfies { formFactor: FormFactor; screens: string[]; home: string }[];

  for (const { formFactor, screens, home } of cases) {
    it(`${formFactor} offers its fixed destinations in home order`, () => {
      expect(builtInScreensFor(formFactor)).toEqual(screens);
      expect(homeScreenFor(formFactor)).toBe(home);
    });

    it(`${formFactor} restores only its own fixed destinations`, () => {
      for (const requested of screens)
        expect(resolveBuiltInScreen(formFactor, requested)).toBe(requested);
      for (const requested of [
        null,
        "",
        "custom-sale",
        "station",
        "schedule",
        "constructor",
        "__proto__",
      ])
        expect(resolveBuiltInScreen(formFactor, requested)).toBe(home);
    });
  }

  it("rejects a primary destination belonging to another kind of device", () => {
    expect(resolveBuiltInScreen("till", "order")).toBe("counter");
    expect(resolveBuiltInScreen("phone-portrait", "counter")).toBe("floor");
    expect(resolveBuiltInScreen("tablet-landscape", "kitchen")).toBe("floor");
    expect(resolveBuiltInScreen("kds", "floor")).toBe("kitchen");
  });
});
