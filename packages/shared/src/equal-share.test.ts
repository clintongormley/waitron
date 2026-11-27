import { describe, expect, it } from "vitest";
import { equalShare, equalShares } from "./equal-share.js";
import { AppError } from "./errors.js";
import { MAX_GUEST_COUNT } from "./guest-count.js";
import { addDecimal, decimal, sumDecimals, type Decimal } from "./money.js";
import { shareByWeight } from "./share-by-weight.js";

const d = (value: string): Decimal => decimal(value);

/** A count of cents as a money literal, without a float: 1005 is "10.05". */
function literal(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError, but nothing was thrown");
}

describe("equalShare: the available amount divided by the people still to pay, rounded up to the cent", () => {
  it("gives the plan's D16 sequence for €100.01 across 3, then 2, then 1, and the shares sum to the bill", () => {
    const first = equalShare(d("100.01"), 3);
    const second = equalShare(d("66.67"), 2);
    const third = equalShare(d("33.33"), 1);
    expect([first, second, third]).toEqual(["33.34", "33.34", "33.33"]);
    expect(addDecimal(addDecimal(first, second), third)).toBe("100.01");
  });

  it("rounds UP, not to nearest: €10.00 across 3 is €3.34", () => {
    expect(equalShare(d("10.00"), 3)).toBe("3.34");
  });

  it("matches D16's 'floor, then one extra cent to the first C mod n' for every amount to €30.00 and n to 12", () => {
    const mismatches: string[] = [];
    for (let cents = 0; cents <= 3000; cents += 1) {
      for (let n = 1; n <= 12; n += 1) {
        const floor = Math.floor(cents / n);
        const extra = cents % n;
        let left = cents;
        for (let person = 0; person < n; person += 1) {
          const expected = floor + (person < extra ? 1 : 0);
          const share = equalShare(d(literal(left)), n - person);
          if (share !== literal(expected)) {
            mismatches.push(`${cents}c/${n} person ${person}: ${share}`);
            break;
          }
          left -= expected;
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("refuses a share among fewer than one person", () => {
    const error = thrown(() => equalShare(d("10.00"), 0));
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field: "shareOf" });
  });

  it("still answers a count above the cents left: €0.02 among 3 is €0.01", () => {
    expect(equalShare(d("0.02"), 3)).toBe("0.01");
  });
});

describe("equalShares: every guest's share, each equalShare of what the guests before left", () => {
  it("gives €73.30 among 3 as €24.44, €24.43, €24.43", () => {
    expect(equalShares(d("73.30"), 3)).toEqual(["24.44", "24.43", "24.43"]);
  });

  it("gives one guest the whole amount", () => {
    expect(equalShares(d("12.34"), 1)).toEqual(["12.34"]);
  });

  it("gives each guest a cent when the count equals the cents left", () => {
    expect(equalShares(d("0.03"), 3)).toEqual(["0.01", "0.01", "0.01"]);
  });

  it("refuses a count above the cents left", () => {
    const error = thrown(() => equalShares(d("0.02"), 3));
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field: "shareOf" });
  });

  it.each([0, 0.5])("refuses %s guests", (n) => {
    const error = thrown(() => equalShares(d("10.00"), n));
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field: "shareOf" });
  });

  it("refuses an amount that is not in whole cents: €1.005 among 2", () => {
    const error = thrown(() => equalShares(d("1.005"), 2));
    expect(error.code).toBe("shared.invalid_decimal");
    expect(error.params).toEqual({ value: "1.005" });
  });

  it("refuses more guests than one seating records", () => {
    const error = thrown(() => equalShares(d("100000.00"), MAX_GUEST_COUNT + 1));
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field: "shareOf" });
  });

  it("shares a large amount among the most guests one seating records, summing exactly", () => {
    const shares = equalShares(d("987654321.07"), MAX_GUEST_COUNT);
    expect(shares).toHaveLength(MAX_GUEST_COUNT);
    expect(sumDecimals(shares)).toBe("987654321.07");
  });

  it("is each guest's equalShare of what is left, and sums to the amount", () => {
    const shares = equalShares(d("100.01"), 3);
    expect(shares).toEqual([
      equalShare(d("100.01"), 3),
      equalShare(d("66.67"), 2),
      equalShare(d("33.33"), 1),
    ]);
    expect(sumDecimals(shares)).toBe("100.01");
  });

  it("gives the same list as shareByWeight with equal weights, for every amount to €15.00 among 1 to 15 guests", () => {
    const differences: string[] = [];
    for (let cents = 1; cents <= 1500; cents += 1) {
      for (let n = 1; n <= Math.min(15, cents); n += 1) {
        const left = d(literal(cents));
        const ours = equalShares(left, n);
        const weighted = shareByWeight(
          left,
          Array.from({ length: n }, () => d("1")),
        );
        if (ours.join() !== weighted.join()) differences.push(`${cents}c/${n}`);
      }
    }
    expect(differences).toEqual([]);
  });
});
