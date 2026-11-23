import { addDecimal, decimal, type Decimal } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { rateLetters, receiptFigures, type ReceiptFigures } from "./receipt-facts.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import {
  advanceTakenOff,
  billDiscountOverTwoRates,
  burgerAndBread,
  burgerAndBreadWithBillDiscount,
  dishDiscountOverExtraAtAnotherRate,
  fullComp,
  ownAdjustmentAboveWhatTheDishLost,
  ownPartCompUnderBillComp,
  recordsNotPlaced,
  simplifiedAdvanceTakenOff,
  simplifiedDishDiscountOverExtraAtAnotherRate,
  threeCentRows,
  unfiledDish,
} from "./testing/receipt-cases.js";

const charged = (figures: ReceiptFigures): Decimal[] =>
  figures.sections.flatMap((section) => {
    switch (section.kind) {
      case "filed":
        return section.rows.flatMap((row) =>
          row.chargedWithVat === undefined ? [] : [row.chargedWithVat],
        );
      case "withVat": {
        const { amount, options, adjustments } = section.group;
        return [
          amount,
          ...options.map((option) => option.amount),
          ...adjustments.map((adjustment) => adjustment.amount),
        ];
      }
      case "takenOff":
        return section.rows.map((row) => row.amount);
    }
  });

const fixtureName = (index: number): string =>
  FULL_INVOICE_DOCUMENT_FIXTURE.result.lines[index]!.descriptions["es-ES"]!;

const sum = (amounts: readonly Decimal[]): Decimal =>
  amounts.reduce((total, amount) => addDecimal(total, amount), decimal("0.00"));

describe("receiptFigures", () => {
  it("charges the fixture's rows 12,10, −1,21 and 8,80, which come to TOTAL", () => {
    const figures = receiptFigures(FULL_INVOICE_DOCUMENT_FIXTURE);
    expect(charged(figures)).toEqual(["12.10", "-1.21", "8.80"]);
    expect(sum(charged(figures))).toBe("19.69");
    expect(figures.total).toBe("19.69");
    expect(figures.simplified).toBe(false);
  });

  it("keeps the fixture's raw VAT-exclusive figures and rates on its filed rows", () => {
    const [section] = receiptFigures(FULL_INVOICE_DOCUMENT_FIXTURE).sections;
    expect(section).toEqual({
      kind: "filed",
      rows: [
        {
          kind: "line",
          units: "1",
          item: fixtureName(0),
          indent: 0,
          unitPrice: "10.00",
          amountExVat: "10.00",
          rate: "21",
          chargedWithVat: "12.10",
        },
        {
          kind: "discount",
          units: "",
          item: expect.any(String),
          indent: 2,
          amountExVat: "-1.00",
          rate: "21",
          chargedWithVat: "-1.21",
        },
        {
          kind: "line",
          units: "2",
          item: fixtureName(1),
          indent: 0,
          unitPrice: "4.00",
          amountExVat: "8.00",
          rate: "10",
          chargedWithVat: "8.80",
        },
      ],
    });
  });

  it("gives the VAT summary as the record's raw rates, bases and VAT", () => {
    expect(receiptFigures(FULL_INVOICE_DOCUMENT_FIXTURE).vat).toEqual([
      { rate: "21", base: "9.00", tax: "1.89" },
      { rate: "10", base: "8.00", tax: "0.80" },
    ]);
  });

  it("charges each 0,03 € row 0,03 €, so three come to TOTAL rather than a cent over", () => {
    const figures = receiptFigures(threeCentRows());
    expect(charged(figures)).toEqual(["0.03", "0.03", "0.03"]);
    expect(sum(charged(figures))).toBe(figures.total);
  });

  it("puts a bill discount's share at each rate on the end rows, VAT included", () => {
    const figures = receiptFigures(billDiscountOverTwoRates());
    expect(charged(figures)).toEqual(["30.00", "2.50", "-3.00", "-0.25"]);
  });

  it("splits a dish's own discount over its extra at another rate, VAT included", () => {
    const figures = receiptFigures(dishDiscountOverExtraAtAnotherRate());
    expect(charged(figures)).toEqual(["10.00", "2.00", "-1.00", "-0.20"]);
  });

  it("charges an own part comp what its adjustment took and the bill comp the rest", () => {
    expect(charged(receiptFigures(ownPartCompUnderBillComp()))).toEqual([
      "10.00",
      "-6.00",
      "-4.00",
    ]);
  });

  it("caps a dish's own row at what the dish lost when its adjustment says more", () => {
    expect(charged(receiptFigures(ownAdjustmentAboveWhatTheDishLost()))).toEqual([
      "10.00",
      "-1.00",
      "0.00",
    ]);
  });

  it("charges the advance taken off after the bill's discount at its rate", () => {
    expect(charged(receiptFigures(advanceTakenOff()))).toEqual(["120.00", "-12.00", "-30.00"]);
  });

  it("charges a dish's own discount what it took and the bill's share at each rate the rest", () => {
    expect(charged(receiptFigures(burgerAndBreadWithBillDiscount()))).toEqual([
      "12.00",
      "-1.20",
      "2.50",
      "-1.08",
      "-0.25",
    ]);
  });

  it("charges a row whose list price could not be priced before VAT what it was charged", () => {
    const input = burgerAndBreadWithBillDiscount();
    delete input.result.lines[1]!.listUnitPriceGross;
    const figures = receiptFigures(input);
    expect(charged(figures)).toEqual(["12.00", "-1.20", "2.25", "-1.08"]);
    expect(sum(charged(figures))).toBe(figures.total);
  });

  it.each<[string, () => ReceiptDocumentInput]>([
    ["the fixture", () => FULL_INVOICE_DOCUMENT_FIXTURE],
    ["a dish discount over extras at another rate", dishDiscountOverExtraAtAnotherRate],
    ["the same on a simplified ticket", simplifiedDishDiscountOverExtraAtAnotherRate],
    ["a full comp", fullComp],
    ["an own part comp under a bill comp", ownPartCompUnderBillComp],
    ["an advance taken off", advanceTakenOff],
    ["an advance taken off a simplified ticket", simplifiedAdvanceTakenOff],
    ["records that could not be placed", recordsNotPlaced],
    ["an unfiled dish", unfiledDish],
    ["burgerAndBread", burgerAndBread],
    ["burgerAndBread with a bill discount", burgerAndBreadWithBillDiscount],
    ["a bill discount split over two rates", billDiscountOverTwoRates],
    ["three 0,03 € rows", threeCentRows],
    ["an own adjustment above what the dish lost", ownAdjustmentAboveWhatTheDishLost],
  ])("adds up to TOTAL exactly: %s", (_name, input) => {
    const figures = receiptFigures(input());
    expect(sum(charged(figures))).toBe(sum([figures.total]));
  });
});

describe("rateLetters", () => {
  it("letters each rate once, however its digits are written", () => {
    expect([...rateLetters([{ rate: "21" }, { rate: "21.00" }, { rate: "10" }])!]).toEqual([
      ["21", "A"],
      ["10", "B"],
    ]);
  });

  it("letters nothing on a bill with one rate", () => {
    expect(rateLetters([{ rate: "10" }, { rate: "10.00" }])).toBeNull();
  });
});
