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

/** The code an AppError-throwing call refuses with, so a refusal is checked by name. */
function codeOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return (error as AppError).code;
  }
  return expect.unreachable("the call was expected to throw");
}

describe("decimalToThousandths", () => {
  it("counts the thousandths in a three-place quantity", () => {
    expect(decimalToThousandths(decimal("1.500"))).toBe(1500);
  });

  it("reads five grams as a count the money conversion does not give", () => {
    // The whole reason this is not the money conversion — but not because the money one drops
    // the third place. It rounds it, half away from zero, so five grams read at the money scale
    // is 1: the shared conversion nobody wrote would have refused nothing and returned a number
    // five times too small.
    expect(decimalToThousandths(decimal("0.005"))).toBe(5);
    expect(decimalToThousandths(decimal("0.005"))).not.toBe(0);
    expect(decimalToCents(decimal("0.005"))).toBe(1);
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

  it("refuses text carrying a decimal point, in the quantity scale's own words", () => {
    // What a missing `::text` cast, or a cast to a scaled numeric, would hand over: a plausible
    // string a thousand times the quantity. Refusing is the only safe answer.
    //
    // The CODE is the scale's own, as `rawCentsToDecimal` uses money's own: a caller holding a
    // refusal from a query that reads a quantity and a rate in one row can tell which of the two
    // was malformed. A generic `shared.invalid_decimal` here cannot say that.
    expect(() => rawThousandthsToDecimal("1.500")).toThrow(AppError);
    expect(codeOf(() => rawThousandthsToDecimal("1.500"))).toBe("shared.invalid_thousandths");
  });

  it("refuses a value that is not text at all", () => {
    expect(() => rawThousandthsToDecimal(1500 as unknown as string)).toThrow(AppError);
    expect(codeOf(() => rawThousandthsToDecimal(1500 as unknown as string))).toBe(
      "shared.invalid_thousandths",
    );
  });

  it("reads a minus zero as zero, which is the only value it can be", () => {
    // The pattern admits "-0" as well as the shape PostgreSQL actually renders — the comment
    // above the pattern carries the measurement. This is what the reader does with it.
    expect(rawThousandthsToDecimal("-0")).toBe("0.000");
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

  it("names the overflow concept, not the scale, when the count is too wide", () => {
    // The other half of the pair above: a MALFORMED value is refused in the scale's own words,
    // an out-of-range one in the words every scale shares, which is what `decimalToThousandths`
    // already throws for the same condition on the typed path.
    expect(codeOf(() => rawThousandthsToDecimal("1000000000000"))).toBe("shared.decimal_overflow");
  });
});

describe("rawBasisPointsToDecimal", () => {
  it("reads the plain integer text a cast raw SQL read returns", () => {
    expect(rawBasisPointsToDecimal("2100")).toBe("21.00");
    expect(rawBasisPointsToDecimal("0")).toBe("0.00");
  });

  it("refuses text carrying a decimal point, in the rate scale's own words", () => {
    expect(() => rawBasisPointsToDecimal("21.00")).toThrow(AppError);
    expect(codeOf(() => rawBasisPointsToDecimal("21.00"))).toBe("shared.invalid_basis_points");
  });

  it("keeps a negative rate negative", () => {
    expect(rawBasisPointsToDecimal("-2100")).toBe("-21.00");
  });

  it("refuses a rate wider than three integer digits", () => {
    expect(() => rawBasisPointsToDecimal("100000")).toThrow(AppError);
    expect(rawBasisPointsToDecimal("99999")).toBe("999.99");
    expect(codeOf(() => rawBasisPointsToDecimal("100000"))).toBe("shared.decimal_overflow");
  });
});

describe("each raw reader leaves through its own public converter", () => {
  // Nothing a caller can pass tells the two arrangements apart today: `rawCount` builds its
  // answer from a BigInt, so the `Number.isInteger` refusal inside each public converter is
  // unreachable from the raw path. What is being kept is the SHAPE `rawCentsToDecimal` has —
  // one exit, so a validation added to `thousandthsToDecimal` or `basisPointsToDecimal` is
  // applied to a raw read as well as a typed one, rather than to the typed one alone.
  //
  // Weaker than its name in the usual way: it reads the file as TEXT. A converter reached under
  // a local alias, or through another function that happens to call it, would satisfy this
  // without the delegation being there.
  // `?raw` so the source is read as text and never evaluated, and `import.meta.glob` rather than
  // `node:fs` because this package deliberately installs no `@types/node` (see its package.json).
  // `conventions.test.ts` reads this package's sources the same way, and types `glob` the same way.
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
