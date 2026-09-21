import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import { decimal } from "./money.js";
import {
  basisPointsToDecimal,
  decimalToBasisPoints,
  decimalToThousandths,
  rawBasisPointsToDecimal,
  rawThousandthsToDecimal,
  thousandthsToDecimal,
} from "./scales.js";

describe("decimalToThousandths", () => {
  it("counts the thousandths in a three-place quantity", () => {
    expect(decimalToThousandths(decimal("1.500"))).toBe(1500);
  });

  it("keeps a thousandth that a cents-shaped conversion would lose", () => {
    // The whole reason this is not the money conversion. Five grams at the money scale is
    // 0.005 rounded to two places, which is nothing at all.
    expect(decimalToThousandths(decimal("0.005"))).toBe(5);
    expect(decimalToThousandths(decimal("0.005"))).not.toBe(0);
  });

  it("pads a quantity that carries fewer places than three", () => {
    expect(decimalToThousandths(decimal("1.5"))).toBe(1500);
    expect(decimalToThousandths(decimal("2"))).toBe(2000);
  });

  it("rounds a fourth decimal place half away from zero", () => {
    // The rule the numeric(12, 3) column applied on the way in, kept unchanged.
    expect(decimalToThousandths(decimal("0.0005"))).toBe(1);
    expect(decimalToThousandths(decimal("-0.0005"))).toBe(-1);
    expect(decimalToThousandths(decimal("0.0004"))).toBe(0);
  });

  it("keeps a negative quantity negative", () => {
    expect(decimalToThousandths(decimal("-1.5"))).toBe(-1500);
  });

  it("refuses a quantity wider than the column's nine integer digits", () => {
    // numeric(12, 3) refused this with a 22003 before the column became an integer; the
    // refusal moves here rather than disappearing.
    expect(() => decimalToThousandths(decimal("1000000000"))).toThrow(AppError);
    expect(decimalToThousandths(decimal("999999999.999"))).toBe(999999999999);
  });
});

describe("thousandthsToDecimal", () => {
  it("renders a count of thousandths as a three-place decimal", () => {
    expect(thousandthsToDecimal(1500)).toBe("1.500");
  });

  it("keeps the three places when the quantity is under one", () => {
    expect(thousandthsToDecimal(5)).toBe("0.005");
  });

  it("renders zero as 0.000, never as a bare 0", () => {
    // The scale is part of the literal a receipt prints, exactly as it is for an amount.
    expect(thousandthsToDecimal(0)).toBe("0.000");
  });

  it("keeps a negative quantity negative", () => {
    expect(thousandthsToDecimal(-5)).toBe("-0.005");
  });

  it("refuses a value that is not a whole number of thousandths", () => {
    expect(() => thousandthsToDecimal(1.5)).toThrow(AppError);
  });

  it("refuses a value that is not finite", () => {
    expect(() => thousandthsToDecimal(Number.NaN)).toThrow(AppError);
  });
});

describe("decimalToBasisPoints", () => {
  it("counts the basis points in a two-place rate", () => {
    expect(decimalToBasisPoints(decimal("21.00"))).toBe(2100);
  });

  it("counts a half-percent rate", () => {
    expect(decimalToBasisPoints(decimal("10.50"))).toBe(1050);
  });

  it("pads a rate that carries fewer places than two", () => {
    expect(decimalToBasisPoints(decimal("4"))).toBe(400);
    expect(decimalToBasisPoints(decimal("0"))).toBe(0);
  });

  it("rounds a third decimal place half away from zero", () => {
    expect(decimalToBasisPoints(decimal("0.005"))).toBe(1);
    expect(decimalToBasisPoints(decimal("0.004"))).toBe(0);
  });

  it("refuses a rate wider than the column's three integer digits", () => {
    expect(() => decimalToBasisPoints(decimal("1000"))).toThrow(AppError);
    expect(decimalToBasisPoints(decimal("999.99"))).toBe(99999);
  });
});

describe("basisPointsToDecimal", () => {
  it("renders a count of basis points as a two-place rate", () => {
    expect(basisPointsToDecimal(2100)).toBe("21.00");
  });

  it("renders a half-percent rate at two places", () => {
    expect(basisPointsToDecimal(1050)).toBe("10.50");
  });

  it("renders zero as 0.00, never as a bare 0", () => {
    expect(basisPointsToDecimal(0)).toBe("0.00");
  });

  it("refuses a value that is not a whole number of basis points", () => {
    expect(() => basisPointsToDecimal(2100.5)).toThrow(AppError);
  });
});

describe("the two scales do not share a conversion", () => {
  it("reads the same literal as a different count in each scale", () => {
    // Naming each function after its own scale is what stops a caller mixing them up: there is
    // no shared "toInteger" that would take a quantity and a rate and give the same answer.
    expect(decimalToThousandths(decimal("21.00"))).toBe(21000);
    expect(decimalToBasisPoints(decimal("21.00"))).toBe(2100);
  });
});

describe("rawThousandthsToDecimal", () => {
  it("reads the plain integer text a cast raw SQL read returns", () => {
    expect(rawThousandthsToDecimal("1500")).toBe("1.500");
    expect(rawThousandthsToDecimal("0")).toBe("0.000");
  });

  it("refuses text carrying a decimal point", () => {
    // What a missing `::text` cast, or a cast to a scaled numeric, would hand over: a plausible
    // string a thousand times the quantity. Refusing is the only safe answer.
    expect(() => rawThousandthsToDecimal("1.500")).toThrow(AppError);
  });

  it("refuses a value that is not text at all", () => {
    expect(() => rawThousandthsToDecimal(1500 as unknown as string)).toThrow(AppError);
  });

  it("keeps a negative sum negative", () => {
    // A correction files a negative quantity — `sale_lines_quantity_ck` forbids only zero — so a
    // sum over a range that contains one can come back below zero.
    expect(rawThousandthsToDecimal("-1500")).toBe("-1.500");
  });

  it("refuses a sum wider than a quantity's nine integer digits", () => {
    // The `::numeric(12, 3)` cast this replaced refused the same sum with a 22003.
    expect(() => rawThousandthsToDecimal("1000000000000")).toThrow(AppError);
    expect(rawThousandthsToDecimal("999999999999")).toBe("999999999.999");
  });
});

describe("rawBasisPointsToDecimal", () => {
  it("reads the plain integer text a cast raw SQL read returns", () => {
    expect(rawBasisPointsToDecimal("2100")).toBe("21.00");
    expect(rawBasisPointsToDecimal("0")).toBe("0.00");
  });

  it("refuses text carrying a decimal point", () => {
    expect(() => rawBasisPointsToDecimal("21.00")).toThrow(AppError);
  });

  it("keeps a negative rate negative", () => {
    expect(rawBasisPointsToDecimal("-2100")).toBe("-21.00");
  });

  it("refuses a rate wider than three integer digits", () => {
    expect(() => rawBasisPointsToDecimal("100000")).toThrow(AppError);
    expect(rawBasisPointsToDecimal("99999")).toBe("999.99");
  });
});
