import { describe, expect, it } from "vitest";
import {
  dishGross,
  lineGross,
  optionGross,
  quantityLabel,
  toWireLineExtras,
  toWireOption,
} from "./order-line.js";
import type { OrderLine, SelectedLineOption } from "./working-order.js";
import type { TillProduct } from "../api/client.js";

// A gross-1.50 espresso at the general rate; the brief's worked example (×2 = "3.00").
const cafe: TillProduct = {
  id: "cafe",
  descriptions: { es: "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

// A weight product priced per kg: 10.00/kg gross at the reduced rate.
const jamon: TillProduct = {
  id: "jamon",
  descriptions: { es: "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

// A +0.50 gross modifier.
const shot: SelectedLineOption = {
  optionGroupItemId: "opt-shot",
  name: { es: "Café extra" },
  priceDelta: "0.50",
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

    it("adds each option's delta at the dish quantity", () => {
      const line: OrderLine = { product: cafe, quantity: "2", options: [shot] };
      // (1.50 + 0.50) × 2 = 4.00
      expect(lineGross(line)).toBe("4.00");
    });

    describe("per-option quantity", () => {
      it("an option with quantity 2 on a dish-quantity-3 line contributes priceDelta × 6", () => {
        const line: OrderLine = {
          product: cafe,
          quantity: "3",
          options: [{ ...shot, quantity: 2 }],
        };
        // dish 1.50 × 3 = 4.50; option 0.50 × (3 × 2) = 3.00; total 7.50
        expect(lineGross(line)).toBe("7.50");
      });

      it("an option with quantity omitted is byte-identical to quantity 1", () => {
        const line: OrderLine = { product: cafe, quantity: "3", options: [shot] };
        const withOne: OrderLine = {
          product: cafe,
          quantity: "3",
          options: [{ ...shot, quantity: 1 }],
        };
        expect(lineGross(line)).toBe(lineGross(withOne));
        // dish 1.50 × 3 = 4.50; option 0.50 × 3 = 1.50; total 6.00
        expect(lineGross(line)).toBe("6.00");
      });
    });
  });

  describe("dishGross", () => {
    it("prices only the dish, ignoring options", () => {
      const line: OrderLine = { product: cafe, quantity: "2", options: [shot] };
      expect(dishGross(line)).toBe("3.00");
    });
  });

  describe("optionGross", () => {
    it("prices an option at priceDelta × dish quantity when quantity omitted", () => {
      const line: OrderLine = { product: cafe, quantity: "2", options: [shot] };
      expect(optionGross(line, shot)).toBe("1.00");
    });

    it("an option with quantity 2 on a dish-quantity-3 line returns priceDelta × 6", () => {
      const option: SelectedLineOption = { ...shot, quantity: 2 };
      const line: OrderLine = { product: cafe, quantity: "3", options: [option] };
      // 0.50 × (3 × 2) = 3.00
      expect(optionGross(line, option)).toBe("3.00");
    });
  });

  describe("quantityLabel", () => {
    it("labels a weight line with kg and an each line bare", () => {
      expect(quantityLabel({ product: jamon, quantity: "0.320" })).toBe("0.320 kg");
      expect(quantityLabel({ product: cafe, quantity: "2" })).toBe("2");
    });
  });

  describe("toWireOption", () => {
    it("includes quantity when it exceeds 1", () => {
      expect(toWireOption({ ...shot, quantity: 2 })).toEqual({
        optionGroupItemId: "opt-shot",
        quantity: 2,
      });
    });

    it("omits quantity when it is exactly 1", () => {
      expect(toWireOption({ ...shot, quantity: 1 })).toEqual({ optionGroupItemId: "opt-shot" });
    });

    it("omits quantity when it is absent", () => {
      expect(toWireOption(shot)).toEqual({ optionGroupItemId: "opt-shot" });
    });
  });

  describe("toWireLineExtras", () => {
    it("forwards note and doneness when both are present", () => {
      const line: OrderLine = { product: cafe, quantity: "1", note: "no mayo", doneness: "medium" };
      expect(toWireLineExtras(line)).toEqual({ note: "no mayo", doneness: "medium" });
    });

    it("forwards only the field that is present", () => {
      expect(toWireLineExtras({ product: cafe, quantity: "1", doneness: "well_done" })).toEqual({
        doneness: "well_done",
      });
      expect(toWireLineExtras({ product: cafe, quantity: "1", note: "extra crispy" })).toEqual({
        note: "extra crispy",
      });
    });

    it("returns an empty object when neither is present", () => {
      expect(toWireLineExtras({ product: cafe, quantity: "1" })).toEqual({});
    });
  });
});
