import { describe, expect, it } from "vitest";
import {
  beforeVatFigures,
  groupDiscounts,
  quantityText,
  type FiguredLine,
  type FiledLine,
} from "./receipt-figures.js";
import type { ReceiptAdjustment, TillSaleLine } from "./till-sale.js";

type Net = NonNullable<TillSaleLine["net"]>;
const filed = (over: Partial<TillSaleLine> & { net: Net }): FiledLine => ({
  descriptions: { "es-ES": "Plato" },
  quantity: "1",
  gross: "0.00",
  ...over,
});
const net = (unitPrice: string, base: string, rate: string, priceQuantity = "1.000"): Net => ({
  unitPrice,
  priceQuantity,
  base,
  rate,
});
const figured = (...lines: FiledLine[]): FiguredLine[] =>
  lines.map((line) => ({ line, figures: beforeVatFigures(line) }));
const TEN: ReceiptAdjustment = { kind: "discount", percentBp: 1000, amount: "1.00" };

describe("beforeVatFigures", () => {
  it("works the owner's menu: 10,00 at 10% VAT less 10% is 9,09 less 0,91", () => {
    expect(
      beforeVatFigures(
        filed({ gross: "9.00", listGross: "10.00", net: net("8.18", "8.18", "10.00") }),
      ),
    ).toEqual({ price: "9.09", amount: "9.09", discount: "0.91" });
  });

  it("puts the rounding cent in the discount, never in the filed base", () => {
    // 10% of 11,36 would be 1,14; the filed base 10,23 leaves 1,13.
    expect(
      beforeVatFigures(
        filed({ gross: "11.25", listGross: "12.50", net: net("10.23", "10.23", "10.00") }),
      ),
    ).toEqual({ price: "11.36", amount: "11.36", discount: "1.13" });
  });

  it("reads a line no discount touched as filed", () => {
    expect(
      beforeVatFigures(filed({ quantity: "2", gross: "8.80", net: net("4.00", "8.00", "10") })),
    ).toEqual({ price: "4.00", amount: "8.00", discount: "0.00" });
  });

  it("divides a counted line's list total back to its unit price", () => {
    // S1's Croquetas: 2 × 3,33 with 21% VAT, part of a whole-bill discount.
    expect(
      beforeVatFigures(
        filed({
          quantity: "2",
          gross: "6.00",
          listGross: "6.66",
          net: net("2.48", "4.96", "21.00"),
        }),
      ),
    ).toEqual({ price: "2.75", amount: "5.50", discount: "0.54" });
  });

  it("keeps the filed price and base for less than one priced unit (owner question Q9)", () => {
    // S1's Jamón: 0.123 kg at 24,00 €/kg; 2,95 ÷ 0.123 would give 23,98 a kilo, not 24,00.
    expect(
      beforeVatFigures(
        filed({
          quantity: "0.123",
          gross: "2.66",
          listGross: "2.95",
          net: net("19.69", "2.42", "10.00"),
        }),
      ),
    ).toEqual({ price: "19.69", amount: "2.42", discount: "0.00" });
  });

  it("prints the filed figures, and no discount, when the list total would leave a negative one", () => {
    // 10,00 ÷ 1,21 = 8,26, below the filed base 9,50: a row would read «--1,24».
    expect(
      beforeVatFigures(
        filed({ gross: "11.50", listGross: "10.00", net: net("9.50", "9.50", "21.00") }),
      ),
    ).toEqual({ price: "9.50", amount: "9.50", discount: "0.00" });
  });

  it("prices an extra per its portion (owner, Q4)", () => {
    // Two 0.05 portions at 1,50 with 21% VAT, 10% off: 1,50 a portion is 1,24 before VAT.
    expect(
      beforeVatFigures(
        filed({
          quantity: "0.100",
          gross: "2.70",
          listGross: "3.00",
          net: net("1.12", "2.23", "21.00", "0.050"),
        }),
      ),
    ).toEqual({ price: "1.24", amount: "2.48", discount: "0.25" });
    expect(
      beforeVatFigures(
        filed({ quantity: "0.100", gross: "3.00", net: net("1.24", "2.48", "21.00", "0.050") }),
      ).price,
    ).toBe("1.24");
  });
});

