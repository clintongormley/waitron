import { describe, expect, it } from "vitest";
import { AppError, decimal, grossOf, sumDecimals, type Decimal } from "@waitron/shared";
import {
  discountShares,
  nearestWeighedUnitPrice,
  percentReduction,
  splitDiscreteLine,
  spreadBillDiscount,
  type SpreadLine,
} from "./spread.js";

const d = decimal;

/** A line whose gross is its unit price times its quantity, rounded as the pricing code does. */
function line(
  lineId: string,
  addedOrder: number,
  grossUnit: string,
  quantity: string,
  exact: boolean,
): SpreadLine {
  return {
    lineId,
    addedOrder,
    grossUnit: d(grossUnit),
    quantity,
    gross: grossOf(grossUnit, quantity),
    exact,
  };
}

const fish = () => line("fish", 1, "12.99", "2.500", false);

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

function totalOf(rows: readonly { quantity: string; unitGross: Decimal }[]): Decimal {
  return sumDecimals(rows.map((row) => grossOf(row.unitGross, row.quantity)));
}

function reductions(result: Map<string, { reduction: Decimal }>): Record<string, string> {
  return Object.fromEntries([...result].map(([id, r]) => [id, r.reduction]));
}

describe("percentReduction", () => {
  it("rounds the percentage of the line to whole cents, half up, before any split", () => {
    expect(percentReduction(d("9.99"), 1000)).toBe("1.00");
    expect(percentReduction(d("7.99"), 1000)).toBe("0.80");
    expect(percentReduction(d("32.48"), 1000)).toBe("3.25");
    expect(percentReduction(d("30.00"), 1000)).toBe("3.00");
    expect(percentReduction(d("30.00"), 10000)).toBe("30.00");
  });

  it("rounds an exact half cent up, never to the even cent", () => {
    // 50% of €0.25 is €0.125: half up gives €0.13, half-to-even €0.12.
    expect(percentReduction(d("0.25"), 5000)).toBe("0.13");
  });

  it("refuses a percentage outside 1..10000 basis points", () => {
    expect(() => percentReduction(d("9.99"), 0)).toThrow(RangeError);
    expect(() => percentReduction(d("9.99"), 10001)).toThrow(RangeError);
    expect(() => percentReduction(d("9.99"), 1.5)).toThrow(RangeError);
  });
});

