import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  isSharedDisplay,
  profileAllows,
  validateCapabilities,
  validateInactivityTimeout,
  validateStartingScreen,
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
    expect(
      validateCapabilities(["open-cash-drawer", "integrated-card-payment", "open-cash-drawer"]),
    ).toEqual(["open-cash-drawer", "integrated-card-payment"]);
  });
  it("accepts the three screen switches", () => {
    expect(validateCapabilities(["show-station", "show-expo", "show-schedule"])).toEqual([
      "show-station",
      "show-expo",
      "show-schedule",
    ]);
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

describe("validateCapabilities on a shared display", () => {
  it("refuses a kitchen display an ordering, payment or drawer action", () => {
    for (const flag of [
      "take-orders",
      "take-cash",
      "integrated-card-payment",
      "hand-keyed-card-payment",
      "open-cash-drawer",
    ]) {
      try {
        validateCapabilities(["act-as-kds", flag], "kds");
        throw new Error(`accepted ${flag}`);
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe("device_profile.invalid");
        expect((e as AppError).params).toEqual({ reason: "shared_display_action" });
      }
    }
  });

  it("accepts a kitchen display's prepare action and screens", () => {
    expect(validateCapabilities(["act-as-kds", "prepare-orders", "show-expo"], "kds")).toEqual([
      "act-as-kds",
      "prepare-orders",
      "show-expo",
    ]);
  });

  it("accepts the same ordering and payment actions on a named-login form factor", () => {
    expect(validateCapabilities(["take-orders", "take-cash", "open-cash-drawer"], "till")).toEqual([
      "take-orders",
      "take-cash",
      "open-cash-drawer",
    ]);
  });
});

describe("profileAllows", () => {
  it("allows a named-login profile exactly the actions it lists", () => {
    const profile = { formFactor: "till", capabilities: ["take-orders", "show-station"] } as const;
    expect(profileAllows(profile, "take-orders")).toBe(true);
    expect(profileAllows(profile, "prepare-orders")).toBe(false);
  });

  it("does not read a screen as permission for the action on it", () => {
    const viewOnly = {
      formFactor: "tablet-landscape",
      capabilities: ["show-station", "show-expo"],
    } as const;
    expect(profileAllows(viewOnly, "prepare-orders")).toBe(false);
    expect(profileAllows(viewOnly, "hand-over-orders")).toBe(false);
  });

  it("refuses a shared display ordering, payment and drawer actions even when listed", () => {
    const stored = {
      formFactor: "kds",
      capabilities: ["take-orders", "take-cash", "open-cash-drawer", "prepare-orders"],
    } as const;
    expect(profileAllows(stored, "take-orders")).toBe(false);
    expect(profileAllows(stored, "take-cash")).toBe(false);
    expect(profileAllows(stored, "open-cash-drawer")).toBe(false);
    expect(profileAllows(stored, "prepare-orders")).toBe(true);
  });

  it("derives the shared display from the kds form factor alone", () => {
    expect(isSharedDisplay("kds")).toBe(true);
    for (const ff of ["till", "phone-portrait", "tablet-landscape"] as const)
      expect(isSharedDisplay(ff)).toBe(false);
  });
});

describe("validateStartingScreen", () => {
  const caps = ["take-orders", "show-expo", "show-schedule"] as const;

  it("accepts null, meaning the canvas's own first view", () => {
    expect(validateStartingScreen(null, caps)).toBeNull();
  });

  it("accepts a navigation screen the profile shows", () => {
    expect(validateStartingScreen("show-expo", caps)).toBe("show-expo");
  });

  for (const bad of ["show-station", "take-orders", "act-as-kds", "counter", 3, ""]) {
    it(`refuses ${JSON.stringify(bad)}`, () => {
      try {
        validateStartingScreen(bad, [...caps, "act-as-kds"]);
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).params).toEqual({ reason: "bad_starting_screen" });
      }
    });
  }
});

describe("validateInactivityTimeout", () => {
  it("returns a positive integer unchanged for a non-kds form factor", () => {
    expect(validateInactivityTimeout(300, "phone-portrait")).toBe(300);
    expect(validateInactivityTimeout(1, "till")).toBe(1);
  });

  it("passes null through as null (never log out)", () => {
    expect(validateInactivityTimeout(null, "till")).toBeNull();
  });

  it("rejects 0 — NULL is the 'never' sentinel, so a zero timeout is not a valid value", () => {
    try {
      validateInactivityTimeout(0, "till");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("device_profile.invalid");
      expect((e as AppError).params).toEqual({ reason: "bad_inactivity_timeout" });
    }
  });

  it("FORCES null for a kds profile regardless of the value (a display is not a logged-in operator)", () => {
    expect(validateInactivityTimeout(300, "kds")).toBeNull();
    expect(validateInactivityTimeout(null, "kds")).toBeNull();
  });

  it("rejects a negative value with device_profile.invalid {bad_inactivity_timeout}", () => {
    try {
      validateInactivityTimeout(-5, "till");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("device_profile.invalid");
      expect((e as AppError).params).toEqual({ reason: "bad_inactivity_timeout" });
    }
  });

  it("rejects a non-integer value", () => {
    expect(() => validateInactivityTimeout(1.5, "till")).toThrow(AppError);
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
  it("gives the till the reader + drawer + receipt + screen + cash defaults and the kds act-as-kds", () => {
    expect(DEFAULT_PROFILE_CAPABILITIES.till).toEqual([
      "integrated-card-payment",
      "open-cash-drawer",
      "print-receipt",
      "show-station",
      "show-expo",
      "show-schedule",
      "take-cash",
      "take-orders",
      "hand-keyed-card-payment",
      "prepare-orders",
      "hand-over-orders",
    ]);
    expect(DEFAULT_PROFILE_CAPABILITIES.kds).toEqual(["act-as-kds", "prepare-orders"]);
    expect(DEFAULT_PROFILE_CAPABILITIES["phone-portrait"]).toEqual([
      "take-orders",
      "hand-keyed-card-payment",
      "prepare-orders",
      "hand-over-orders",
    ]);
    expect(DEFAULT_PROFILE_CAPABILITIES["tablet-landscape"]).toEqual([]);
    expect(validateCapabilities(["take-cash"])).toEqual(["take-cash"]);
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

  it("seeds the till and handheld with a 300 s inactivity timeout; kds carries none", () => {
    const byFormFactor = Object.fromEntries(DEFAULT_DEVICE_PROFILES.map((p) => [p.formFactor, p]));
    expect(byFormFactor["phone-portrait"]!.inactivityTimeoutSeconds).toBe(300);
    expect(byFormFactor.till!.inactivityTimeoutSeconds).toBe(300);
    expect(byFormFactor.kds!.inactivityTimeoutSeconds ?? null).toBeNull();
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
