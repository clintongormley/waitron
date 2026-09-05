import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  validateCapabilities,
  DEFAULT_PROFILE_CAPABILITIES,
  DEFAULT_DEVICE_PROFILES,
  defaultProfileName,
} from "./device-profile.js";
import { FORM_FACTORS, CAPABILITY_FLAGS } from "./canvas.js";

describe("validateCapabilities", () => {
  it("accepts a valid flag array unchanged", () => {
    expect(validateCapabilities(["open-cash-drawer", "integrated-card-payment"])).toEqual([
      "open-cash-drawer",
      "integrated-card-payment",
    ]);
  });
  it("dedupes, keeping FIRST-SEEN order (exact output, not a superset)", () => {
    // A duplicate in the input must collapse to one, and the surviving order is first-seen — pinned
    // with an order-sensitive `toEqual` on the exact array, since `validateCapabilities` is the
    // security-relevant fail-closed gate driving the /api/pay + /api/drawer firewall.
    expect(
      validateCapabilities(["open-cash-drawer", "integrated-card-payment", "open-cash-drawer"]),
    ).toEqual(["open-cash-drawer", "integrated-card-payment"]);
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
      expect((e as AppError).params).toEqual({ reason: "bad_capabilities" });
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

describe("DEFAULT_DEVICE_PROFILES", () => {
  it("is the three-entry starter set: Counter (till), Kitchen (kds), Handheld (phone-portrait)", () => {
    expect(DEFAULT_DEVICE_PROFILES.map((p) => p.formFactor)).toEqual([
      "till",
      "kds",
      "phone-portrait",
    ]);
  });

  it("carries the form-factor default capabilities for each entry", () => {
    for (const profile of DEFAULT_DEVICE_PROFILES) {
      expect(profile.capabilities).toEqual(DEFAULT_PROFILE_CAPABILITIES[profile.formFactor]);
    }
  });

  it("names every entry in both es and en", () => {
    for (const profile of DEFAULT_DEVICE_PROFILES) {
      expect(typeof profile.nameByLocale.es).toBe("string");
      expect(typeof profile.nameByLocale.en).toBe("string");
      expect(profile.nameByLocale.es!.length).toBeGreaterThan(0);
      expect(profile.nameByLocale.en!.length).toBeGreaterThan(0);
    }
  });

  it("uses the owner-decided Spanish and English names", () => {
    const byFormFactor = Object.fromEntries(DEFAULT_DEVICE_PROFILES.map((p) => [p.formFactor, p]));
    expect(byFormFactor.till!.nameByLocale).toEqual({ es: "Mostrador", en: "Counter" });
    expect(byFormFactor.kds!.nameByLocale).toEqual({ es: "Cocina", en: "Kitchen" });
    expect(byFormFactor["phone-portrait"]!.nameByLocale).toEqual({ es: "Móvil", en: "Handheld" });
  });
});

describe("defaultProfileName", () => {
  const till = DEFAULT_DEVICE_PROFILES.find((p) => p.formFactor === "till")!;

  it("resolves the language subtag of a full invoice-locale tag", () => {
    expect(defaultProfileName(till, "es-ES")).toBe("Mostrador");
    expect(defaultProfileName(till, "en-GB")).toBe("Counter");
  });

  it("is case-insensitive on the language subtag", () => {
    expect(defaultProfileName(till, "ES-es")).toBe("Mostrador");
  });

  it("falls back to Spanish for a locale the map does not cover", () => {
    expect(defaultProfileName(till, "fr-FR")).toBe("Mostrador");
    expect(defaultProfileName(till, "")).toBe("Mostrador");
  });
});
