import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { validateCapabilities, DEFAULT_PROFILE_CAPABILITIES } from "./device-profile.js";
import { FORM_FACTORS, CAPABILITY_FLAGS } from "./canvas.js";

describe("validateCapabilities", () => {
  it("accepts a valid flag array and dedupes order-independently", () => {
    expect(validateCapabilities(["open-cash-drawer", "integrated-card-payment"])).toEqual(
      expect.arrayContaining(["open-cash-drawer", "integrated-card-payment"]),
    );
  });
  it("accepts an empty array", () => {
    expect(validateCapabilities([])).toEqual([]);
  });
  it("rejects a non-array", () => {
    expect(() => validateCapabilities("integrated-card-payment")).toThrow(AppError);
  });
  it("rejects an unknown flag (fail-closed) with device_profile.invalid", () => {
    try {
      validateCapabilities(["not-a-flag"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("device_profile.invalid");
    }
  });
});

describe("DEFAULT_PROFILE_CAPABILITIES", () => {
  it("covers every form factor with only known flags", () => {
    for (const ff of FORM_FACTORS) {
      const caps = DEFAULT_PROFILE_CAPABILITIES[ff];
      expect(Array.isArray(caps)).toBe(true);
      for (const c of caps) expect(CAPABILITY_FLAGS).toContain(c);
    }
  });
  it("gives the till the reader + drawer defaults and the kds act-as-kds", () => {
    expect(DEFAULT_PROFILE_CAPABILITIES.till).toEqual([
      "integrated-card-payment",
      "open-cash-drawer",
    ]);
    expect(DEFAULT_PROFILE_CAPABILITIES.kds).toEqual(["act-as-kds"]);
    expect(DEFAULT_PROFILE_CAPABILITIES["phone-portrait"]).toEqual([]);
  });
});
