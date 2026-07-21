import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import {
  addDecimal,
  assertMoney,
  compareDecimal,
  decimal,
  isZeroDecimal,
  multiplyDecimal,
  negateDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
} from "./money.js";

describe("decimal", () => {
  it("accepts a plain two-place amount", () => {
    expect(decimal("12.34")).toBe("12.34");
  });

  it("preserves the scale it was given", () => {
    // "1.50" and "1.5" are the same quantity but not the same literal, and the literal is what
    // gets stored and later hashed. Normalising the scale here would silently reformat a value
    // on its way into a numeric(12,2) column.
    expect(decimal("1.50")).toBe("1.50");
    expect(decimal("1.5")).toBe("1.5");
  });

  it("accepts a negative amount", () => {
    expect(decimal("-0.01")).toBe("-0.01");
  });

  it("normalises negative zero to positive zero", () => {
    // -0.00 and 0.00 are the same amount, and a sign on zero would propagate into a stored
    // literal and then into a hash input where it would not compare equal.
    expect(decimal("-0.00")).toBe("0.00");
  });

  it("leaves a positive zero exactly as given", () => {
    // Deliberately not routed through another function's parse-and-reformat (isZeroDecimal,
    // negateDecimal): those reconstruct their own string from the parsed magnitude and scale,
    // so a decimal() that mis-detects "0.00" as needing its sign stripped (mistaking it for the
    // negative-zero case, which strips the FIRST character) produces ".00" internally, which
    // then reparses to the same value everywhere else — invisible except when decimal()'s own
    // literal return value is checked directly, which is what this assertion does.
    expect(decimal("0.00")).toBe("0.00");
    expect(decimal("0")).toBe("0");
  });

  it("rejects a non-string value at runtime, defending callers who bypass the type system", () => {
    // decimal(value: string) makes this unreachable from TypeScript, but the whole point of a
    // structured error at a package boundary (spec §9) is that the boundary is also crossed by
    // callers who never typechecked against it — plain JS, an `as any`, a value that arrived
    // over the wire. The runtime guard exists for exactly that caller.
    expect(() => decimal(123 as unknown as string)).toThrowError(AppError);
  });

  it("rejects exponential notation", () => {
    expect(() => decimal("1e3")).toThrowError(AppError);
  });

  it("rejects a comma decimal separator", () => {
    // Spanish input conventions make "1,50" a realistic value to receive from a UI that
    // formatted before it stored — the exact thing spec §9 forbids.
    expect(() => decimal("1,50")).toThrowError(AppError);
  });

  it("rejects a leading plus", () => {
    expect(() => decimal("+1.50")).toThrowError(AppError);
  });

  it("rejects leading zeros", () => {
    expect(() => decimal("007.50")).toThrowError(AppError);
  });

  it("rejects a trailing decimal point", () => {
    expect(() => decimal("1.")).toThrowError(AppError);
  });

  it("rejects a bare decimal point", () => {
    expect(() => decimal(".5")).toThrowError(AppError);
  });

  it("rejects surrounding whitespace", () => {
    expect(() => decimal(" 1.50 ")).toThrowError(AppError);
  });

  it("rejects the empty string", () => {
    expect(() => decimal("")).toThrowError(AppError);
  });

  it("rejects NaN and Infinity spellings", () => {
    expect(() => decimal("NaN")).toThrowError(AppError);
    expect(() => decimal("Infinity")).toThrowError(AppError);
  });

  it("reports the offending value in the error params", () => {
    try {
      decimal("1,50");
      expect.unreachable("decimal should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("shared.invalid_decimal");
      expect((error as AppError).params).toEqual({ value: "1,50" });
    }
  });
});

describe("addDecimal", () => {
  it("adds two amounts of equal scale", () => {
    expect(addDecimal(decimal("1.10"), decimal("2.20"))).toBe("3.30");
  });

  it("adds the case IEEE 754 gets wrong", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in binary64. This single assertion is the reason the
    // whole module exists, and it is the one an implementation that quietly reached for Number
    // cannot pass.
    expect(addDecimal(decimal("0.1"), decimal("0.2"))).toBe("0.3");
  });

  it("aligns operands of differing scale to the wider one", () => {
    expect(addDecimal(decimal("1.5"), decimal("2.25"))).toBe("3.75");
  });

  it("aligns the right operand when it is the narrower one", () => {
    // The test above always puts the wider-scale operand on the right, so `align`'s scaling
    // multiplication for its OWN `right` value never runs with a nonzero exponent — a mutant
    // that changes that multiplication to a division survives every other test in this file
    // untouched. Swapping the argument order here is what actually exercises it.
    expect(addDecimal(decimal("2.25"), decimal("1.5"))).toBe("3.75");
  });

  it("carries across the decimal point", () => {
    expect(addDecimal(decimal("0.99"), decimal("0.01"))).toBe("1.00");
  });

  it("handles a magnitude past 2 ** 53", () => {
    // 9007199254740993 is the first integer binary64 cannot represent. An implementation that
    // scaled to integer cents through Number would silently return the wrong total here.
    expect(addDecimal(decimal("9007199254740992"), decimal("1"))).toBe("9007199254740993");
  });

  it("adds a negative to a positive", () => {
    expect(addDecimal(decimal("5.00"), decimal("-7.50"))).toBe("-2.50");
  });
});

describe("subtractDecimal", () => {
  it("subtracts and preserves the wider scale", () => {
    expect(subtractDecimal(decimal("10.00"), decimal("0.005"))).toBe("9.995");
  });

  it("produces a signed result", () => {
    expect(subtractDecimal(decimal("1.00"), decimal("2.00"))).toBe("-1.00");
  });

  it("produces unsigned zero when the operands are equal", () => {
    expect(subtractDecimal(decimal("1.00"), decimal("1.00"))).toBe("0.00");
  });
});

