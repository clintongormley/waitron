import { describe, expect, it } from "vitest";
import type { ResolvedExtraList } from "@waitron/catalogue";
import { editLineExtras, type ExtraProductFacts } from "./modifier-selection.js";

describe("new extras unit preparation", () => {
  it("prepares only added picks and keeps a retained pick's recorded maps", () => {
    const unit = {
      id: "unit-weight",
      staffName: "Staff weight",
      staffAbbreviation: "sw",
      name: { fr: "Other weight" },
      abbreviation: { fr: "ow" },
      precision: 3,
      hardwareUnit: "kg" as const,
    };
    const list: ResolvedExtraList = {
      id: "list",
      name: "Staff list",
      customerName: null,
      kitchenName: "Kitchen list",
      minPicks: 0,
      maxPicks: null,
      active: true,
      items: ["old", "new"].map((productId) => ({
        id: productId,
        productId,
        maxQuantity: 2,
        preselected: false,
        price: "2.00",
        portion: "0.250",
        unit,
      })),
    };
    const facts: ExtraProductFacts = {
      id: "new",
      name: "Staff extra",
      descriptions: { en: "Customer extra" },
      kitchenName: "Kitchen extra",
      vatClass: "general",
    };
    const kept = {
      productId: "old",
      extraListId: "list",
      quantity: "0.250",
      priceQuantity: "0.250",
      unitName: { "fr-FR": "Recorded abbreviation" },
      unitContext: { name: { "fr-FR": "Recorded full name" } },
    };
    const before = structuredClone(kept);
    const result = editLineExtras(
      [list],
      new Map([["new", facts]]),
      [
        {
          listId: "list",
          picks: [
            { productId: "old", quantity: 1 },
            { productId: "new", quantity: 2 },
          ],
        },
      ],
      { children: [kept], dishQuantity: "1" },
      "en",
    );
    expect(result.kept).toEqual([{ child: before, perDish: 1 }]);
    expect(result.kept[0]!.child).toBe(kept);
    expect(kept).toEqual(before);
    expect(result.removed).toEqual([]);
    expect(result.added).toEqual([
      {
        productId: "new",
        name: "Staff extra",
        descriptions: { en: "Customer extra" },
        kitchenName: "Kitchen extra",
        price: "2.00",
        listId: "list",
        vatClass: "general",
        quantity: 2,
        physicalQuantity: "0.500",
        priceQuantity: "0.250",
        unitName: { en: "sw" },
        unitPrecision: 3,
        unitContext: {
          id: "unit-weight",
          name: { en: "Staff weight" },
          precision: 3,
          hardwareUnit: "kg",
        },
      },
    ]);
  });
});
