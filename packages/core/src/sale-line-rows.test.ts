import { describe, expect, it } from "vitest";
import { saleLineRows } from "./sale-line-rows.js";
import type { RecordSaleLine } from "./record-sale.js";

describe("saleLineRows", () => {
  it("carries the frozen name and the variant's customer, staff and kitchen names onto the row", () => {
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
      modifierSnapshots: [],
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
      modifierSnapshots: [],
      unitName: { "en-GB": "cup" },
      unitPrecision: 0,
      quantity: "1",
      unitPrice: "3.00",
      vatRate: "10.00",
      lineTotal: "3.00",
      category: "Drinks",
    });
  });

  it("defaults the optional variant name fields to null when the line omits them", () => {
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
      modifierSnapshots: [],
      unitName: null,
      unitPrecision: null,
      quantity: "1",
      unitPrice: "1.00",
      vatRate: "10.00",
      lineTotal: "1.00",
      category: null,
    });
  });
});