describe("nearestWeighedUnitPrice", () => {
  it("takes the HIGHEST of several prices giving the target at a small weight (ham)", () => {
    // 0.333 kg at €24.00/kg is €7.99; 10% off is €0.80, so the target is €7.19.
    for (const price of ["21.58", "21.59", "21.60"]) expect(grossOf(price, "0.333")).toBe("7.19");
    expect(grossOf("21.61", "0.333")).toBe("7.20");
    expect(nearestWeighedUnitPrice(d("24.00"), "0.333", d("7.19"))).toBe("21.60");
  });

  it("reaches an exact target on 2.5 kg of fish (29.225 rounds up to €29.23)", () => {
    expect(nearestWeighedUnitPrice(d("12.99"), "2.500", d("29.23"))).toBe("11.69");
  });

  it("uses the nearest total when no price reaches the target: €29.20 for €29.21", () => {
    expect(grossOf("11.68", "2.500")).toBe("29.20");
    expect(grossOf("11.69", "2.500")).toBe("29.23");
    expect(nearestWeighedUnitPrice(d("12.99"), "2.500", d("29.21"))).toBe("11.68");
  });

  it("breaks a tie toward the higher total: €29.25 for €29.24", () => {
    expect(grossOf("11.70", "2.500")).toBe("29.25");
    expect(nearestWeighedUnitPrice(d("12.99"), "2.500", d("29.24"))).toBe("11.70");
  });

  it.each([
    // grossUnit, quantity, target, price, the total that price gives
    ["10.00", "1.000", "7.37", "7.37", "7.37"],
    ["10.00", "0.500", "3.33", "6.66", "3.33"],
    ["24.00", "0.005", "0.10", "20.99", "0.10"],
    ["5.00", "3.000", "10.00", "3.33", "9.99"],
    ["5.00", "3.000", "10.01", "3.34", "10.02"],
    // A tie: €5.01 sits between €5.00 and €5.02; the higher total wins.
    ["4.00", "2.000", "5.01", "2.51", "5.02"],
    ["12.99", "2.500", "28.66", "11.46", "28.65"],
    ["12.99", "2.500", "29.44", "11.78", "29.45"],
    ["12.99", "2.500", "0.00", "0.00", "0.00"],
    ["12.99", "2.500", "32.48", "12.99", "32.48"],
  ])("%s/kg × %s toward %s is %s, giving %s", (unit, quantity, target, price, total) => {
    const found = nearestWeighedUnitPrice(d(unit), quantity, d(target));
    expect(found).toBe(price);
    expect(grossOf(found, quantity)).toBe(total);
  });

  it("never raises the price, even where a higher one gives the same total", () => {
    // 5 g at €24.00/kg is €0.12, and so is 5 g at anything up to €24.99/kg.
    expect(grossOf("24.99", "0.005")).toBe("0.12");
    expect(nearestWeighedUnitPrice(d("24.00"), "0.005", d("0.12"))).toBe("24.00");
  });

  it("refuses a zero quantity, a target outside the line, and a target in part-cents", () => {
    expect(() => nearestWeighedUnitPrice(d("12.99"), "0.000", d("0.00"))).toThrow(RangeError);
    expect(() => nearestWeighedUnitPrice(d("12.99"), "2.500", d("-0.01"))).toThrow(RangeError);
    expect(() => nearestWeighedUnitPrice(d("12.99"), "2.500", d("32.49"))).toThrow(RangeError);
    expect(() => nearestWeighedUnitPrice(d("12.99"), "2.500", d("29.215"))).toThrow(RangeError);
    expect(() => nearestWeighedUnitPrice(d("12.995"), "2.500", d("29.21"))).toThrow(RangeError);
    expect(() => nearestWeighedUnitPrice(d("-1.00"), "2.500", d("0.00"))).toThrow(RangeError);
    expect(() => nearestWeighedUnitPrice(d("12.99"), "2.5005", d("29.21"))).toThrow(RangeError);
  });
});

describe("splitDiscreteLine", () => {
  it("splits Croquetas ×3 at €3.33 less €1.00 into 2 × €3.00 and 1 × €2.99", () => {
    const rows = splitDiscreteLine(d("3.33"), "3", d("8.99"));
    expect(rows).toEqual([
      { quantity: "2.000", unitGross: "3.00" },
      { quantity: "1.000", unitGross: "2.99" },
    ]);
    expect(totalOf(rows)).toBe("8.99");
  });

  it("keeps one row when the total divides into whole cents per unit", () => {
    expect(splitDiscreteLine(d("30.00"), "1", d("27.00"))).toEqual([
      { quantity: "1.000", unitGross: "27.00" },
    ]);
    expect(splitDiscreteLine(d("3.33"), "3.000", d("9.00"))).toEqual([
      { quantity: "3.000", unitGross: "3.00" },
    ]);
    expect(splitDiscreteLine(d("25.00"), "2", d("0.00"))).toEqual([
      { quantity: "2.000", unitGross: "0.00" },
    ]);
  });

  it("refuses a part quantity, a target above the line or below zero, and part-cents", () => {
    expect(() => splitDiscreteLine(d("3.33"), "1.5", d("4.00"))).toThrow(RangeError);
    expect(() => splitDiscreteLine(d("3.33"), "0", d("0.00"))).toThrow(RangeError);
    expect(() => splitDiscreteLine(d("3.33"), "3", d("10.00"))).toThrow(RangeError);
    expect(() => splitDiscreteLine(d("3.33"), "3", d("-0.01"))).toThrow(RangeError);
    expect(() => splitDiscreteLine(d("3.33"), "3", d("8.995"))).toThrow(RangeError);
  });
});

