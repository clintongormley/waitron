import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { fromMinorUnits, toMinorUnits } from "./client.js";

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

describe("fromMinorUnits", () => {
  it("converts integer minor units to an exact scale-2 Decimal", () => {
    expect(fromMinorUnits(1210)).toBe("12.10");
    expect(fromMinorUnits(5)).toBe("0.05");
    expect(fromMinorUnits(0)).toBe("0.00");
    expect(fromMinorUnits(100000)).toBe("1000.00");
  });

  it("round-trips with toMinorUnits", () => {
    for (const s of ["0.00", "0.05", "12.10", "1000.00", "9999999999.99"]) {
      expect(fromMinorUnits(toMinorUnits(decimal(s)))).toBe(s);
    }
  });
});
