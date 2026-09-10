import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { fromMajorUnits, toMajorUnits, toMinorUnits } from "./client.js";

describe("SumUp amount conversions (the only place money becomes a number)", () => {
  it("toMinorUnits: exact scale-2 decimal → integer cents", () => {
    expect(toMinorUnits(decimal("10.00"))).toBe(1000);
    expect(toMinorUnits(decimal("0.01"))).toBe(1);
    expect(toMinorUnits(decimal("1234.5"))).toBe(123450);
  });
  it("toMajorUnits: exact scale-2 decimal → the number the refund body carries", () => {
    expect(toMajorUnits(decimal("10.00"))).toBe(10);
    expect(toMajorUnits(decimal("0.40"))).toBe(0.4);
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
  // toMajorUnits is the outbound refund amount; fromMajorUnits parses what SumUp reports back. For a
  // scale-2 value the pair must round-trip exactly, or a refund we send and a refund SumUp echoes
  // would disagree on cents.
  it("toMajorUnits ∘ fromMajorUnits round-trips a scale-2 value exactly", () => {
    for (const s of ["0.01", "0.40", "5.00", "10.50", "1234.99"]) {
      expect(fromMajorUnits(toMajorUnits(decimal(s)))).toBe(decimal(s));
    }
  });
});
