import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { toMinorUnits } from "./client.js";

describe("toMinorUnits", () => {
  it("converts major-unit decimals to integer minor units", () => {
    expect(toMinorUnits(decimal("12.10"))).toBe(1210);
    expect(toMinorUnits(decimal("12"))).toBe(1200);
    expect(toMinorUnits(decimal("0.05"))).toBe(5);
    expect(toMinorUnits(decimal("0"))).toBe(0);
  });
  it("is exact for large amounts (no float)", () => {
    expect(toMinorUnits(decimal("999999999999.99"))).toBe(99999999999999);
  });
});