describe("discountShares", () => {
  it("rounds each share down and gives the leftover cent to the largest remainder", () => {
    const shares = discountShares([line("salad", 2, "10.00", "1", true), fish()], d("5.00"));
    expect(shares.get("salad")).toBe("1.18");
    expect(shares.get("fish")).toBe("3.82");
  });

  it("breaks a tie of remainders toward the line added earlier, whatever the input order", () => {
    const lines = [
      line("second", 2, "3.33", "1", true),
      line("third", 3, "3.34", "1", true),
      line("first", 1, "3.33", "1", true),
    ];
    const shares = discountShares(lines, d("5.00"));
    expect(Object.fromEntries(shares)).toEqual({ first: "1.67", second: "1.66", third: "1.67" });
  });
});

describe("spreadBillDiscount", () => {
  it("discounts three fixed portions using their frozen price basis while retaining physical quantity", () => {
    const extra: SpreadLine = {
      lineId: "ham",
      addedOrder: 1,
      gross: d("0.03"),
      grossUnit: d("0.01"),
      quantity: "0.150",
      priceQuantity: "0.050",
      exact: false,
    };

    expect(spreadBillDiscount([extra], d("0.03")).get("ham")).toEqual({
      reduction: "0.03",
      newGrossUnit: "0.00",
      rows: [{ quantity: "0.150", unitGross: "0.00" }],
    });
  });

  it("prices a partial portion without requiring a rounded portion count", () => {
    const partial: SpreadLine = {
      lineId: "slice",
      addedOrder: 1,
      gross: d("0.01"),
      grossUnit: d("0.03"),
      quantity: "0.001",
      priceQuantity: "0.003",
      exact: false,
    };

    expect(spreadBillDiscount([partial], d("0.01")).get("slice")).toEqual({
      reduction: "0.01",
      newGrossUnit: "0.01",
      rows: [{ quantity: "0.001", unitGross: "0.01" }],
    });
  });

  describe("on one line (a line discount)", () => {
    it("takes 10% off a €30.00 bottle exactly", () => {
      const result = spreadBillDiscount([line("bottle", 1, "30.00", "1", true)], d("3.00"));
      expect(result.get("bottle")).toEqual({
        reduction: "3.00",
        newGrossUnit: "27.00",
        rows: [{ quantity: "1.000", unitGross: "27.00" }],
      });
    });

    it("takes €1.00 off Croquetas ×3 at €3.33 as 2 × €3.00 and 1 × €2.99 (€8.99)", () => {
      const croquetas = line("croquetas", 1, "3.33", "3", true);
      const reduction = percentReduction(croquetas.gross, 1000);
      const result = spreadBillDiscount([croquetas], reduction).get("croquetas")!;
      expect(result.reduction).toBe("1.00");
      expect(result.rows).toEqual([
        { quantity: "2.000", unitGross: "3.00" },
        { quantity: "1.000", unitGross: "2.99" },
      ]);
      expect(result.newGrossUnit).toBe("3.00");
      expect(totalOf(result.rows)).toBe("8.99");
    });

    it.each([
      // weighed line, discount asked, new unit price, reduction achieved
      ["ham 0.333 kg, 10%", line("w", 1, "24.00", "0.333", false), "0.80", "21.60", "0.80"],
      ["fish 2.5 kg, 10%", line("w", 1, "12.99", "2.500", false), "3.25", "11.69", "3.25"],
      ["fish, €3.27 asked", line("w", 1, "12.99", "2.500", false), "3.27", "11.68", "3.28"],
      ["fish, €3.24 asked", line("w", 1, "12.99", "2.500", false), "3.24", "11.70", "3.23"],
    ])("%s records what was achieved", (_name, weighed, asked, unit, achieved) => {
      const result = spreadBillDiscount([weighed], d(asked)).get("w")!;
      expect(result.newGrossUnit).toBe(unit);
      expect(result.reduction).toBe(achieved);
      expect(result.rows).toEqual([{ quantity: weighed.quantity, unitGross: unit }]);
    });

    it("works out the ham's and the fish's 10% as €0.80 and €3.25, half up", () => {
      expect(percentReduction(line("w", 1, "24.00", "0.333", false).gross, 1000)).toBe("0.80");
      expect(percentReduction(fish().gross, 1000)).toBe("3.25");
    });

    it("refuses €40.00 off a €30.00 line with adjustment.exceeds_amount", () => {
      const error = thrown(() =>
        spreadBillDiscount([line("bottle", 1, "30.00", "1", true)], d("40.00")),
      );
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "adjustment.exceeds_amount",
        params: { requested: "40.00", available: "30.00" },
      });
    });
  });

  describe("across a bill", () => {
    it("refuses €150.00 off a €120.00 bill with adjustment.exceeds_amount", () => {
      const lines = [line("a", 1, "70.00", "1", true), line("b", 2, "50.00", "1", true)];
      expect(thrown(() => spreadBillDiscount(lines, d("150.00")))).toMatchObject({
        code: "adjustment.exceeds_amount",
        params: { requested: "150.00", available: "120.00" },
      });
    });

    it("refuses any discount on a bill with no lines", () => {
      expect(thrown(() => spreadBillDiscount([], d("0.01")))).toMatchObject({
        code: "adjustment.exceeds_amount",
        params: { requested: "0.01", available: "0.00" },
      });
      expect(spreadBillDiscount([], d("0.00")).size).toBe(0);
    });

    it("takes the whole bill when the discount equals it", () => {
      const lines = [line("a", 2, "3.33", "3", true), fish()];
      const result = spreadBillDiscount(lines, d("42.47"));
      expect(reductions(result)).toEqual({ a: "9.99", fish: "32.48" });
      expect(result.get("fish")!.newGrossUnit).toBe("0.00");
    });

    it("moves the cent a weighed line overshoots back off the discrete line (€5.00, fish)", () => {
      const lines = [line("salad", 2, "10.00", "1", true), fish()];
      const result = spreadBillDiscount(lines, d("5.00"));
      // Shares €1.18 and €3.82; the fish's target €28.66 is nearest €28.65 at €11.46/kg, so it
      // takes €3.83, and the salad gives the cent back.
      expect(result.get("fish")).toEqual({
        reduction: "3.83",
        newGrossUnit: "11.46",
        rows: [{ quantity: "2.500", unitGross: "11.46" }],
      });
      expect(result.get("salad")!.reduction).toBe("1.17");
      expect(sumDecimals([...result.values()].map((r) => r.reduction))).toBe("5.00");
    });

    it("records what a bill of only weighed lines achieved", () => {
      const result = spreadBillDiscount([fish()], d("3.27"));
      expect(result.get("fish")!.reduction).toBe("3.28");
    });

    it("adds the cent a weighed line falls short to a discrete line with room (fish, bread)", () => {
      const lines = [fish(), line("bread", 2, "2.50", "1", true)];
      expect(Object.fromEntries(discountShares(lines, d("3.27")))).toEqual({
        fish: "3.04",
        bread: "0.23",
      });
      const result = spreadBillDiscount(lines, d("3.27"));
      expect(result.get("fish")).toMatchObject({ reduction: "3.03", newGrossUnit: "11.78" });
      expect(result.get("bread")).toMatchObject({ reduction: "0.24", newGrossUnit: "2.26" });
      expect(sumDecimals([...result.values()].map((r) => r.reduction))).toBe("3.27");
    });

    it("leaves a missing cent unplaced beside a comped water, which cannot take it (€3.24)", () => {
      const lines = [fish(), line("water", 2, "0.00", "1", true)];
      const result = spreadBillDiscount(lines, d("3.24"));
      expect(result.get("fish")).toMatchObject({ reduction: "3.23", newGrossUnit: "11.70" });
      // The control: forcing exactness would put the water at +€0.01 off, i.e. −€0.01.
      expect(result.get("water")).toEqual({
        reduction: "0.00",
        newGrossUnit: "0.00",
        rows: [{ quantity: "1.000", unitGross: "0.00" }],
      });
      expect(sumDecimals([...result.values()].map((r) => r.reduction))).toBe("3.23");
    });

    it("leaves an extra cent in place beside a comped water, which cannot give one (€3.27)", () => {
      const lines = [fish(), line("water", 2, "0.00", "1", true)];
      const result = spreadBillDiscount(lines, d("3.27"));
      expect(result.get("fish")).toMatchObject({ reduction: "3.28", newGrossUnit: "11.68" });
      // The control: forcing exactness would have the water give a cent back, raising its price.
      expect(result.get("water")).toMatchObject({ reduction: "0.00", newGrossUnit: "0.00" });
      expect(sumDecimals([...result.values()].map((r) => r.reduction))).toBe("3.28");
    });

    it("never takes a cent back from a priced discrete line whose share is €0.00", () => {
      const lines = [fish(), line("mint", 2, "0.01", "1", true)];
      expect(discountShares(lines, d("3.27")).get("mint")).toBe("0.00");
      const result = spreadBillDiscount(lines, d("3.27"));
      expect(result.get("mint")).toMatchObject({ reduction: "0.00", newGrossUnit: "0.01" });
      expect(result.get("fish")!.reduction).toBe("3.28");
    });

    it("spreads €5.00 over €3.33, €3.33 and €3.34 as €1.67, €1.66 and €1.67 (Review Focus 5)", () => {
      const lines = [
        line("one", 1, "3.33", "1", true),
        line("two", 2, "3.33", "1", true),
        line("three", 3, "3.34", "1", true),
      ];
      const shares = discountShares(lines, d("5.00"));
      expect(Object.fromEntries(shares)).toEqual({ one: "1.67", two: "1.66", three: "1.67" });
      const result = spreadBillDiscount(lines, d("5.00"));
      expect(reductions(result)).toEqual({ one: "1.67", two: "1.66", three: "1.67" });
      expect(result.get("one")!.newGrossUnit).toBe("1.66");
      expect(result.get("two")!.newGrossUnit).toBe("1.67");
      expect(result.get("three")!.newGrossUnit).toBe("1.67");
      // The two 10% lines drop by €3.33 together, the 21% line by €1.67.
      expect(sumDecimals([result.get("one")!.reduction, result.get("two")!.reduction])).toBe(
        "3.33",
      );
      // A second run, and a run over the lines in another order, give the same shares.
      expect(spreadBillDiscount(lines, d("5.00"))).toEqual(result);
      expect(spreadBillDiscount([...lines].reverse(), d("5.00"))).toEqual(result);
    });

    it("hands the cents a weighed line misses out one at a time, largest line first", () => {
      // 4.5 kg at €12.99/kg is €58.46. Of €1.00 the shares are €0.79, €0.20 and €0.01; the fish's
      // target €57.67 is nearest €57.69 at €12.82/kg, two cents short, so each discrete line takes
      // one — not both on the larger.
      const heavy = line("fish", 1, "12.99", "4.500", false);
      const big = line("big", 2, "15.00", "1", true);
      const small = line("small", 3, "0.60", "1", true);
      expect(Object.fromEntries(discountShares([heavy, big, small], d("1.00")))).toEqual({
        fish: "0.79",
        big: "0.20",
        small: "0.01",
      });
      const short = spreadBillDiscount([heavy, big, small], d("1.00"));
      expect(reductions(short)).toEqual({ fish: "0.77", big: "0.21", small: "0.02" });
      // Of €1.06 the shares are €0.84, €0.21 and €0.01; the fish takes €0.86, two cents over, and
      // each discrete line gives one back.
      const over = spreadBillDiscount([heavy, big, small], d("1.06"));
      expect(reductions(over)).toEqual({ fish: "0.86", big: "0.20", small: "0.00" });
    });
  });

  describe("between two discrete lines of the same gross", () => {
    const lines = () => [
      fish(),
      line("earlier", 2, "5.00", "1", true),
      line("later", 3, "5.00", "1", true),
    ];

    it("gives a missing cent to the line added earlier", () => {
      // Shares €0.76, €0.12 and €0.12; the fish takes €0.75 at €12.69/kg, a cent short.
      expect(reductions(spreadBillDiscount(lines(), d("1.00")))).toEqual({
        fish: "0.75",
        earlier: "0.13",
        later: "0.12",
      });
    });

    it("takes an extra cent back from the line added earlier", () => {
      // Shares €0.77, €0.12 and €0.12; the fish takes €0.78 at €12.68/kg, a cent over.
      expect(reductions(spreadBillDiscount([...lines()].reverse(), d("1.01")))).toEqual({
        fish: "0.78",
        earlier: "0.11",
        later: "0.12",
      });
    });
  });

  describe("on a dish with extras (rows that are not split)", () => {
    const burger = () => line("burger", 1, "12.00", "2", false);
    const cheese = () => line("cheese", 2, "1.00", "2", false);

    it("gives each row the nearest whole-cent price and records what was achieved", () => {
      const result = spreadBillDiscount([burger(), cheese()], d("2.61"));
      // Shares €2.41 and €0.20; the burger's target €21.59 ties between €21.58 and €21.60, so it
      // takes the higher total at €10.80 and falls a cent short, with no exact row to take it.
      expect(result.get("burger")).toEqual({
        reduction: "2.40",
        newGrossUnit: "10.80",
        rows: [{ quantity: "2.000", unitGross: "10.80" }],
      });
      expect(result.get("cheese")).toMatchObject({ reduction: "0.20", newGrossUnit: "0.90" });
      expect(sumDecimals([...result.values()].map((r) => r.reduction))).toBe("2.60");
    });

    it("moves that cent to an exact row when the bill has one", () => {
      const result = spreadBillDiscount(
        [burger(), cheese(), line("bread", 3, "2.50", "1", true)],
        d("2.86"),
      );
      // Shares €2.41, €0.20 and €0.25; the burger falls a cent short and the bread takes it.
      expect(reductions(result)).toEqual({ burger: "2.40", cheese: "0.20", bread: "0.26" });
    });
  });

  describe("refuses a malformed request", () => {
    it("a negative discount or one in part-cents", () => {
      const lines = [line("a", 1, "3.33", "1", true)];
      expect(() => spreadBillDiscount(lines, d("-0.01"))).toThrow(RangeError);
      expect(() => spreadBillDiscount(lines, d("0.005"))).toThrow(RangeError);
    });

    it("a line whose gross is not its unit price times its quantity", () => {
      const wrong = { ...line("a", 1, "3.33", "3", true), gross: d("10.00") };
      expect(() => spreadBillDiscount([wrong], d("1.00"))).toThrow(RangeError);
    });

    it("two lines under one id, or two added at the same place", () => {
      const sameId = [line("a", 1, "3.33", "1", true), line("a", 2, "3.33", "1", true)];
      expect(() => spreadBillDiscount(sameId, d("1.00"))).toThrow(RangeError);
      const samePlace = [line("a", 1, "3.33", "1", true), line("b", 1, "3.33", "1", true)];
      expect(() => spreadBillDiscount(samePlace, d("1.00"))).toThrow(RangeError);
    });

    it("an exact line with a part quantity", () => {
      expect(() => spreadBillDiscount([line("a", 1, "3.00", "1.5", true)], d("1.00"))).toThrow(
        RangeError,
      );
    });
  });

  it("leaves every line as it was under a zero discount", () => {
    const result = spreadBillDiscount([line("a", 2, "3.33", "3", true), fish()], d("0.00"));
    expect(result.get("a")).toEqual({
      reduction: "0.00",
      newGrossUnit: "3.33",
      rows: [{ quantity: "3.000", unitGross: "3.33" }],
    });
    expect(result.get("fish")).toMatchObject({ reduction: "0.00", newGrossUnit: "12.99" });
  });
});
