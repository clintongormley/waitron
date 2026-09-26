import { describe, expect, it } from "vitest";
import { WorkingOrderStore } from "./working-order.js";
import { lineGross } from "./order-line.js";
import type { OrderLine, SelectedExtra } from "./working-order.js";
import type { TillProduct } from "../api/client.js";

// A v4 uuid, as `crypto.randomUUID()` mints: 8-4-4-4-12 hex, version nibble 4, variant 8..b.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A gross-1.50 espresso at the general rate.
const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  pricingUnit: "each",
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
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
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

  it("rejects an invalid unit quantity before changing basket state", () => {
    const s = new WorkingOrderStore();
    expect(() => s.addProduct(cafe, "0.5")).toThrowError(
      expect.objectContaining({ code: "quantity.invalid", params: { reason: "precision" } }),
    );
    expect(s.lines).toEqual([]);

    s.addProduct(cafe, "1");
    expect(() => s.setLineQuantity(0, "1.5")).toThrowError(
      expect.objectContaining({ code: "quantity.invalid", params: { reason: "precision" } }),
    );
    expect(s.lines[0]!.quantity).toBe("1");
    expect(s.total).toBe("1.50");
  });

  it("attaches a per-line note carried on the selection", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "1", { note: "no mayo" });
    expect(s.lines[0]).toEqual({ product: cafe, quantity: "1", note: "no mayo" });
  });

  it("omits the note key when the selection is absent or names nothing", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "1");
    s.addProduct(cafe, "1", {});
    expect(s.lines[0]).toEqual({ product: cafe, quantity: "1" });
    expect(s.lines[1]).toEqual({ product: cafe, quantity: "1" });
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

  it("setLineQuantity updates the line's quantity, re-prices the total, marks dirty and notifies", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }]); // clean baseline, total 1.50
    expect(s.total).toBe("1.50");
    expect(s.dirty).toBe(false);
    let n = 0;
    s.subscribe(() => n++);
    s.setLineQuantity(0, "3");
    expect(s.lines[0]?.quantity).toBe("3");
    expect(s.total).toBe("4.50"); // 1.50 × 3
    expect(s.dirty).toBe(true); // a quantity change is a line edit
    expect(n).toBe(1);
  });

  it("setLineQuantity is a true no-op for an out-of-range index — no mutation, no notification", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }]); // clean baseline
    let n = 0;
    s.subscribe(() => n++);
    s.setLineQuantity(-1, "5");
    s.setLineQuantity(3, "5"); // past the end
    expect(s.lines[0]?.quantity).toBe("1");
    expect(s.dirty).toBe(false);
    expect(n).toBe(0);
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

  it("setLineExtras attaches a note to a fast-added line, marks dirty and notifies", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }]); // clean baseline
    expect(s.dirty).toBe(false);
    let n = 0;
    s.subscribe(() => n++);
    s.setLineExtras(0, { note: "no onion" });
    expect(s.lines[0]).toEqual({ product: cafe, quantity: "1", note: "no onion" });
    expect(s.dirty).toBe(true);
    expect(n).toBe(1);
  });

  it("setLineExtras touches only the keys the caller names, leaving an unnamed note alone", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "1", { note: "keep me" });
    // The update is keyed on the PRESENCE of `note`: an absent key means "unchanged".
    s.setLineExtras(0, {});
    expect(s.lines[0]).toEqual({ product: cafe, quantity: "1", note: "keep me" });
  });

  it("setLineExtras trims a whitespace-only note away (omission discipline)", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "1", { note: "old note" });
    s.setLineExtras(0, { note: "   " });
    expect(s.lines[0]).toEqual({ product: cafe, quantity: "1" });
  });

  it("setLineExtras is a true no-op for an out-of-range index — no mutation, no notification", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }]); // clean baseline
    let n = 0;
    s.subscribe(() => n++);
    s.setLineExtras(-1, { note: "x" });
    s.setLineExtras(3, { note: "x" }); // past the end
    expect(s.lines[0]).toEqual({ product: cafe, quantity: "1" });
    expect(s.dirty).toBe(false);
    expect(n).toBe(0);
  });

  it("setLineExtras with the note key present but undefined clears the stored note", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "1", { note: "no sugar" });
    s.setLineExtras(0, { note: undefined });
    expect(s.lines[0]).toEqual({ product: cafe, quantity: "1" });
  });

  it("setLineModifiers replaces the line's whole answer set, marks dirty and notifies", () => {
    const s = new WorkingOrderStore();
    const pick: SelectedExtra = {
      listId: "list-milk",
      productId: "p-oat",
      name: "Leche de avena",
      price: "0.50",
      quantity: 1,
    };
    s.loadFrom("held-1", [{ product: cafe, quantity: "2", extras: [pick], note: "hot" }]);
    let n = 0;
    s.subscribe(() => n++);
    const frozen = {
      listName: { es: "Tamaño" },
      listCustomerName: { es: "Tamaño para el cliente" },
      listKitchenName: "Tamaño cocina",
      labelName: { es: "Grande" },
      labelCustomerName: { es: "Grande para el cliente" },
      labelKitchenName: "Grande cocina",
    };
    s.setLineModifiers(0, {
      options: [{ listId: "list-size", labelId: "label-large" }],
      optionSnapshots: [frozen],
    });
    // The picks the new selection does not name are gone; the note is not an answer, so it stays.
    expect(s.lines[0]).toEqual({
      product: cafe,
      quantity: "2",
      note: "hot",
      options: [{ listId: "list-size", labelId: "label-large" }],
      optionSnapshots: [frozen],
    });
    expect(s.total).toBe("3.00");
    expect(s.dirty).toBe(true);
    expect(n).toBe(1);
  });

  it("setLineModifiers is a true no-op for an out-of-range index — no mutation, no notification", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }]);
    let n = 0;
    s.subscribe(() => n++);
    s.setLineModifiers(-1, { options: [{ listId: "l", labelId: "x" }] });
    s.setLineModifiers(3, { options: [{ listId: "l", labelId: "x" }] });
    expect(s.lines[0]).toEqual({ product: cafe, quantity: "1" });
    expect(s.dirty).toBe(false);
    expect(n).toBe(0);
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
    expect(a.lines).toHaveLength(1);
    expect(b.lines).toHaveLength(0);
  });

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
    // Read total BEFORE loadFrom so the cache is populated; otherwise the re-price assertion below
    // could not see a missing invalidation.
    expect(s.total).toBe("1.00");
    const lines: OrderLine[] = [
      { product: cafe, quantity: "2" }, // 1.50 × 2 = 3.00 (general)
      { product: jamon, quantity: "0.320" }, // 10.00 × 0.320 = 3.20 (reduced)
    ];
    s.loadFrom("held-123", lines, "Mesa 4");
    expect(s.id).toBe("held-123");
    expect(s.label).toBe("Mesa 4");
    expect(s.lines).toEqual(lines);
    expect(s.total).toBe("6.20");
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
    expect(s.dirty).toBe(false);
  });

  it("a label change is NOT a line edit — it does not mark the basket dirty", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("held-1", [{ product: cafe, quantity: "1" }]);
    s.label = "Mesa 9";
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

  describe("extras picked on a basket line", () => {
    // A +0.50 gross pick.
    const oatMilk: SelectedExtra = {
      listId: "list-milk",
      productId: "p-oat",
      name: "Leche de avena",
      price: "0.50",
      quantity: 1,
    };

    it("addProduct stores the picks on the line and totals them into the running line price", () => {
      const s = new WorkingOrderStore();
      const cortado: TillProduct = { ...cafe, id: "cortado", unitPrice: "2.50" };
      s.addProduct(cortado, "1", { extras: [oatMilk] });
      expect(s.lines).toHaveLength(1);
      expect(s.lines[0]?.extras).toEqual([oatMilk]);
      // dish 2.50 + pick 0.50 → 3.00.
      expect(lineGross(s.lines[0]!)).toBe("3.00");
      expect(s.dirty).toBe(true); // an add is a line edit
    });

    it("multiplies the dish gross and every pick by the line quantity", () => {
      const s = new WorkingOrderStore();
      s.addProduct(cafe, "2", { extras: [oatMilk] }); // (1.50 + 0.50) × 2 = 4.00
      expect(lineGross(s.lines[0]!)).toBe("4.00");
    });

    it("the grand total includes the picks — a +0.50 pick lifts it by 0.50", () => {
      const withOption = new WorkingOrderStore();
      withOption.addProduct(cafe, "1", { extras: [oatMilk] }); // dish 1.50 + pick 0.50
      const without = new WorkingOrderStore();
      without.addProduct(cafe, "1"); // dish 1.50 only
      expect(without.total).toBe("1.50");
      // priceBasket sees only the dishes, so a total taken from it alone would stay 1.50.
      expect(withOption.total).toBe("2.00");
    });

    it("the extras-aware total multiplies each pick by the line quantity", () => {
      const s = new WorkingOrderStore();
      s.addProduct(cafe, "2", { extras: [oatMilk] }); // (1.50 + 0.50) × 2 = 4.00
      expect(s.total).toBe("4.00");
    });

    it("with no picks the line is unchanged — no extras key, price identical to before", () => {
      const s = new WorkingOrderStore();
      s.addProduct(cafe, "2");
      // The strict toEqual pins that a no-pick add carries NO extras key.
      expect(s.lines[0]).toEqual({ product: cafe, quantity: "2" });
      expect(s.lines[0]?.extras).toBeUndefined();
      expect(lineGross(s.lines[0]!)).toBe("3.00"); // 1.50 × 2
    });
  });

  // An unedited retrieved order is paid from its stored lines, which still bill these picks. An edit
  // sends the lines without them, so the server takes them off the order.
  describe("retrieved picks no list offers any more", () => {
    const milk = { productId: "p-milk", name: "Leche", price: "0.75", quantity: 2 };
    function loaded(): WorkingOrderStore {
      const s = new WorkingOrderStore();
      s.loadFrom("held-1", [
        { product: cafe, quantity: "2", notOfferedExtras: [milk] },
        { product: cafe, quantity: "1" },
      ]);
      return s;
    }

    it("counts them in the total while the basket is unedited", () => {
      // 2 × 1.50, plus 2 × 2 × 0.75, plus 1.50.
      expect(loaded().total).toBe("7.50");
    });

    it.each([
      ["addProduct", (s: WorkingOrderStore) => s.addProduct(cafe, "1")],
      ["setLineQuantity", (s: WorkingOrderStore) => s.setLineQuantity(1, "2")],
      ["setLineModifiers", (s: WorkingOrderStore) => s.setLineModifiers(1, {})],
      ["setLineExtras", (s: WorkingOrderStore) => s.setLineExtras(1, { note: "sin azúcar" })],
      ["removeLine", (s: WorkingOrderStore) => s.removeLine(1)],
    ])("%s on another line drops them, and the total with them", (_, edit) => {
      const s = loaded();
      expect(s.total).toBe("7.50");
      edit(s);
      expect(s.lines[0]).not.toHaveProperty("notOfferedExtras");
      expect(lineGross(s.lines[0]!)).toBe("3.00");
    });

    it("a label change keeps them, because it is not an edit", () => {
      const s = loaded();
      s.label = "Mesa 9";
      expect(s.lines[0]!.notOfferedExtras).toEqual([milk]);
      expect(s.total).toBe("7.50");
    });
  });
});
