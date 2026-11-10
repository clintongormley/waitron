import { describe, expect, it } from "vitest";
import type { CapabilityFlag } from "./layout.js";
import { kindOfFormFactor } from "./layout.js";

describe("device capability mirror", () => {
  it("carries clock-in as a profile capability", () => {
    const action: CapabilityFlag = "clock-in";
    expect(action).toBe("clock-in");
  });
});

describe("kindOfFormFactor mirror", () => {
  it("maps each known form factor to its device kind", () => {
    expect(kindOfFormFactor("till")).toBe("till");
    expect(kindOfFormFactor("kds")).toBe("kds_station");
    expect(kindOfFormFactor("phone-portrait")).toBe("handheld");
    expect(kindOfFormFactor("tablet-landscape")).toBe("handheld");
  });

  it("returns undefined for an unknown form factor (graceful widening)", () => {
    expect(kindOfFormFactor("hologram")).toBeUndefined();
  });
});