describe("multiplyDecimal", () => {
  it("sums the scales of its operands", () => {
    // 3 x 1.25 = 3.75 exactly. Truncating to the wider operand's scale here would quietly lose
    // a third decimal place on any unit price that has one.
    expect(multiplyDecimal(decimal("3"), decimal("1.25"))).toBe("3.75");
  });

  it("multiplies two fractional operands exactly", () => {
    expect(multiplyDecimal(decimal("1.15"), decimal("1.21"))).toBe("1.3915");
  });

  it("keeps the sign", () => {
    expect(multiplyDecimal(decimal("-2"), decimal("1.5"))).toBe("-3.0");
  });
});

describe("negateDecimal and isZeroDecimal", () => {
  it("negates a positive amount", () => {
    expect(negateDecimal(decimal("1.50"))).toBe("-1.50");
  });

  it("negating zero does not produce a signed zero", () => {
    expect(negateDecimal(decimal("0.00"))).toBe("0.00");
  });

  it("negates to a magnitude narrower than its scale, so the digits need left-padding", () => {
    // Every other negative-result case in this file has enough digits that padStart is a
    // no-op. This one doesn't: magnitude 5 at scale 2 needs padding to "005" before the decimal
    // point is inserted. A rewrite that derives the sign from `units.toString()` starting with
    // "-" rather than negating the magnitude first would insert the padding zeros on the wrong
    // side of that character and produce "0.-5" instead of "-0.05".
    expect(negateDecimal(decimal("0.05"))).toBe("-0.05");
  });

  it("recognises zero at any scale", () => {
    expect(isZeroDecimal(decimal("0"))).toBe(true);
    expect(isZeroDecimal(decimal("0.0000"))).toBe(true);
    expect(isZeroDecimal(decimal("0.0001"))).toBe(false);
  });
});

describe("compareDecimal", () => {
  it("compares across differing scales", () => {
    // "1.5" sorts before "1.50" as a string. Anything comparing these lexically gets the wrong
    // answer for exactly the values that are equal.
    expect(compareDecimal(decimal("1.5"), decimal("1.50"))).toBe(0);
  });

  it("orders by value, not by string length", () => {
    expect(compareDecimal(decimal("9"), decimal("10.00"))).toBe(-1);
    expect(compareDecimal(decimal("10.00"), decimal("9"))).toBe(1);
  });

  it("orders negatives below positives", () => {
    expect(compareDecimal(decimal("-0.01"), decimal("0.00"))).toBe(-1);
  });
});

describe("sumDecimals", () => {
  it("sums a list", () => {
    expect(sumDecimals([decimal("1.10"), decimal("2.20"), decimal("3.30")])).toBe("6.60");
  });

  it("returns exact zero for an empty list", () => {
    expect(sumDecimals([])).toBe("0");
  });

  it("sums a hundred cent amounts without drift", () => {
    // In binary64 this accumulates visible error by around the fortieth term. The assertion is
    // the exact literal, not a tolerance — a tolerance is how a one-cent divergence between the
    // commercial invoice and the fiscal record gets through a test suite.
    const lines = Array.from({ length: 100 }, () => decimal("0.07"));
    expect(sumDecimals(lines)).toBe("7.00");
  });
});

describe("toScale", () => {
  it("widens a scale by padding zeros", () => {
    expect(toScale(decimal("1.5"), 4)).toBe("1.5000");
  });

  it("returns the value untouched when the scale already matches", () => {
    expect(toScale(decimal("1.50"), 2)).toBe("1.50");
  });

  it("rounds half away from zero, matching the record serialisation policy", () => {
    // The boundary case. `1.005` in binary64 is 1.00499999999999989..., so any implementation
    // that routes through Number rounds this DOWN to "1.00" and disagrees with the fiscal
    // record by one cent.
    expect(toScale(decimal("1.005"), 2)).toBe("1.01");
  });

  it("rounds a negative half away from zero too", () => {
    expect(toScale(decimal("-1.005"), 2)).toBe("-1.01");
  });

  it("rounds just below half downwards", () => {
    expect(toScale(decimal("1.00499"), 2)).toBe("1.00");
  });

  it("carries a rounding-up across the integer boundary", () => {
    expect(toScale(decimal("9.999"), 2)).toBe("10.00");
  });

  it("narrows to zero decimal places", () => {
    expect(toScale(decimal("2.5"), 0)).toBe("3");
  });
});

describe("assertMoney", () => {
  it("accepts a value that fits numeric(12, 2)", () => {
    expect(assertMoney(decimal("999999999999.99"))).toBe("999999999999.99");
  });

  it("rejects a value with more than twelve integer digits", () => {
    expect(() => assertMoney(decimal("1000000000000.00"))).toThrowError(AppError);
  });

  it("rejects a negative value past the same bound", () => {
    expect(() => assertMoney(decimal("-1000000000000.00"))).toThrowError(AppError);
  });

  it("reports the value and the digit limit in the error params", () => {
    try {
      assertMoney(decimal("1000000000000.00"));
      expect.unreachable("assertMoney should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("shared.decimal_overflow");
      expect((error as AppError).params).toEqual({
        value: "1000000000000.00",
        maxIntegerDigits: 12,
      });
    }
  });

  it("accepts a value whose extra decimals are within the integer bound", () => {
    // assertMoney checks magnitude only. Scaling to two places is toScale's job, and fusing
    // them would make it impossible to check an intermediate at full precision.
    expect(assertMoney(decimal("1.23456"))).toBe("1.23456");
  });
});
