import { describe, expect, it } from "vitest";
import { decimalToCents } from "./cents.js";
import { AppError } from "./errors.js";
import { decimal } from "./money.js";
import {
  basisPointsToDecimal,
  decimalToBasisPoints,
  decimalToThousandths,
  rawBasisPointsToDecimal,
  rawThousandthsToDecimal,
  stringToBasisPoints,
  stringToThousandths,
  thousandthsToDecimal,
} from "./scales.js";

declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

/** The code and params an AppError-throwing call refuses with, so a refusal is checked in full. */
function refusalOf(call: () => unknown): { code: string; params: unknown } {
  try {
    call();
  } catch (error) {
    return { code: (error as AppError).code, params: (error as AppError).params };
  }
  return expect.unreachable("the call was expected to throw");
}

describe("decimalToThousandths", () => {
  it("counts the thousandths in a three-place quantity", () => {
    expect(decimalToThousandths(decimal("1.500"))).toBe(1500);
  });

  it("reads five grams as a count the money conversion does not give", () => {
    expect(decimalToThousandths(decimal("0.005"))).toBe(5);
    expect(decimalToThousandths(decimal("0.005"))).not.toBe(0);
    expect(decimalToCents(decimal("0.005"))).toBe(1);
  });

  it("pads a quantity that carries fewer places than three", () => {
    expect(decimalToThousandths(decimal("1.5"))).toBe(1500);
    expect(decimalToThousandths(decimal("2"))).toBe(2000);
  });

  it("rounds a fourth decimal place half away from zero", () => {
    expect(decimalToThousandths(decimal("0.0005"))).toBe(1);
    expect(decimalToThousandths(decimal("-0.0005"))).toBe(-1);
    expect(decimalToThousandths(decimal("0.0004"))).toBe(0);
  });

  it("keeps a negative quantity negative", () => {
    expect(decimalToThousandths(decimal("-1.5"))).toBe(-1500);
  });

  it("refuses a quantity wider than the column's nine integer digits", () => {
    expect(refusalOf(() => decimalToThousandths(decimal("1000000000")))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: "1000000000", maxIntegerDigits: 9 },
    });
    expect(decimalToThousandths(decimal("999999999.999"))).toBe(999999999999);
    expect(refusalOf(() => decimalToThousandths(decimal("-1000000000")))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: "-1000000000", maxIntegerDigits: 9 },
    });
  });
});

describe("stringToThousandths", () => {
  it("counts the thousandths in a decimal string, rounding a fourth place half away from zero", () => {
    expect(stringToThousandths("0.005")).toBe(5);
    expect(stringToThousandths("1.5")).toBe(1500);
    expect(stringToThousandths("0.0005")).toBe(1);
    expect(stringToThousandths("-0.0005")).toBe(-1);
    expect(stringToThousandths("0.0004")).toBe(0);
  });

  it("refuses a malformed string before converting it", () => {
    for (const bad of ["abc", "1e3", "+1.00", "01.00", "", " 1.00"]) {
      expect(refusalOf(() => stringToThousandths(bad))).toEqual({
        code: "shared.invalid_decimal",
        params: { value: bad },
      });
    }
  });

  it("refuses a quantity wider than the column's nine integer digits", () => {
    expect(refusalOf(() => stringToThousandths("1000000000"))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: "1000000000", maxIntegerDigits: 9 },
    });
    expect(refusalOf(() => stringToThousandths("-1000000000"))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: "-1000000000", maxIntegerDigits: 9 },
    });
    expect(stringToThousandths("999999999.999")).toBe(999999999999);
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
    expect(thousandthsToDecimal(0)).toBe("0.000");
  });

  it("keeps a negative quantity negative", () => {
    expect(thousandthsToDecimal(-5)).toBe("-0.005");
  });

  it("refuses a value that is not a whole number of thousandths", () => {
    expect(refusalOf(() => thousandthsToDecimal(1.5))).toEqual({
      code: "shared.invalid_thousandths",
      params: { value: "1.5" },
    });
  });

  it("refuses a value that is not finite", () => {
    expect(refusalOf(() => thousandthsToDecimal(Number.NaN))).toEqual({
      code: "shared.invalid_thousandths",
      params: { value: "NaN" },
    });
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
    expect(refusalOf(() => decimalToBasisPoints(decimal("1000")))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: "1000", maxIntegerDigits: 3 },
    });
    expect(decimalToBasisPoints(decimal("999.99"))).toBe(99999);
  });
});

