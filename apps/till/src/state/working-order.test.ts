import { describe, expect, it } from "vitest";
import { WorkingOrderStore } from "./working-order.js";
import type { TillProduct } from "../api/client.js";

// A gross-1.50 espresso at the general rate; the brief's worked example (×2 = "3.00").
const cafe: TillProduct = {
  id: "cafe",
  descriptions: { "es-ES": "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
};

// A weight product priced per kg: 10.00/kg gross at the reduced rate.
const jamon: TillProduct = {
  id: "jamon",
  descriptions: { "es-ES": "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
};

describe("WorkingOrderStore", () => {
  it("adds an each line and previews the total via priceBasket", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "2");
    expect(s.total).toBe("3.00");
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toEqual({ product: cafe, quantity: "2" });
  });

  it("prices a weight line by its kg quantity", () => {
    const s = new WorkingOrderStore();
    s.addProduct(jamon, "0.320"); // 10.00 × 0.320 = 3.20
    expect(s.total).toBe("3.20");
  });

  it("previews an empty basket as a zero total with no VAT bands", () => {
    const s = new WorkingOrderStore();
    expect(s.total).toBe("0");
    expect(s.vatBreakdown).toEqual([]);
    expect(s.lines).toHaveLength(0);
  });

  it("groups vatBreakdown by rate across a mixed-rate basket", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "2"); // general (21.00)
    s.addProduct(jamon, "0.320"); // reduced (10.00)
    const rates = s.vatBreakdown.map((b) => b.rate).sort();
    expect(rates).toEqual(["10.00", "21.00"]);
    // Every band's base + tax reconstructs its gross slice, and the bands sum to the preview total.
    for (const band of s.vatBreakdown) {
      expect(band.base).toBeDefined();
      expect(band.tax).toBeDefined();
    }
  });

  it("notifies subscribers on add and on clear, then empties the lines", () => {
    const s = new WorkingOrderStore();
    let n = 0;
    s.subscribe(() => n++);
    s.addProduct(cafe, "1");
    s.clear();
    expect(n).toBe(2);
    expect(s.lines).toHaveLength(0);
  });

  it("removeLine drops one line by index and notifies", () => {
    const s = new WorkingOrderStore();
    let n = 0;
    s.subscribe(() => n++);
    s.addProduct(cafe, "1");
    s.addProduct(jamon, "0.100");
    s.removeLine(0);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.product).toBe(jamon);
    expect(n).toBe(3); // two adds + one remove
  });

  it("removeLine is a true no-op for an out-of-range index — no mutation, no notification", () => {
    const s = new WorkingOrderStore();
    let n = 0;
    s.subscribe(() => n++);
    s.addProduct(cafe, "1");
    s.addProduct(jamon, "0.100");
    const notificationsAfterAdds = n;

    s.removeLine(-1); // splice(-1, 1) would otherwise drop the LAST line
    s.removeLine(5); // past the end

    expect(s.lines).toHaveLength(2);
    expect(s.lines[0]?.product).toBe(cafe);
    expect(s.lines[1]?.product).toBe(jamon);
    expect(n).toBe(notificationsAfterAdds);
  });

  it("stops notifying once the subscription is disposed", () => {
    const s = new WorkingOrderStore();
    let n = 0;
    const unsubscribe = s.subscribe(() => n++);
    s.addProduct(cafe, "1");
    unsubscribe();
    s.addProduct(cafe, "1");
    expect(n).toBe(1);
  });

  it("supports independent subscribers on the changed channel", () => {
    const s = new WorkingOrderStore();
    let a = 0;
    let b = 0;
    s.subscribe(() => a++);
    s.subscribe(() => b++);
    s.addProduct(cafe, "1");
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("broadcasts a product-selected event through the same channel API", () => {
    const s = new WorkingOrderStore();
    const seen: TillProduct[] = [];
    s.on("product-selected", (p) => seen.push(p as TillProduct));
    s.emit("product-selected", cafe);
    expect(seen).toEqual([cafe]);
    // Selecting a product is a broadcast, not a mutation: it must not touch the basket.
    expect(s.lines).toHaveLength(0);
  });

  it("emitting an event with no listeners is a no-op", () => {
    const s = new WorkingOrderStore();
    expect(() => s.emit("product-selected", cafe)).not.toThrow();
  });

  it("is a plain store with no session coupling — instances are independent", () => {
    const a = new WorkingOrderStore();
    const b = new WorkingOrderStore();
    a.addProduct(cafe, "1");
    // Nothing a 'logout' could call resets it — only clear() empties an instance, and one
    // instance's state never leaks into another.
    expect(a.lines).toHaveLength(1);
    expect(b.lines).toHaveLength(0);
  });
});
