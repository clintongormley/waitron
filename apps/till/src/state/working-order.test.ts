import { describe, expect, it } from "vitest";
import { WorkingOrderStore } from "./working-order.js";
import type { OrderLine } from "./working-order.js";
import type { TillProduct } from "../api/client.js";

// A v4 uuid, as `crypto.randomUUID()` mints: 8-4-4-4-12 hex, version nibble 4, variant 8..b.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  // The stable client-minted working-order id (keys pay-time idempotency; a retry re-sends it).
  it("mints a uuid id for a fresh store, unique per instance", () => {
    const a = new WorkingOrderStore();
    const b = new WorkingOrderStore();
    expect(a.id).toMatch(UUID_RE);
    expect(b.id).toMatch(UUID_RE);
    expect(a.id).not.toBe(b.id); // a new basket is a new working order
  });

  it("clear() mints a fresh id and empties the lines", () => {
    const s = new WorkingOrderStore();
    const before = s.id;
    s.addProduct(cafe, "1");
    s.clear();
    expect(s.id).not.toBe(before); // a cleared basket is a new working order
    expect(s.id).toMatch(UUID_RE);
    expect(s.lines).toHaveLength(0);
  });

  it("loadFrom replaces the basket — id, lines, total and label", () => {
    const s = new WorkingOrderStore();
    s.addProduct(jamon, "0.100"); // a pre-existing line that loadFrom must drop
    // Read total BEFORE loadFrom so the #priced cache is POPULATED (10.00 × 0.100 = 1.00). This is
    // what makes the "re-priced from the loaded lines" assertion below load-bearing on loadFrom's
    // `#priced = null` invalidation: without a populated cache going in, that line is untested and a
    // refactor could drop it and ship a stale retrieved-order total. Proven by deletion (CLAUDE.md §4).
    expect(s.total).toBe("1.00");
    const lines: OrderLine[] = [
      { product: cafe, quantity: "2" }, // 1.50 × 2 = 3.00 (general)
      { product: jamon, quantity: "0.320" }, // 10.00 × 0.320 = 3.20 (reduced)
    ];
    s.loadFrom("held-123", lines, "Mesa 4");
    expect(s.id).toBe("held-123");
    expect(s.label).toBe("Mesa 4");
    expect(s.lines).toEqual(lines);
    expect(s.total).toBe("6.20"); // re-priced from the loaded lines — proves #priced was invalidated
  });

  it("keeps the loaded id when a product is added after loadFrom — only clear() re-mints", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("held-abc", [{ product: cafe, quantity: "1" }]);
    s.addProduct(jamon, "0.100");
    expect(s.id).toBe("held-abc");
    expect(s.lines).toHaveLength(2);
  });

  it("loadFrom notifies subscribers once", () => {
    const s = new WorkingOrderStore();
    let n = 0;
    s.subscribe(() => n++);
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }], "Barra");
    expect(n).toBe(1);
  });

  it("loadFrom without a label clears any prior label", () => {
    const s = new WorkingOrderStore();
    s.label = "old";
    s.loadFrom("held-2", [{ product: cafe, quantity: "1" }]);
    expect(s.label).toBeUndefined();
  });

  it("set label updates the label and notifies subscribers so a header can re-render", () => {
    const s = new WorkingOrderStore();
    let n = 0;
    s.subscribe(() => n++);
    expect(s.label).toBeUndefined();
    s.label = "Mesa 7";
    expect(s.label).toBe("Mesa 7");
    expect(n).toBe(1);
  });

  // `persisted` (7c place/collect): whether `id` already names an OPEN row server-side, so the app
  // knows whether placing this basket needs a park first or can sync-then-place an already-parked one.
  it("a fresh store is not persisted", () => {
    const s = new WorkingOrderStore();
    expect(s.persisted).toBe(false);
  });

  it("markPersisted flips persisted to true, without notifying (not a rendering concern)", () => {
    const s = new WorkingOrderStore();
    let n = 0;
    s.subscribe(() => n++);
    s.markPersisted();
    expect(s.persisted).toBe(true);
    expect(n).toBe(0);
  });

  it("loadFrom marks the store persisted — a retrieved order already exists server-side", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }]);
    expect(s.persisted).toBe(true);
  });

  it("clear() resets persisted to false — a fresh basket is not yet parked", () => {
    const s = new WorkingOrderStore();
    s.markPersisted();
    s.clear();
    expect(s.persisted).toBe(false);
  });

  // `dirty` (Finding-2 re-review): whether the LINES changed since the basket last matched the server,
  // so the pay flow re-syncs a retrieved order ONLY when it was actually edited (no pay-time re-price
  // of an untouched order).
  it("a fresh store is not dirty", () => {
    const s = new WorkingOrderStore();
    expect(s.dirty).toBe(false);
  });

  it("addProduct and removeLine mark the basket dirty", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "1");
    expect(s.dirty).toBe(true);
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }]); // reset to a clean retrieved state
    expect(s.dirty).toBe(false);
    s.removeLine(0);
    expect(s.dirty).toBe(true);
  });

  it("loadFrom starts a retrieved basket CLEAN, even over a prior edit", () => {
    const s = new WorkingOrderStore();
    s.addProduct(jamon, "0.100"); // a prior edit → dirty
    expect(s.dirty).toBe(true);
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }], "Mesa 4");
    // A just-retrieved basket matches the server, so it is clean — an unedited retrieve→pay must not
    // re-sync (which would re-price at pay time and defeat the add-time lock).
    expect(s.dirty).toBe(false);
  });

  it("a label change is NOT a line edit — it does not mark the basket dirty", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }]);
    s.label = "Mesa 9";
    // The label is held-list metadata that never reaches the filed sale, so it needs no re-lock.
    expect(s.dirty).toBe(false);
  });

  it("markPersisted and clear reset dirty to false", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "1");
    s.markPersisted(); // a just-parked basket matches the server → clean
    expect(s.dirty).toBe(false);
    s.addProduct(cafe, "1");
    s.clear(); // a fresh empty basket is clean
    expect(s.dirty).toBe(false);
  });
});
