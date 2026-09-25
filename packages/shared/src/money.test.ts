import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import {
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
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
    expect(decimal("1.50")).toBe("1.50");
    expect(decimal("1.5")).toBe("1.5");
  });

  it("accepts a negative amount", () => {
    expect(decimal("-0.01")).toBe("-0.01");
  });

  it("normalises negative zero to positive zero", () => {
    expect(decimal("-0.00")).toBe("0.00");
  });

  it("leaves a positive zero exactly as given", () => {
    expect(decimal("0.00")).toBe("0.00");
    expect(decimal("0")).toBe("0");
  });

  it("rejects a non-string value at runtime, defending callers who bypass the type system", () => {
    expect(() => decimal(123 as unknown as string)).toThrowError(AppError);
  });

  it("rejects exponential notation", () => {
    expect(() => decimal("1e3")).toThrowError(AppError);
  });

  it("rejects a comma decimal separator", () => {
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
    expect(addDecimal(decimal("0.1"), decimal("0.2"))).toBe("0.3");
  });

  it("aligns operands of differing scale to the wider one", () => {
    expect(addDecimal(decimal("1.5"), decimal("2.25"))).toBe("3.75");
  });

  it("aligns the right operand when it is the narrower one", () => {
    expect(addDecimal(decimal("2.25"), decimal("1.5"))).toBe("3.75");
  });

  it("carries across the decimal point", () => {
    expect(addDecimal(decimal("0.99"), decimal("0.01"))).toBe("1.00");
  });

  it("handles a magnitude past 2 ** 53", () => {
    // 9007199254740993 is the first integer binary64 cannot represent.
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
    expect(multiplyDecimal(decimal("3"), decimal("1.25"))).toBe("3.75");
  });

  it("multiplies two fractional operands exactly", () => {
    expect(multiplyDecimal(decimal("1.15"), decimal("1.21"))).toBe("1.3915");
  });

  it("keeps the sign", () => {
    expect(multiplyDecimal(decimal("-2"), decimal("1.5"))).toBe("-3.0");
  });
});

describe("divideDecimal", () => {
  it("divides exactly and rounds half away from zero to scale", () => {
    expect(divideDecimal(decimal("10"), decimal("3"), 2)).toBe("3.33");
    expect(divideDecimal(decimal("2"), decimal("3"), 4)).toBe("0.6667");
    expect(divideDecimal(decimal("1"), decimal("8"), 2)).toBe("0.13"); // 0.125 → half away → 0.13
    expect(divideDecimal(decimal("-1"), decimal("8"), 2)).toBe("-0.13");
  });

  it("carries the sign correctly for a negative divisor", () => {
    expect(divideDecimal(decimal("1"), decimal("-8"), 2)).toBe("-0.13");
  });

  it("handles a fractional divisor exactly", () => {
    expect(divideDecimal(decimal("1"), decimal("0.5"), 2)).toBe("2.00");
    expect(divideDecimal(decimal("1"), decimal("0.4"), 2)).toBe("2.50");
    expect(divideDecimal(decimal("2.5"), decimal("0.25"), 2)).toBe("10.00");
  });

  it("reproduces a VAT-style base*rate/100 to two places", () => {
    expect(
      divideDecimal(multiplyDecimal(decimal("111.10"), decimal("21")), decimal("100"), 2),
    ).toBe("23.33");
  });

  it("throws on division by zero", () => {
    expect(() => divideDecimal(decimal("1"), decimal("0"), 2)).toThrow();
  });

  it("does not produce a signed zero when a negative dividend rounds to zero", () => {
    expect(divideDecimal(decimal("-1"), decimal("1000"), 2)).toBe("0.00");
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
    // "1.5" sorts before "1.50" as a string.
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
    // `1.005` in binary64 is 1.00499999999999989...
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
