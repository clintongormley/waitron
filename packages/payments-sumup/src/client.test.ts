import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { fromMajorUnits, toMinorUnits } from "./client.js";

describe("SumUp amount conversions (the only place money becomes a number)", () => {
  it("toMinorUnits: exact scale-2 decimal → integer cents", () => {
    expect(toMinorUnits(decimal("10.00"))).toBe(1000);
    expect(toMinorUnits(decimal("0.01"))).toBe(1);
    expect(toMinorUnits(decimal("1234.5"))).toBe(123450);
  });
  it("fromMajorUnits: SumUp's JSON number → exact scale-2 decimal, no float residue", () => {
    expect(fromMajorUnits(10.5)).toBe(decimal("10.50"));
    expect(fromMajorUnits(0.1 + 0.2)).toBe(decimal("0.30"));
    expect(fromMajorUnits(1)).toBe(decimal("1.00"));
  });
  // Not part of the brief's given block: added so the sign branch (a refund correction, or any
  // other negative amount SumUp might report) is covered rather than left dark like the sibling
  // `fromMinorUnits` in payments-stripe — this package has too few files yet to dilute an
  // untested branch below the coverage gate.
  it("fromMajorUnits: a negative major-units number keeps its sign", () => {
    expect(fromMajorUnits(-10.5)).toBe(decimal("-10.50"));
  });
  // fromMajorUnits parses what SumUp reports back; a scale-2 value must survive the parse exactly, or
  // the amount we read for a transaction would disagree by cents with what SumUp holds.
  it("fromMajorUnits: reads back every scale-2 value exactly", () => {
    for (const s of ["0.01", "0.40", "5.00", "10.50", "1234.99"]) {
      expect(fromMajorUnits(Number(s))).toBe(decimal(s));
    }
  });
});
