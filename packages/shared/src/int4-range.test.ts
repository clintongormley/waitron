import { describe, expect, it } from "vitest";
import { int4InRange } from "./index.js";

describe("int4InRange", () => {
  it("accepts whole numbers from int4's lowest value to its highest", () => {
    expect(int4InRange(-2_147_483_648)).toBe(true);
    expect(int4InRange(0)).toBe(true);
    expect(int4InRange(2_147_483_647)).toBe(true);
  });

  it("refuses whole numbers just outside int4", () => {
    expect(int4InRange(-2_147_483_649)).toBe(false);
    expect(int4InRange(2_147_483_648)).toBe(false);
  });

  it("refuses fractions, NaN, numeric strings and null", () => {
    expect(int4InRange(1.5)).toBe(false);
    expect(int4InRange(Number.NaN)).toBe(false);
    expect(int4InRange("1")).toBe(false);
    expect(int4InRange(null)).toBe(false);
  });

  it("takes a custom lowest value and keeps int4's highest", () => {
    expect(int4InRange(1, 1)).toBe(true);
    expect(int4InRange(0, 1)).toBe(false);
    expect(int4InRange(2_147_483_647, 1)).toBe(true);
    expect(int4InRange(2_147_483_648, 1)).toBe(false);
  });
});
