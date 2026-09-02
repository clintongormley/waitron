import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("@waitron/layouts barrel", () => {
  it("exports the new profile surface", () => {
    expect(api.FORM_FACTORS).toBeDefined();
    expect(api.CARD_CONTRACTS).toBeDefined();
    expect(typeof api.validateProfile).toBe("function");
    expect(typeof api.validateThemeOverride).toBe("function");
    expect(api.DEFAULT_PROFILES.till).toBeDefined();
  });
  it("still exports the existing widget surface (transitional coexistence)", () => {
    expect(api.WIDGET_TYPES).toBeDefined();
    expect(typeof api.validateLayout).toBe("function");
  });
});
