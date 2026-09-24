import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import { centsToDecimal, decimalToCents, rawCentsToDecimal, stringToCents } from "./cents.js";
import { decimal, MAX_MONEY_INTEGER_DIGITS } from "./money.js";

/** The code and params an AppError-throwing call refuses with, so a refusal is checked in full. */
function refusalOf(call: () => unknown): { code: string; params: unknown } {
  try {
    call();
  } catch (error) {
    return { code: (error as AppError).code, params: (error as AppError).params };
  }
  return expect.unreachable("the call was expected to throw");
}

describe("centsToDecimal", () => {
  it("renders a count of cents as a two-place decimal", () => {
    expect(centsToDecimal(1234)).toBe("12.34");
  });

  it("keeps the two places when the amount is under a euro", () => {
    expect(centsToDecimal(5)).toBe("0.05");
  });

  it("renders zero as 0.00, never as a bare 0", () => {
    expect(centsToDecimal(0)).toBe("0.00");
  });

  it("keeps a negative amount negative", () => {
    expect(centsToDecimal(-5)).toBe("-0.05");
  });

  it("refuses a value that is not a whole number of cents", () => {
    // A caller holding half a cent has divided somewhere without deciding how to round, and
    // rounding silently here would hide it.
    expect(refusalOf(() => centsToDecimal(12.5))).toEqual({
      code: "shared.invalid_cents",
      params: { value: "12.5" },
    });
  });

  it("refuses a value that is not finite", () => {
    expect(refusalOf(() => centsToDecimal(Number.NaN))).toEqual({
      code: "shared.invalid_cents",
      params: { value: "NaN" },
    });
  });
});

describe("decimalToCents", () => {
  it("counts the cents in a two-place decimal", () => {
    expect(decimalToCents(decimal("12.34"))).toBe(1234);
  });

  it("pads a decimal that carries fewer places than two", () => {
    expect(decimalToCents(decimal("12.3"))).toBe(1230);
    expect(decimalToCents(decimal("12"))).toBe(1200);
  });

  it("rounds a third decimal place half away from zero", () => {
    expect(decimalToCents(decimal("0.005"))).toBe(1);
    expect(decimalToCents(decimal("-0.005"))).toBe(-1);
    expect(decimalToCents(decimal("0.004"))).toBe(0);
  });

  it("round-trips the largest amount the money scale admits", () => {
    const widest = decimal("9".repeat(MAX_MONEY_INTEGER_DIGITS) + ".99");
    expect(decimalToCents(widest)).toBe(99999999999999);
    expect(99999999999999).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(centsToDecimal(decimalToCents(widest))).toBe(widest);
  });

  it("refuses an amount wider than the money scale admits", () => {
    const tooWide = "1" + "0".repeat(MAX_MONEY_INTEGER_DIGITS);
    expect(refusalOf(() => decimalToCents(decimal(tooWide)))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: tooWide, maxIntegerDigits: MAX_MONEY_INTEGER_DIGITS },
    });
  });
});

describe("stringToCents", () => {
  it("counts the cents in a decimal string, rounding a third place half away from zero", () => {
    expect(stringToCents("12.34")).toBe(1234);
    expect(stringToCents("0.005")).toBe(1);
    expect(stringToCents("-0.005")).toBe(-1);
    expect(stringToCents("0.004")).toBe(0);
  });

  it("refuses a malformed string before converting it", () => {
    for (const bad of ["abc", "1e3", "+1.00", "01.00", "", " 1.00"]) {
      expect(refusalOf(() => stringToCents(bad))).toEqual({
        code: "shared.invalid_decimal",
        params: { value: bad },
      });
    }
  });

  it("accepts the widest two-place amount the money scale admits and refuses one digit wider", () => {
    expect(stringToCents("9".repeat(MAX_MONEY_INTEGER_DIGITS) + ".99")).toBe(99999999999999);
    const tooWide = "1" + "0".repeat(MAX_MONEY_INTEGER_DIGITS);
    expect(refusalOf(() => stringToCents(tooWide))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: tooWide, maxIntegerDigits: MAX_MONEY_INTEGER_DIGITS },
    });
  });
});

describe("rawCentsToDecimal", () => {
  it("reads the plain integer string a `cast(x as text)` hands back", () => {
    expect(rawCentsToDecimal("1234")).toBe("12.34");
  });

  it("reads a count above the four-byte ceiling", () => {
    expect(rawCentsToDecimal("2147483648")).toBe("21474836.48");
  });

  it("reads the widest amount the money bound admits", () => {
    expect(rawCentsToDecimal("99999999999999")).toBe("999999999999.99");
  });

  it("reads a total wider than any one amount may be", () => {
    // Raw money reads are often totals — `cast(sum(...) as text)` — and amounts that each pass
    // `assertMoney` can sum past its twelve integer digits. So this reader's bound is what a
    // number counts exactly, not the money bound.
    expect(rawCentsToDecimal("123456789012345")).toBe("1234567890123.45");
  });

  it("reads zero, and an empty `sum()` that `coalesce`d to zero", () => {
    expect(rawCentsToDecimal("0")).toBe("0.00");
  });

  it("reads a minus zero as zero", () => {
    expect(rawCentsToDecimal("-0")).toBe("0.00");
  });

  it("keeps a negative count negative", () => {
    expect(rawCentsToDecimal("-5")).toBe("-0.05");
  });

  it("refuses a count that is not a whole number of cents", () => {
    expect(refusalOf(() => rawCentsToDecimal("7734.00"))).toEqual({
      code: "shared.invalid_cents",
      params: { value: "7734.00" },
    });
  });

  it("refuses a value that is not text at all", () => {
    expect(refusalOf(() => rawCentsToDecimal(1234 as unknown as string))).toEqual({
      code: "shared.invalid_cents",
      params: { value: "1234" },
    });
  });

  it("refuses anything that is not a plain integer string", () => {
    for (const bad of ["", " 12", "12 ", "1e3", "0x10", "+12", "12.", "abc", "NaN", "Infinity"]) {
      expect(refusalOf(() => rawCentsToDecimal(bad))).toEqual({
        code: "shared.invalid_cents",
        params: { value: bad },
      });
    }
  });

  it("refuses a magnitude beyond what a number counts exactly", () => {
    expect(refusalOf(() => rawCentsToDecimal("9007199254740993"))).toEqual({
      code: "shared.invalid_cents",
      params: { value: "9007199254740993" },
    });
    expect(refusalOf(() => rawCentsToDecimal("-9007199254740993"))).toEqual({
      code: "shared.invalid_cents",
      params: { value: "-9007199254740993" },
    });
  });
});
