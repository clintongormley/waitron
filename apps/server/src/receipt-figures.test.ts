import { compareDecimal, decimal, subtractDecimal, sumDecimals } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import {
  beforeVatFigures,
  invoiceDiscounts,
  quantityText,
  type FiguredGroup,
  type FiguredLine,
  type FiledLine,
  type InvoiceDiscounts,
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
        filed({
          gross: "9.00",
          listGross: "10.00",
          listUnitPriceGross: "10.00",
          net: net("8.18", "8.18", "10.00"),
        }),
      ),
    ).toEqual({ price: "9.09", amount: "9.09", discount: "0.91" });
  });

  it("puts the rounding cent in the discount, never in the filed base", () => {
    // 10% of 11,36 would be 1,14; the filed base 10,23 leaves 1,13.
    expect(
      beforeVatFigures(
        filed({
          gross: "11.25",
          listGross: "12.50",
          listUnitPriceGross: "12.50",
          net: net("10.23", "10.23", "10.00"),
        }),
      ),
    ).toEqual({ price: "11.36", amount: "11.36", discount: "1.13" });
  });

  it("prints the filed figures, and no discount, when a line has a list total but no stored price", () => {
    expect(
      beforeVatFigures(
        filed({
          quantity: "2",
          gross: "6.00",
          listGross: "6.66",
          net: net("2.48", "4.96", "21.00"),
        }),
      ),
    ).toEqual({ price: "2.48", amount: "4.96", discount: "0.00" });
  });

  it("prints the filed figures, and no discount, when a line has a stored price but no list total", () => {
    expect(
      beforeVatFigures(
        filed({
          quantity: "2",
          gross: "6.00",
          listUnitPriceGross: "3.33",
          net: net("2.48", "4.96", "21.00"),
        }),
      ),
    ).toEqual({ price: "2.48", amount: "4.96", discount: "0.00" });
  });

  it("reads a line no discount touched as filed", () => {
    expect(
      beforeVatFigures(filed({ quantity: "2", gross: "8.80", net: net("4.00", "8.00", "10") })),
    ).toEqual({ price: "4.00", amount: "8.00", discount: "0.00" });
  });

  it("prices a counted line at its stored unit price", () => {
    // Croquetas: 2 × 3,33 with 21% VAT, part of a whole-bill discount.
    expect(
      beforeVatFigures(
        filed({
          quantity: "2",
          gross: "6.00",
          listGross: "6.66",
          listUnitPriceGross: "3.33",
          net: net("2.48", "4.96", "21.00"),
        }),
      ),
    ).toEqual({ price: "2.75", amount: "5.50", discount: "0.54" });
  });

  it("prints a weighed line with no stored price at its filed figures", () => {
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

  it("prints a weighed line at its stored price before any discount (owner, Q9)", () => {
    // J1, measured: 0.123 kg at 24,00 €/kg, 10% off, charged 2,65, filed base 2,41.
    expect(
      beforeVatFigures(
        filed({
          quantity: "0.123",
          gross: "2.65",
          listGross: "2.95",
          listUnitPriceGross: "24.00",
          net: net("19.62", "2.41", "10.00"),
        }),
      ),
    ).toEqual({ price: "21.82", amount: "2.68", discount: "0.27" });
  });

  it("prints a weighed line at its stored price when its discount comes to nothing before VAT", () => {
    // 0.062 kg at 24,00 €/kg is 1,49; 1% off charges 1,48, at 23,95 €/kg, and both totals have base 1,35.
    expect(
      beforeVatFigures(
        filed({
          quantity: "0.062",
          gross: "1.48",
          listGross: "1.49",
          listUnitPriceGross: "24.00",
          net: net("21.77", "1.35", "10.00"),
        }),
      ),
    ).toEqual({ price: "21.82", amount: "1.35", discount: "0.00" });
  });

  it("gives a comped weighed line its value (owner, Q9)", () => {
    // J2, measured: the same jamón comped, filed at 0,00.
    expect(
      beforeVatFigures(
        filed({
          quantity: "0.123",
          gross: "0.00",
          listGross: "2.95",
          listUnitPriceGross: "24.00",
          net: net("0.00", "0.00", "10.00"),
        }),
      ),
    ).toEqual({ price: "21.82", amount: "2.68", discount: "2.68" });
  });

  it("prints a credit line's filed figures", () => {
    // A whole credit negates the totals and keeps the positive price, so its discount would be
    // negative and the filed figures print.
    expect(
      beforeVatFigures(
        filed({
          quantity: "-0.123",
          gross: "-2.65",
          listGross: "-2.95",
          listUnitPriceGross: "24.00",
          net: net("19.62", "-2.41", "10.00"),
        }),
      ),
    ).toEqual({ price: "19.62", amount: "-2.41", discount: "0.00" });
  });

  it("prints the filed figures, and no discount, when the list total would leave a negative one", () => {
    // 10,00 ÷ 1,21 = 8,26, below the filed base 9,50: a row would read «--1,24».
    expect(
      beforeVatFigures(
        filed({
          gross: "11.50",
          listGross: "10.00",
          listUnitPriceGross: "10.00",
          net: net("9.50", "9.50", "21.00"),
        }),
      ),
    ).toEqual({ price: "9.50", amount: "9.50", discount: "0.00" });
  });

  it("prices an extra at its stored price per portion", () => {
    // Two 0.05 portions at 1,50 with 21% VAT, 10% off: 1,50 a portion is 1,24 before VAT.
    expect(
      beforeVatFigures(
        filed({
          quantity: "0.100",
          gross: "2.70",
          listGross: "3.00",
          listUnitPriceGross: "1.50",
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

describe("invoiceDiscounts", () => {
  const group = (at: number, family: number, ...lines: FiledLine[]): FiguredGroup => ({
    at,
    family,
    lines: figured(...lines),
  });
  const under = (result: InvoiceDiscounts) => Object.fromEntries(result.under);
  const own = (amount: string): ReceiptAdjustment => ({ ...TEN, amount });

  const rioja = filed({
    gross: "27.00",
    listGross: "30.00",
    listUnitPriceGross: "30.00",
    net: net("22.31", "22.31", "21.00"),
  });
  const pan = filed({
    gross: "2.25",
    listGross: "2.50",
    listUnitPriceGross: "2.50",
    net: net("2.05", "2.05", "10.00"),
  });

  // S5: a whole-bill 10% and nothing of a dish's own.
  const s5Bill = own("3.25");
  const s5 = { groups: [group(0, 0, rioja), group(1, 1, pan)], bill: [s5Bill] };

  // S1: the burger's own 10%, the bill's 10% over everything; the croquetas are one family.
  const s1Own = own("1.20");
  const s1Bill = own("3.42");
  const s1 = {
    groups: [
      group(
        0,
        0,
        filed({
          gross: "9.72",
          listGross: "12.00",
          listUnitPriceGross: "12.00",
          net: net("8.03", "8.03", "21.00"),
          adjustments: [s1Own],
        }),
      ),
      group(
        1,
        1,
        filed({
          quantity: "2",
          gross: "6.00",
          listGross: "6.66",
          listUnitPriceGross: "3.33",
          net: net("2.48", "4.96", "21.00"),
          dishFamily: 1,
        }),
      ),
      group(
        2,
        2,
        filed({
          quantity: "0.123",
          gross: "2.66",
          listGross: "2.95",
          listUnitPriceGross: "24.00",
          net: net("19.67", "2.42", "10.00"),
        }),
      ),
      group(
        3,
        3,
        filed({
          gross: "8.09",
          listGross: "9.00",
          listUnitPriceGross: "9.00",
          net: net("6.69", "6.69", "21.00"),
        }),
        filed({
          parentLineNo: 4,
          gross: "1.36",
          listGross: "1.50",
          listUnitPriceGross: "1.50",
          net: net("1.12", "1.12", "21.00"),
        }),
      ),
      group(
        4,
        1,
        filed({
          gross: "2.99",
          listGross: "3.33",
          listUnitPriceGross: "3.33",
          net: net("2.47", "2.47", "21.00"),
          dishFamily: 1,
        }),
      ),
    ],
    bill: [s1Bill],
  };

  // S9: the Rioja comped, then the bill's 10%.
  const s9 = {
    groups: [
      group(
        0,
        0,
        filed({
          gross: "0.00",
          listGross: "30.00",
          listUnitPriceGross: "30.00",
          net: net("0.00", "0.00", "21.00"),
          adjustments: [{ kind: "comp", amount: "27.00" }],
        }),
      ),
      group(1, 1, pan),
    ],
    bill: [s5Bill],
  };

  // S14: the croquetas' own 10% on the first row, a 1% bill discount over everything.
  const s14Own = own("1.00");
  const s14 = (secondCroquetasFamily: number) => ({
    groups: [
      group(
        0,
        0,
        filed({
          quantity: "2",
          gross: "5.94",
          listGross: "6.66",
          listUnitPriceGross: "3.33",
          net: net("2.46", "4.91", "21.00"),
          adjustments: [s14Own],
        }),
      ),
      group(
        1,
        1,
        filed({
          gross: "11.88",
          listGross: "12.00",
          listUnitPriceGross: "12.00",
          net: net("9.82", "9.82", "21.00"),
        }),
      ),
      group(
        2,
        secondCroquetasFamily,
        filed({
          gross: "2.96",
          listGross: "3.33",
          listUnitPriceGross: "3.33",
          net: net("2.45", "2.45", "21.00"),
        }),
      ),
    ],
    bill: [{ kind: "discount", percentBp: 100, amount: "0.21" } satisfies ReceiptAdjustment],
  });

  // S11: the croquetas' own 10% and no whole-bill discount.
  const s11Own = own("1.00");
  const s11 = {
    groups: [
      group(
        0,
        0,
        filed({
          quantity: "2",
          gross: "6.00",
          listGross: "6.66",
          listUnitPriceGross: "3.33",
          net: net("2.48", "4.96", "21.00"),
          adjustments: [s11Own],
        }),
      ),
      group(
        1,
        0,
        filed({
          gross: "2.99",
          listGross: "3.33",
          listUnitPriceGross: "3.33",
          net: net("2.47", "2.47", "21.00"),
        }),
      ),
    ],
    bill: [],
  };

  // Rule 4: a pizza at 21% with its own 10% and an Aceitunas extra at 10%, then the bill's 10%.
  const twoRates = {
    groups: [
      group(
        0,
        0,
        filed({
          gross: "7.29",
          listGross: "9.00",
          listUnitPriceGross: "9.00",
          net: net("6.02", "6.02", "21.00"),
          adjustments: [own("1.05")],
        }),
        filed({
          parentLineNo: 1,
          gross: "1.21",
          listGross: "1.50",
          listUnitPriceGross: "1.50",
          net: net("1.10", "1.10", "10.00"),
        }),
      ),
      group(1, 2, pan),
    ],
    bill: [own("1.20")],
  };

  // S12: the reader fell back to one entry on the dish, with no bill adjustments.
  const s12Entry: ReceiptAdjustment = { kind: "discount", amount: "2.28" };
  const s12 = {
    groups: [
      group(
        0,
        0,
        filed({
          gross: "9.72",
          listGross: "12.00",
          listUnitPriceGross: "12.00",
          net: net("8.03", "8.03", "21.00"),
          adjustments: [s12Entry],
        }),
      ),
    ],
    bill: [],
  };

  const run = ({ groups, bill }: { groups: FiguredGroup[]; bill: ReceiptAdjustment[] }) =>
    invoiceDiscounts(groups, bill);

  it("prints a whole-bill discount once per rate at the end, and nothing under a dish (S5, owner Q10)", () => {
    const result = run(s5);
    expect(under(result)).toEqual({});
    expect(result.atEnd).toEqual([
      { rate: "21.00", amount: "2.48", comp: false, named: s5Bill },
      { rate: "10.00", amount: "0.22", comp: false, named: s5Bill },
    ]);
  });

  it("prints a dish's own discount under it, named, when the bill has one too (S1, owner Q10)", () => {
    const result = run(s1);
    expect(under(result)).toEqual({
      0: [{ rate: "21.00", amount: "0.99", comp: false, named: s1Own }],
    });
    expect(result.atEnd).toMatchObject([
      { rate: "21.00", amount: "2.59", comp: false, named: s1Bill },
      { rate: "10.00", amount: "0.26", comp: false, named: s1Bill },
    ]);
  });

  it("calls a comped dish's own row an invitation and leaves the bill's share for the end (S9)", () => {
    const result = run(s9);
    expect(under(result)).toMatchObject({ 0: [{ rate: "21.00", amount: "22.31", comp: true }] });
    expect(result.atEnd).toMatchObject([
      { rate: "21.00", amount: "2.48" },
      { rate: "10.00", amount: "0.22" },
    ]);
  });

  it("takes a dish's own discount over every row of its family (S14)", () => {
    const result = run(s14(0));
    expect(under(result)).toEqual({
      0: [{ rate: "21.00", amount: "0.83", comp: false, named: s14Own }],
    });
    expect(result.atEnd).toMatchObject([{ rate: "21.00", amount: "0.16" }]);
  });

  it("prints a family's whole discount under it when the bill has none (S11)", () => {
    const result = run(s11);
    expect(under(result)).toEqual({
      0: [{ rate: "21.00", amount: "0.82", comp: false, named: s11Own }],
    });
    expect(result.atEnd).toEqual([]);
  });

  it("prints a family with two rates' whole discount under it, plain, rate by rate (rule 4)", () => {
    const result = run(twoRates);
    expect(under(result)).toEqual({
      0: [
        { rate: "21.00", amount: "1.42", comp: false, named: null },
        { rate: "10.00", amount: "0.26", comp: false, named: null },
      ],
    });
    expect(result.atEnd).toMatchObject([{ rate: "10.00", amount: "0.22" }]);
  });

  it("names the fallback's one entry under the dish (S12)", () => {
    const result = run(s12);
    expect(under(result)).toEqual({
      0: [{ rate: "21.00", amount: "1.89", comp: false, named: s12Entry }],
    });
    expect(result.atEnd).toEqual([]);
  });

  const balanced = { s5, s1, s9, s14: s14(0), s11, twoRates };

  it.each(Object.entries({ ...balanced, s12 }))(
    "prints no row that is zero or negative (%s)",
    (_name, scenario) => {
      const result = run(scenario);
      for (const row of [...[...result.under.values()].flat(), ...result.atEnd]) {
        expect(compareDecimal(row.amount, decimal("0"))).toBe(1);
      }
    },
  );

  it("adds no row for a group nothing was taken off", () => {
    const untouched = group(0, 0, filed({ net: net("4.00", "8.00", "10") }));
    expect(under(invoiceDiscounts([untouched], []))).toEqual({});
    const withBill = invoiceDiscounts([untouched], [s5Bill]);
    expect(under(withBill)).toEqual({});
    expect(withBill.atEnd).toEqual([]);
  });

  it.each(Object.entries(balanced))(
    "comes to the filed bases rate by rate (%s)",
    (_name, scenario) => {
      const result = run(scenario);
      const lines = scenario.groups.flatMap((g) => g.lines);
      const rows = [...[...result.under.values()].flat(), ...result.atEnd];
      const rates = [...new Set(lines.map(({ line }) => line.net.rate))];
      for (const rate of rates) {
        const at = (r: string) => compareDecimal(decimal(r), decimal(rate)) === 0;
        const amounts = sumDecimals(
          lines.filter(({ line }) => at(line.net.rate)).map(({ figures }) => figures.amount),
        );
        const taken = sumDecimals(rows.filter((row) => at(row.rate)).map((row) => row.amount));
        const bases = sumDecimals(
          lines.filter(({ line }) => at(line.net.rate)).map(({ line }) => decimal(line.net.base)),
        );
        expect(compareDecimal(subtractDecimal(amounts, taken), bases)).toBe(0);
      }
    },
  );

  it("prints a family's row under the first of its groups that carries an own entry", () => {
    const result = invoiceDiscounts(
      [
        group(
          0,
          0,
          filed({
            gross: "3.00",
            listGross: "3.33",
            listUnitPriceGross: "3.33",
            net: net("2.48", "2.48", "21.00"),
          }),
        ),
        group(
          1,
          0,
          filed({
            gross: "3.00",
            listGross: "3.33",
            listUnitPriceGross: "3.33",
            net: net("2.48", "2.48", "21.00"),
            adjustments: [own("0.66")],
          }),
        ),
      ],
      [],
    );
    expect(under(result)).toEqual({
      1: [{ rate: "21.00", amount: "0.54", comp: false, named: own("0.66") }],
    });
  });

  it("names the end rows plainly when the bill carries more than one adjustment", () => {
    const result = invoiceDiscounts(s5.groups, [own("2.00"), { kind: "discount", amount: "1.25" }]);
    expect(result.atEnd).toMatchObject([
      { rate: "21.00", amount: "2.48", named: null },
      { rate: "10.00", amount: "0.22", named: null },
    ]);
  });

  it("keeps a dish's own row no larger than the discount its family's lines carry", () => {
    // 1,01 at 21% is 0,83 before VAT; filed at 0,79 the line carries 0,04, while its own entry
    // of 0,06 would be 0,05 before VAT.
    const result = invoiceDiscounts(
      [
        group(
          0,
          0,
          filed({
            gross: "0.96",
            listGross: "1.01",
            listUnitPriceGross: "1.01",
            net: net("0.79", "0.79", "21.00"),
            adjustments: [{ kind: "discount", amount: "0.06" }],
          }),
        ),
        group(
          1,
          1,
          filed({
            gross: "11.01",
            listGross: "12.00",
            listUnitPriceGross: "12.00",
            net: net("9.10", "9.10", "21.00"),
          }),
        ),
      ],
      [{ kind: "discount", amount: "1.00" }],
    );
    expect(under(result)).toMatchObject({ 0: [{ rate: "21.00", amount: "0.04" }] });
    expect(result.atEnd).toMatchObject([{ rate: "21.00", amount: "0.82" }]);
  });

  it("orders the end rows by where each rate first appears on the invoice, across families", () => {
    const result = invoiceDiscounts(
      [
        group(0, 0, rioja),
        group(
          1,
          1,
          filed({
            gross: "0.94",
            listGross: "1.04",
            listUnitPriceGross: "1.04",
            net: net("0.90", "0.90", "4.00"),
          }),
        ),
        group(2, 0, pan),
      ],
      [s5Bill],
    );
    expect(result.atEnd.map((row) => row.rate)).toEqual(["21.00", "4.00", "10.00"]);
  });

  describe("a family's own rows with no whole-bill discount", () => {
    const pizza = filed({
      gross: "8.10",
      listGross: "9.00",
      listUnitPriceGross: "9.00",
      net: net("6.69", "6.69", "21.00"),
      adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.05" }],
    });
    const olives = filed({
      parentLineNo: 1,
      gross: "1.35",
      listGross: "1.50",
      listUnitPriceGross: "1.50",
      net: net("1.12", "1.12", "21.00"),
    });
    const comped = filed({
      gross: "0.00",
      listGross: "30.00",
      listUnitPriceGross: "30.00",
      net: net("0.00", "0.00", "21.00"),
      adjustments: [{ kind: "comp", amount: "30.00" }],
    });

    it("adds a dish's and its extras' discounts into one row named by the dish's one adjustment", () => {
      const result = invoiceDiscounts([group(0, 0, pizza, olives)], []);
      expect(under(result)).toEqual({
        0: [
          {
            rate: "21.00",
            amount: "0.87",
            comp: false,
            named: { kind: "discount", percentBp: 1000, amount: "1.05" },
          },
        ],
      });
      expect(result.atEnd).toEqual([]);
    });

    it("calls a comped dish an invitation", () => {
      expect(under(invoiceDiscounts([group(0, 0, comped)], []))).toEqual({
        0: [
          { rate: "21.00", amount: "24.79", comp: true, named: { kind: "comp", amount: "30.00" } },
        ],
      });
    });

    it("names no percentage for two discounts on one dish", () => {
      const burger = filed({
        gross: "10.26",
        listGross: "12.00",
        listUnitPriceGross: "12.00",
        net: net("8.48", "8.48", "21.00"),
        adjustments: [TEN, { kind: "discount", percentBp: 500, amount: "0.54" }],
      });
      expect(under(invoiceDiscounts([group(0, 0, burger)], []))).toEqual({
        0: [{ rate: "21.00", amount: "1.44", comp: false, named: null }],
      });
    });

    it("reads rates 10 and 10.00 as one rate", () => {
      const dish = filed({
        gross: "9.00",
        listGross: "10.00",
        listUnitPriceGross: "10.00",
        net: net("8.18", "8.18", "10"),
      });
      const extra = filed({
        parentLineNo: 1,
        gross: "1.35",
        listGross: "1.50",
        listUnitPriceGross: "1.50",
        net: net("1.23", "1.23", "10.00"),
      });
      const result = invoiceDiscounts([group(0, 0, dish, extra)], []);
      expect(result.under.get(0)?.map((d) => [d.rate, d.amount])).toEqual([["10", "1.04"]]);
    });

    it("does not call a row an invitation when a discounted extra beside the comped dish is still charged", () => {
      const result = invoiceDiscounts([group(0, 0, comped, olives)], []);
      expect(result.under.get(0)?.map((d) => [d.rate, d.amount, d.comp])).toEqual([
        ["21.00", "24.91", false],
      ]);
    });

    it("gives each rate in a group its own row, and none to a group nothing lowered", () => {
      const reducedExtra = {
        ...olives,
        net: net("1.36", "1.36", "10.00"),
        listGross: "1.65",
        listUnitPriceGross: "1.65",
        gross: "1.50",
      };
      const result = invoiceDiscounts(
        [group(0, 0, pizza, reducedExtra), group(1, 2, filed({ net: net("4.00", "8.00", "10") }))],
        [],
      );
      expect(under(result)).toMatchObject({
        0: [
          { rate: "21.00", amount: "0.75", named: pizza.adjustments![0] },
          { rate: "10.00", amount: "0.14", named: pizza.adjustments![0] },
        ],
      });
      expect(result.under.has(1)).toBe(false);
    });
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