describe("stringToBasisPoints", () => {
  it("counts the basis points in a decimal string, rounding a third place half away from zero", () => {
    expect(stringToBasisPoints("10.50")).toBe(1050);
    expect(stringToBasisPoints("4")).toBe(400);
    expect(stringToBasisPoints("0.005")).toBe(1);
    expect(stringToBasisPoints("0.004")).toBe(0);
  });

  it("refuses a malformed string before converting it", () => {
    for (const bad of ["abc", "1e3", "+1.00", "01.00", "", " 1.00"]) {
      expect(refusalOf(() => stringToBasisPoints(bad))).toEqual({
        code: "shared.invalid_decimal",
        params: { value: bad },
      });
    }
  });

  it("refuses a rate wider than the column's three integer digits", () => {
    expect(refusalOf(() => stringToBasisPoints("1000"))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: "1000", maxIntegerDigits: 3 },
    });
    expect(stringToBasisPoints("999.99")).toBe(99999);
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
    expect(refusalOf(() => basisPointsToDecimal(2100.5))).toEqual({
      code: "shared.invalid_basis_points",
      params: { value: "2100.5" },
    });
  });
});

describe("the two scales do not share a conversion", () => {
  it("reads the same literal as a different count in each scale", () => {
    expect(decimalToThousandths(decimal("21.00"))).toBe(21000);
    expect(decimalToBasisPoints(decimal("21.00"))).toBe(2100);
  });
});

describe("rawThousandthsToDecimal", () => {
  it("reads the plain integer text a cast raw SQL read returns", () => {
    expect(rawThousandthsToDecimal("1500")).toBe("1.500");
    expect(rawThousandthsToDecimal("0")).toBe("0.000");
  });

  it("refuses text carrying a decimal point, in the quantity scale's own words", () => {
    // The CODE is the scale's own: a caller holding a refusal from a query that reads a quantity
    // and a rate in one row can tell which of the two was malformed.
    expect(refusalOf(() => rawThousandthsToDecimal("1.500"))).toEqual({
      code: "shared.invalid_thousandths",
      params: { value: "1.500" },
    });
  });

  it("refuses a value that is not text at all", () => {
    expect(refusalOf(() => rawThousandthsToDecimal(1500 as unknown as string))).toEqual({
      code: "shared.invalid_thousandths",
      params: { value: "1500" },
    });
  });

  it("reads a minus zero as zero, which is the only value it can be", () => {
    expect(rawThousandthsToDecimal("-0")).toBe("0.000");
  });

  it("keeps a negative sum negative", () => {
    // A correction files a negative quantity — `sale_lines_quantity_ck` forbids only zero — so a
    // sum over a range that contains one can come back below zero.
    expect(rawThousandthsToDecimal("-1500")).toBe("-1.500");
  });

  it("refuses a sum wider than a quantity's nine integer digits", () => {
    // A MALFORMED value is refused in the scale's own words, an out-of-range one in the words every
    // scale shares, which is what `decimalToThousandths` throws for the same condition.
    expect(refusalOf(() => rawThousandthsToDecimal("1000000000000"))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: "1000000000000", maxIntegerDigits: 9 },
    });
    expect(rawThousandthsToDecimal("999999999999")).toBe("999999999.999");
  });
});

describe("rawBasisPointsToDecimal", () => {
  it("reads the plain integer text a cast raw SQL read returns", () => {
    expect(rawBasisPointsToDecimal("2100")).toBe("21.00");
    expect(rawBasisPointsToDecimal("0")).toBe("0.00");
  });

  it("refuses text carrying a decimal point, in the rate scale's own words", () => {
    expect(refusalOf(() => rawBasisPointsToDecimal("21.00"))).toEqual({
      code: "shared.invalid_basis_points",
      params: { value: "21.00" },
    });
  });

  it("keeps a negative rate negative", () => {
    expect(rawBasisPointsToDecimal("-2100")).toBe("-21.00");
  });

  it("refuses a rate wider than three integer digits", () => {
    expect(refusalOf(() => rawBasisPointsToDecimal("100000"))).toEqual({
      code: "shared.decimal_overflow",
      params: { value: "100000", maxIntegerDigits: 3 },
    });
    expect(rawBasisPointsToDecimal("99999")).toBe("999.99");
  });
});

describe("each raw reader leaves through its own public converter", () => {
  // No caller input tells the two arrangements apart, so this pins the SHAPE: one exit, so a
  // validation added to `thousandthsToDecimal` or `basisPointsToDecimal` also applies to a raw read.
  //
  // Weaker than its name: it reads the file as TEXT. A converter reached under a local alias, or
  // through another function that happens to call it, would satisfy this without the delegation.
  // `import.meta.glob` rather than `node:fs` because this package installs no `@types/node`.
  const source = (
    import.meta.glob("./scales.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>
  )["./scales.ts"]!;

  const bodyOf = (name: string) => {
    const after = source.split(`export function ${name}(`)[1];
    expect(after, `scales.ts declares no ${name}`).toBeDefined();
    return after!.split("\n}")[0]!;
  };

  it("returns the quantity converter's answer from the raw quantity reader", () => {
    expect(bodyOf("rawThousandthsToDecimal")).toContain("return thousandthsToDecimal(");
  });

  it("returns the rate converter's answer from the raw rate reader", () => {
    expect(bodyOf("rawBasisPointsToDecimal")).toContain("return basisPointsToDecimal(");
  });
});
