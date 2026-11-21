import type { saleLines } from "@waitron/db";
import { describe, expect, it } from "vitest";
import { reversedLines } from "./cancel-credit.js";

type Row = typeof saleLines.$inferSelect;

function row(overrides: Partial<Row>): Row {
  return {
    id: "line",
    saleId: "rest-sale",
    lineNo: 1,
    name: "Steak",
    descriptions: { "es-ES": "Ribeye steak" },
    variantName: null,
    variantDescriptions: null,
    variantKitchenName: null,
    kitchenName: null,
    optionSnapshots: [],
    unitName: null,
    unitPrecision: null,
    quantity: 1000,
    priceQuantity: 1000,
    unitPrice: 6612,
    vatRate: 2100,
    lineTotal: 6612,
    category: null,
    parentLineId: null,
    productId: null,
    parentProductId: null,
    menuId: null,
    menuVersionId: null,
    lineGross: 8000,
    listGross: null,
    listUnitPriceGross: null,
    classification: null,
    correctsLineId: null,
    advanceRole: null,
    deductsSaleId: null,
    ...overrides,
  };
}

describe("reversedLines", () => {
  it("a whole credit of a rest's invoice reverses its deduction line, role and sale included", () => {
    const [dish, deduction] = reversedLines([
      row({ id: "dish-line" }),
      row({
        id: "deduction-line",
        lineNo: 2,
        name: "Advance",
        quantity: -1000,
        unitPrice: 4545,
        vatRate: 1000,
        lineTotal: -4545,
        lineGross: -5000,
        advanceRole: "deduction",
        deductsSaleId: "advance-sale",
      }),
    ]);
    expect(dish).toMatchObject({ advanceRole: null, deductsSaleId: null });
    expect(deduction).toMatchObject({
      correctsLineId: "deduction-line",
      quantity: "1.000",
      lineTotal: "45.45",
      lineGross: "50.00",
      advanceRole: "deduction",
      deductsSaleId: "advance-sale",
    });
  });
});
