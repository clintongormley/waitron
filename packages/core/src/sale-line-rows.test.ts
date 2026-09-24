import { describe, expect, it } from "vitest";
import type { OptionSnapshot } from "@waitron/shared";
import { saleLineRows } from "./sale-line-rows.js";
import type { RecordSaleLine } from "./record-sale.js";

// The three names differ from each other so an assertion cannot pass while the wrong one is read.
const cookedRare: OptionSnapshot = {
  listName: { en: "Cooked" },
  listCustomerName: { en: "How would you like it?" },
  listKitchenName: "COOK",
  labelName: { en: "Rare" },
  labelCustomerName: { en: "Rare - pink throughout" },
  labelKitchenName: "R",
};

describe("saleLineRows", () => {
  it("carries the frozen name, the variant's three names and the frozen options answers onto the row", () => {
    const line: RecordSaleLine = {
      lineNo: 1,
      name: "Flat white",
      descriptions: { "en-GB": "Flat white", "en-US": "Flat white" },
      kitchenName: "FW",
      variantName: "Large",
      variantDescriptions: { "en-GB": "Large", "en-US": "Large" },
      variantKitchenName: "LG",
      unitName: { "en-GB": "cup" },
      unitPrecision: 0,
      quantity: "1",
      unitPrice: "3.00",
      vatRate: "10.00",
      lineTotal: "3.00",
      category: "Drinks",
      optionSnapshots: [cookedRare],
    };

    const [row] = saleLineRows("sale-1", [line]);

    expect(row).toEqual({
      id: row!.id,
      saleId: "sale-1",
      lineNo: 1,
      parentLineId: null,
      name: "Flat white",
      descriptions: { "en-GB": "Flat white", "en-US": "Flat white" },
      kitchenName: "FW",
      variantName: "Large",
      variantDescriptions: { "en-GB": "Large", "en-US": "Large" },
      variantKitchenName: "LG",
      optionSnapshots: [cookedRare],
      unitName: { "en-GB": "cup" },
      unitPrecision: 0,
      // Whole numbers at each column's scale: 1000 thousandths for the "1" quantity, 300 cents for
      // "3.00", 1000 basis points for the "10.00" rate.
      quantity: 1000,
      unitPrice: 300,
      vatRate: 1000,
      lineTotal: 300,
      category: "Drinks",
    });
  });

  it("counts a quantity in whole thousandths and a rate in whole basis points", () => {
    // Five grams is the case that separates the quantity scale from the money scale: at two places
    // 0.005 rounds to 0.01 and at three it is exactly 5 thousandths, so only 5 here shows the third
    // place survived. The four expected numbers differ from each other and from the amounts on the
    // same rows, so a conversion at the wrong scale for either column cannot produce this set.
    const lines: RecordSaleLine[] = [
      {
        lineNo: 1,
        name: "Jamón",
        descriptions: { "es-ES": "Jamón" },
        quantity: "1.5",
        unitPrice: "20.00",
        vatRate: "21.00",
        lineTotal: "30.00",
      },
      {
        lineNo: 2,
        name: "Azafrán",
        descriptions: { "es-ES": "Azafrán" },
        quantity: "0.005",
        unitPrice: "2000.00",
        vatRate: "10.50",
        lineTotal: "10.00",
      },
    ];

    const rows = saleLineRows("sale-1", lines);

    expect(rows.map((row) => row.quantity)).toEqual([1500, 5]);
    expect(rows.map((row) => row.vatRate)).toEqual([2100, 1050]);
  });

  it("defaults the variant names to null and the options answers to an empty list when the line omits them", () => {
    const line: RecordSaleLine = {
      lineNo: 1,
      name: "Water",
      descriptions: { "en-GB": "Water" },
      quantity: "1",
      unitPrice: "1.00",
      vatRate: "10.00",
      lineTotal: "1.00",
    };

    const [row] = saleLineRows("sale-1", [line]);

    expect(row).toEqual({
      id: row!.id,
      saleId: "sale-1",
      lineNo: 1,
      parentLineId: null,
      name: "Water",
      descriptions: { "en-GB": "Water" },
      kitchenName: null,
      variantName: null,
      variantDescriptions: null,
      variantKitchenName: null,
      optionSnapshots: [],
      unitName: null,
      unitPrecision: null,
      quantity: 1000,
      unitPrice: 100,
      vatRate: 1000,
      lineTotal: 100,
      category: null,
    });
  });
});
