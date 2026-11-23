import { describe, expect, it } from "vitest";
import { decimal } from "./money.js";
import { shareByWeight } from "./share-by-weight.js";

const shares = (total: string, weights: string[]) =>
  shareByWeight(decimal(total), weights.map(decimal));

describe("shareByWeight", () => {
  it("rounds each share down and gives the cent left over to the largest remainder", () => {
    expect(shares("10.00", ["10.00", "2.00"])).toEqual(["8.33", "1.67"]);
  });

  it("gives the cents left over to the larger remainders first", () => {
    expect(shares("1.00", ["10.00", "4.00"])).toEqual(["0.71", "0.29"]);
  });

  it("gives a tie to the earlier weight", () => {
    expect(shares("0.01", ["1.00", "1.00"])).toEqual(["0.01", "0.00"]);
    expect(shares("1.00", ["1", "1", "1"])).toEqual(["0.34", "0.33", "0.33"]);
  });

  it("gives nothing to a zero weight", () => {
    expect(shares("2.00", ["0.00", "3.00", "1.00"])).toEqual(["0.00", "1.50", "0.50"]);
  });

  it("gives zeros for a zero total, also when every weight is zero", () => {
    expect(shares("0.00", ["10.00", "2.00"])).toEqual(["0.00", "0.00"]);
    expect(shares("0", ["0.00", "0.00"])).toEqual(["0.00", "0.00"]);
  });

  it("refuses weights adding up to zero when the total is above zero", () => {
    expect(() => shares("1.00", ["0.00", "0.00"])).toThrow(
      expect.objectContaining({ code: "shared.invalid_decimal" }),
    );
  });

  it("always sums to the total", () => {
    const result = shares("7.00", ["3.33", "3.33", "3.34"]);
    expect(result).toEqual(["2.33", "2.33", "2.34"]);
  });
});
