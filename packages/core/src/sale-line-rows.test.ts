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
      variantId: "variant-1",
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
      variantId: "variant-1",
      variantName: "Large",
      variantDescriptions: { "en-GB": "Large", "en-US": "Large" },
      variantKitchenName: "LG",
      optionSnapshots: [cookedRare],
      unitName: { "en-GB": "cup" },
      unitPrecision: 0,
      quantity: "1",
      // The money columns hold whole cents, so the row this builds carries 300 for "3.00";
      // `quantity` and `vatRate` are not money columns and keep their decimal literals.
      unitPrice: 300,
      vatRate: "10.00",
      lineTotal: 300,
      category: "Drinks",
    });
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
      variantId: null,
      variantName: null,
      variantDescriptions: null,
      variantKitchenName: null,
      optionSnapshots: [],
      unitName: null,
      unitPrecision: null,
      quantity: "1",
      unitPrice: 100,
      vatRate: "10.00",
      lineTotal: 100,
      category: null,
    });
  });
});