describe("groupDiscounts", () => {
  const pizza = filed({
    gross: "8.10",
    listGross: "9.00",
    net: net("6.69", "6.69", "21.00"),
    adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.05" }],
  });
  const olives = filed({
    parentLineNo: 1,
    gross: "1.35",
    listGross: "1.50",
    net: net("1.12", "1.12", "21.00"),
  });

  it("adds a dish's and its extras' discounts into one row named by the dish's one adjustment", () => {
    expect(groupDiscounts(figured(pizza, olives), [], true)).toEqual([
      {
        rate: "21.00",
        amount: "0.87",
        comp: false,
        named: { kind: "discount", percentBp: 1000, amount: "1.05" },
      },
    ]);
  });

  it("calls a comped dish an invitation", () => {
    const wine = filed({
      gross: "0.00",
      listGross: "30.00",
      net: net("0.00", "0.00", "21.00"),
      adjustments: [{ kind: "comp", amount: "30.00" }],
    });
    expect(groupDiscounts(figured(wine), [], true)).toEqual([
      { rate: "21.00", amount: "24.79", comp: true, named: { kind: "comp", amount: "30.00" } },
    ]);
  });

  it("names no percentage for two discounts on one dish", () => {
    const burger = filed({
      gross: "10.26",
      listGross: "12.00",
      net: net("8.48", "8.48", "21.00"),
      adjustments: [TEN, { kind: "discount", percentBp: 500, amount: "0.54" }],
    });
    expect(groupDiscounts(figured(burger), [], true)).toEqual([
      { rate: "21.00", amount: "1.44", comp: false, named: null },
    ]);
  });

  it("names a whole-bill discount under a dish only when no dish has one of its own", () => {
    const wine = filed({ gross: "27.00", listGross: "30.00", net: net("22.31", "22.31", "21.00") });
    expect(groupDiscounts(figured(wine), [TEN], false)[0]).toMatchObject({
      amount: "2.48",
      named: TEN,
    });
    expect(groupDiscounts(figured(wine), [TEN], true)[0]).toMatchObject({
      amount: "2.48",
      named: null,
    });
  });

  it("does not name a dish's own discount when the bill has one too", () => {
    const burger = filed({
      gross: "9.72",
      listGross: "12.00",
      net: net("8.03", "8.03", "21.00"),
      adjustments: [TEN],
    });
    expect(groupDiscounts(figured(burger), [TEN], true)).toEqual([
      { rate: "21.00", amount: "1.89", comp: false, named: null },
    ]);
  });

  it("reads rates 10 and 10.00 as one rate", () => {
    const dish = filed({ gross: "9.00", listGross: "10.00", net: net("8.18", "8.18", "10") });
    const extra = filed({
      parentLineNo: 1,
      gross: "1.35",
      listGross: "1.50",
      net: net("1.23", "1.23", "10.00"),
    });
    expect(groupDiscounts(figured(dish, extra), [], false).map((d) => [d.rate, d.amount])).toEqual([
      ["10", "1.04"],
    ]);
  });

  it("does not call a row an invitation when a discounted extra beside the comped dish is still charged", () => {
    const wine = filed({
      gross: "0.00",
      listGross: "30.00",
      net: net("0.00", "0.00", "21.00"),
      adjustments: [{ kind: "comp", amount: "30.00" }],
    });
    expect(
      groupDiscounts(figured(wine, olives), [], true).map((d) => [d.rate, d.amount, d.comp]),
    ).toEqual([["21.00", "24.91", false]]);
  });

  it("gives each rate in a group its own row, and none to a group nothing lowered", () => {
    const reducedExtra = {
      ...olives,
      net: net("1.36", "1.36", "10.00"),
      listGross: "1.65",
      gross: "1.50",
    };
    expect(
      groupDiscounts(figured(pizza, reducedExtra), [], true).map((d) => [d.rate, d.amount]),
    ).toEqual([
      ["21.00", "0.75"],
      ["10.00", "0.14"],
    ]);
    expect(groupDiscounts(figured(filed({ net: net("4.00", "8.00", "10") })), [], false)).toEqual(
      [],
    );
  });
});

describe("quantityText", () => {
  it.each([
    [{ quantity: "4", unitName: { es: "ud" } }, "4"],
    [{ quantity: "3", unitName: { ca: "u" } }, "3"],
    [{ quantity: "1", unitName: null }, "1"],
    [{ quantity: "2", unitName: { es: "pzas" }, soldInEach: true as const }, "2"],
    [{ quantity: "0.35", unitName: { es: "kg" } }, "0.35 kg"],
    [{ quantity: "4", unitName: { es: "pzas" } }, "4 pzas"],
    [{ quantity: "2", unitName: { es: "ud", en: "ea" } }, "2"],
    [{ quantity: "2", unitName: { es: "cajas", en: "ea" } }, "2 cajas"],
    [{ quantity: "2", unitName: { es: "ud", en: "pcs" } }, "2 ud"],
  ])("prints %j as %s", (line, expected) => {
    expect(quantityText(line, "es-ES")).toBe(expected);
  });

  it("counts an extra priced per portion in portions, and falls back when that is not whole", () => {
    const portion = (quantity: string) => ({
      quantity,
      unitName: { es: "kg" },
      net: net("1.24", "2.48", "21.00", "0.050"),
    });
    expect(quantityText(portion("0.100"), "es-ES")).toBe("2");
    expect(quantityText(portion("0.075"), "es-ES")).toBe("0.075 kg");
  });

  it("counts portions only when they divide the quantity exactly", () => {
    // 6.001 ÷ 3.000 is 2.000 to three places, yet not two portions.
    const line = {
      quantity: "6.001",
      unitName: { es: "kg" },
      net: net("1.00", "2.00", "10", "3.000"),
    };
    expect(quantityText(line, "es-ES")).toBe("6.001 kg");
  });

  it("keeps the unit name of a filed line priced per one unit", () => {
    const line = { quantity: "4", unitName: { es: "pzas" }, net: net("2.00", "8.00", "10") };
    expect(quantityText(line, "es-ES")).toBe("4 pzas");
  });
});
