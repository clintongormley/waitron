import { describe, expect, it } from "vitest";
import {
  dishGross,
  extraGross,
  lineGross,
  needsModifierPicker,
  quantityLabel,
  toWireLineExtras,
  toWireModifiers,
  toWireProductIdentity,
} from "./order-line.js";
import type { OrderLine, SelectedExtra } from "./working-order.js";
import { sellingValuesOf, type TillProduct } from "../api/client.js";

// A gross-1.50 espresso at the general rate.
const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  unit: {
    id: "unit-each",
    name: { en: "unit", es: "unidad" },
    abbreviation: { en: "ea", es: "ud" },
    precision: 0,
    hardwareUnit: null,
  },
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

// A weight product priced per kg: 10.00/kg gross at the reduced rate.
const jamon: TillProduct = {
  id: "jamon",
  name: "Jamón",
  customerName: { es: "Jamón para el cliente" },
  unit: {
    id: "unit-kg",
    name: { en: "kg", es: "kg" },
    abbreviation: { en: "kg", es: "kg" },
    precision: 3,
    hardwareUnit: "kg",
  },
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

const shot: SelectedExtra = {
  listId: "list-extras",
  productId: "p-shot",
  name: "Café extra",
  price: "0.50",
  quantity: 1,
};

describe("order-line pricing", () => {
  describe("lineGross", () => {
    it("prices a plain each line as unitPrice × quantity", () => {
      const line: OrderLine = { product: cafe, quantity: "2" };
      expect(lineGross(line)).toBe("3.00");
    });

    it("prices a weight line as unitPrice × kg", () => {
      const line: OrderLine = { product: jamon, quantity: "0.320" };
      expect(lineGross(line)).toBe("3.20");
    });

    it("adds each extras pick at the dish quantity", () => {
      const line: OrderLine = { product: cafe, quantity: "2", extras: [shot] };
      // (1.50 + 0.50) × 2 = 4.00
      expect(lineGross(line)).toBe("4.00");
    });

    it("an options answer costs nothing", () => {
      const line: OrderLine = {
        product: cafe,
        quantity: "2",
        options: [{ listId: "list-cooked", labelId: "label-medium" }],
      };
      expect(lineGross(line)).toBe("3.00");
    });

    describe("per-pick quantity", () => {
      it("a pick of 2 on a dish-quantity-3 line contributes its price × 6", () => {
        const line: OrderLine = {
          product: cafe,
          quantity: "3",
          extras: [{ ...shot, quantity: 2 }],
        };
        // dish 1.50 × 3 = 4.50; extra 0.50 × (3 × 2) = 3.00; total 7.50
        expect(lineGross(line)).toBe("7.50");
      });
    });
  });

  describe("dishGross", () => {
    it("prices only the dish, ignoring its extras", () => {
      const line: OrderLine = { product: cafe, quantity: "2", extras: [shot] };
      expect(dishGross(line)).toBe("3.00");
    });
  });

  describe("extraGross", () => {
    it("prices a pick at its price × dish quantity when it is taken once", () => {
      const line: OrderLine = { product: cafe, quantity: "2", extras: [shot] };
      expect(extraGross(line, shot)).toBe("1.00");
    });

    it("a pick of 2 on a dish-quantity-3 line returns its price × 6", () => {
      const extra: SelectedExtra = { ...shot, quantity: 2 };
      const line: OrderLine = { product: cafe, quantity: "3", extras: [extra] };
      // 0.50 × (3 × 2) = 3.00
      expect(extraGross(line, extra)).toBe("3.00");
    });
  });

  describe("quantityLabel", () => {
    it("labels every line with its selected unit", () => {
      expect(quantityLabel({ product: jamon, quantity: "0.320" })).toBe("0.320 kg");
      expect(quantityLabel({ product: cafe, quantity: "2" })).toBe("2 ea");
    });
  });

  describe("toWireLineExtras", () => {
    it("forwards the note when the line carries one", () => {
      const line: OrderLine = { product: cafe, quantity: "1", note: "no mayo" };
      expect(toWireLineExtras(line)).toEqual({ note: "no mayo" });
    });

    it("returns an empty object when the line carries no note", () => {
      const plain: OrderLine = { product: cafe, quantity: "1" };
      expect(toWireLineExtras(plain)).toEqual({});
    });
  });

  describe("toWireModifiers", () => {
    it("sends one entry per answered list, picks grouped under their own list", () => {
      const line: OrderLine = {
        product: cafe,
        quantity: "1",
        extras: [
          shot,
          { ...shot, productId: "p-syrup", name: "Sirope", price: "0.40", quantity: 2 },
          { ...shot, listId: "list-milk", productId: "p-oat", name: "Avena", price: "0.30" },
        ],
        options: [{ listId: "list-cooked", labelId: "label-medium" }],
      };
      expect(toWireModifiers(line)).toEqual({
        extras: [
          {
            listId: "list-extras",
            picks: [
              { productId: "p-shot", quantity: 1 },
              { productId: "p-syrup", quantity: 2 },
            ],
          },
          { listId: "list-milk", picks: [{ productId: "p-oat", quantity: 1 }] },
        ],
        options: [{ listId: "list-cooked", labelId: "label-medium" }],
      });
    });

    it("omits both keys on a line that answered nothing", () => {
      const plain: OrderLine = { product: cafe, quantity: "1" };
      expect(toWireModifiers(plain)).toEqual({});
    });

    it("never sends a display value — a pick names its product and count alone", () => {
      const line: OrderLine = { product: cafe, quantity: "1", extras: [shot] };
      const wire = toWireModifiers(line);
      expect(wire.extras![0]!.picks[0]).toEqual({ productId: "p-shot", quantity: 1 });
    });
  });

  describe("toWireProductIdentity", () => {
    it("sends the menu item and no product id", () => {
      expect(toWireProductIdentity({ id: "cafe", menuItemId: "mi-cafe" })).toEqual({
        menuItemId: "mi-cafe",
      });
    });

    it("sends the chosen variant beside the menu item", () => {
      expect(
        toWireProductIdentity({ id: "cafe", menuItemId: "mi-cafe", variantId: "v-large" }),
      ).toEqual({ menuItemId: "mi-cafe", variantId: "v-large" });
    });

    it("refuses a product with no menu item, naming the product", () => {
      expect(() => toWireProductIdentity({ id: "cafe" })).toThrow(/cafe/);
    });
  });
});

it("rounds each extras pick before summing, so a fractional dish quantity matches the server", () => {
  const line: OrderLine = {
    product: jamon,
    quantity: "0.125",
    extras: [{ ...shot, quantity: 2 }],
  };
  // dish 10.00 × 0.125 = 1.25; extra 0.50 × (0.125 × 2) = 0.125 → 0.13 rounded on its own row.
  expect(lineGross(line)).toBe("1.38");
});

describe("needsModifierPicker", () => {
  const wine = (available: boolean) => ({
    ...sellingValuesOf(cafe),
    id: "wine-125",
    name: "Wine 125",
    unitPrice: "4.50",
    unitPriceDifference: "0.50",
    available,
  });

  // A product with variants is never rung up as itself: tapping it always asks which.
  it("is true for a product with variants, whether or not one is available", () => {
    expect(needsModifierPicker({ ...cafe, variants: [wine(true)] })).toBe(true);
    expect(needsModifierPicker({ ...cafe, variants: [wine(false)] })).toBe(true);
  });

  it("is false for a product offering neither a variant nor a list", () => {
    expect(needsModifierPicker({ ...cafe, variants: [], offeredModifiers: [] })).toBe(false);
  });
});
