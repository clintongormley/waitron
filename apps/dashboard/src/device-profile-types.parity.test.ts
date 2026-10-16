import { describe, expect, it } from "vitest";
import {
  CAPABILITY_FLAGS as sourceCapabilities,
  FORM_FACTORS as sourceFormFactors,
  PROFILE_ACTIONS as sourceActions,
  PROFILE_SCREENS as sourceScreens,
  NAVIGATION_SCREENS as sourceNavigation,
} from "@waitron/layouts/src/device-types.js";
import {
  isSharedDisplay as sourceIsSharedDisplay,
  validateCapabilities,
} from "@waitron/layouts/src/device-profile.js";
import {
  CAPABILITY_FLAGS,
  FORM_FACTORS,
  PROFILE_ACTIONS,
  PROFILE_SCREENS,
  NAVIGATION_SCREENS,
  isSharedDisplay,
  sharedDisplayMay,
} from "./device-profile-types.js";

describe("device profile browser contract", () => {
  it("preserves the server capability, form factor and navigation choices", () => {
    expect(CAPABILITY_FLAGS).toEqual(sourceCapabilities);
    expect(FORM_FACTORS).toEqual(sourceFormFactors);
    expect(PROFILE_ACTIONS).toEqual(sourceActions);
    expect(PROFILE_SCREENS).toEqual(sourceScreens);
    expect(NAVIGATION_SCREENS).toEqual(sourceNavigation);
  });

  it("shows only the actions and screens the server admits for a shared display", () => {
    for (const formFactor of sourceFormFactors)
      expect(isSharedDisplay(formFactor), formFactor).toBe(sourceIsSharedDisplay(formFactor));
    for (const flag of sourceCapabilities) {
      let allowed = true;
      try {
        validateCapabilities([flag], "kds");
      } catch {
        allowed = false;
      }
      expect(sharedDisplayMay(flag), flag).toBe(allowed);
    }
  });
});
