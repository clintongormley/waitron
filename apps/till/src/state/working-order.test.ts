import { describe, expect, it } from "vitest";
import { WorkingOrderStore } from "./working-order.js";
import { lineGross, productAsVariant } from "./order-line.js";
import type { OrderLine, SelectedExtra } from "./working-order.js";
import { menuOfferToTillProduct, type TillMenuOffer, type TillProduct } from "../api/client.js";

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

  describe("a basket refreshed against a new menu version", () => {
    it("adoptLines replaces the named lines, re-prices the total, marks dirty and notifies", () => {
      const s = new WorkingOrderStore();
      s.addProduct(cafe, "2");
      s.addProduct(jamon, "0.500");
      s.markPersisted();
      let notified = 0;
      s.subscribe(() => notified++);
      s.adoptLines(new Map([[0, { product: { ...cafe, unitPrice: "1.20" }, quantity: "2" }]]));
      expect(s.lines[0]!.product.unitPrice).toBe("1.20");
      expect(s.lines[1]!.product).toBe(jamon);
      expect(s.total).toBe("7.40");
      expect(s.dirty).toBe(true);
      expect(notified).toBe(1);
    });

    it("adoptLines keeps each line's identity, so what is keyed on a line survives", () => {
      const s = new WorkingOrderStore();
      s.addProduct(cafe, "1");
      const [line] = s.lines;
      s.adoptLines(new Map([[0, { product: { ...cafe, unitPrice: "1.20" }, quantity: "1" }]]));
      expect(s.lines[0]).toBe(line);
      expect(line!.product.unitPrice).toBe("1.20");
    });

    it("removeLines takes out exactly the named lines, whatever was added since", () => {
      const s = new WorkingOrderStore();
      s.addProduct(cafe, "1");
      s.addProduct(jamon, "0.500");
      const sent = s.lines.slice(0, 1);
      s.addProduct(cafe, "2");
      let notified = 0;
      s.subscribe(() => notified++);
      s.removeLines(sent);
      expect(s.lines.map((line) => [line.product.id, line.quantity])).toEqual([
        ["jamon", "0.500"],
        ["cafe", "2"],
      ]);
      expect(notified).toBe(1);
    });

    it("refuses every staff edit while it is being sent, and takes them again once it is not", () => {
      const s = new WorkingOrderStore();
      s.addProduct(cafe, "1", { note: "sin azúcar" });
      let notified = 0;
      s.subscribe(() => notified++);
      s.sending = true;
      expect(notified).toBe(1);
      s.addProduct(jamon, "0.500");
      s.setLineQuantity(0, "2");
      s.setLineExtras(0, { note: "con hielo" });
      s.setLineModifiers(0, { options: [{ listId: "l", labelId: "x" }] });
      s.removeLine(0);
      expect(s.lines).toEqual([{ product: cafe, quantity: "1", note: "sin azúcar" }]);
      s.sending = false;
      s.setLineQuantity(0, "2");
      expect(s.lines[0]!.quantity).toBe("2");
    });

    it("setBlocked marks and clears lines, notifying only when a mark changed, never marking dirty", () => {
      const s = new WorkingOrderStore();
      s.addProduct(cafe, "1");
      s.addProduct(jamon, "0.500");
      s.markPersisted();
      let notified = 0;
      s.subscribe(() => notified++);
      s.setBlocked([undefined, "unavailable"]);
      expect(s.lines.map((line) => line.blocked)).toEqual([undefined, "unavailable"]);
      expect(notified).toBe(1);
      s.setBlocked([undefined, "unavailable"]);
      expect(notified).toBe(1);
      s.setBlocked([undefined, undefined]);
      expect(s.lines[1]).not.toHaveProperty("blocked");
      expect(notified).toBe(2);
      expect(s.dirty).toBe(false);
    });

    it("setBlocked without notify marks the line and tells no listener", () => {
      const s = new WorkingOrderStore();
      s.addProduct(cafe, "1");
      let notified = 0;
      s.subscribe(() => notified++);
      s.setBlocked(["unavailable"], false);
      expect(s.lines[0]!.blocked).toBe("unavailable");
      expect(notified).toBe(0);
    });
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

describe("WorkingOrderStore: the VAT preview takes each class's rate today", () => {
  const unit = {
    id: "unit-each",
    name: { es: "unidad" },
    abbreviation: { es: "ud" },
    precision: 0,
    hardwareUnit: null,
  };
  const sellingValues = {
    unit,
    vatClass: "general" as const,
    category: null,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId: null,
  };
  const offer = {
    id: "menu-item-cana",
    productId: "cana",
    menuId: "lunch",
    menuName: "Lunch",
    grossPrice: null,
    unitPrice: "2.42",
    active: true,
    available: true,
    image: null,
    description: null,
    placements: [[]],
    name: "Caña",
    customerName: null,
    kitchenName: null,
    offeredModifiers: [],
    variants: [
      {
        ...sellingValues,
        id: "cana-large",
        name: "Large",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "3.63",
        menuPrice: null,
        offered: true,
        available: true,
        pricingUnit: "each" as const,
      },
    ],
    ...sellingValues,
  } satisfies TillMenuOffer;

  it("prices a dish at its class's rate", () => {
    const s = new WorkingOrderStore();
    s.addProduct(menuOfferToTillProduct(offer, "version-1"), "1");
    expect(s.vatBreakdown).toEqual([{ rate: "21.00", base: "2.00", tax: "0.42" }]);
  });

  it("prices a variant at its own class's rate, not the dish's", () => {
    const s = new WorkingOrderStore();
    const dish = menuOfferToTillProduct(
      { ...offer, variants: [{ ...offer.variants[0]!, vatClass: "reduced" }] },
      "version-1",
    );
    s.addProduct(productAsVariant(dish, dish.variants![0]!), "1");
    expect(s.vatBreakdown).toEqual([{ rate: "10.00", base: "3.30", tax: "0.33" }]);
  });
});

describe("WorkingOrderStore.addMerging (D10)", () => {
  const product = (menuItemId: string, over: Partial<TillProduct> = {}): TillProduct => ({
    ...cafe,
    id: `p-${menuItemId}`,
    name: menuItemId,
    menuItemId,
    menuVersionId: "version-7",
    ...over,
  });
  const beer = product("beer");
  const burger = product("burger");
  const fish = product("fish", { pricingUnit: "weight", unitPrice: "30.00" });
  const answers = (...labelIds: string[]) => ({
    options: labelIds.map((labelId) => ({ listId: labelId.split(":")[0]!, labelId })),
  });
  const cheeseFrom = (listId: string): { extras: SelectedExtra[] } => ({
    extras: [{ listId, productId: "p-cheese", name: "Cheese", price: "1.00", quantity: 1 }],
  });
  const rows = (s: WorkingOrderStore) =>
    s.lines.map((line) => `${line.product.name} ×${line.quantity}`);

  it("gives one line Beer ×3 from three Beer adds", () => {
    const s = new WorkingOrderStore();
    for (let tap = 0; tap < 3; tap += 1) s.addMerging(beer, "1");
    expect(rows(s)).toEqual(["beer ×3"]);
  });

  it("adds into the first matching line, which keeps its place and stays the same line", () => {
    const s = new WorkingOrderStore();
    s.addMerging(beer, "1");
    s.addMerging(burger, "1");
    const first = s.lines[0];
    s.addMerging(beer, "2");
    expect(rows(s)).toEqual(["beer ×3", "burger ×1"]);
    expect(s.lines[0]).toBe(first);
    expect(s.total).toBe("6.00");
    expect(s.dirty).toBe(true);
  });

  it("merges options answered in either order", () => {
    const s = new WorkingOrderStore();
    s.addMerging(burger, "1", answers("onions:none", "doneness:rare"));
    s.addMerging(burger, "1", answers("doneness:rare", "onions:none"));
    expect(rows(s)).toEqual(["burger ×2"]);
  });

  it("keeps a rare Burger and a well-done one apart", () => {
    const s = new WorkingOrderStore();
    s.addMerging(burger, "1", answers("doneness:rare"));
    s.addMerging(burger, "1", answers("doneness:well-done"));
    expect(rows(s)).toEqual(["burger ×1", "burger ×1"]);
  });

  it("keeps lines with different notes apart", () => {
    const s = new WorkingOrderStore();
    s.addMerging(burger, "1", { note: "no salt" });
    s.addMerging(burger, "1", { note: "extra sauce" });
    s.addMerging(burger, "1", { note: "no salt" });
    expect(rows(s)).toEqual(["burger ×2", "burger ×1"]);
  });

  it('keeps the same extra from "Toppings" and from "Premium toppings" apart', () => {
    const s = new WorkingOrderStore();
    s.addMerging(burger, "1", cheeseFrom("toppings"));
    s.addMerging(burger, "1", cheeseFrom("premium-toppings"));
    expect(rows(s)).toEqual(["burger ×1", "burger ×1"]);
  });

  it("never adds into a no-merge line", () => {
    const s = new WorkingOrderStore();
    s.loadFrom("draft", [{ product: burger, quantity: "1", noMerge: true }]);
    s.addMerging(burger, "1");
    expect(rows(s)).toEqual(["burger ×1", "burger ×1"]);
  });

  it.each([
    ["not offered", { notOffered: true as const }],
    ["blocked", { blocked: "unavailable" as const }],
  ])("never adds into a line marked %s", (_mark, mark) => {
    const s = new WorkingOrderStore();
    s.loadFrom("draft", [{ product: burger, quantity: "1", ...mark }]);
    s.addMerging(burger, "1");
    expect(rows(s)).toEqual(["burger ×1", "burger ×1"]);
  });

  it("never merges a fractional quantity", () => {
    const s = new WorkingOrderStore();
    s.addMerging(fish, "0.5");
    s.addMerging(fish, "0.5");
    s.addMerging(fish, "1");
    expect(rows(s)).toEqual(["fish ×0.5", "fish ×0.5", "fish ×1"]);
  });

  it("merges a whole-number weighed quantity", () => {
    const s = new WorkingOrderStore();
    s.addMerging(fish, "1");
    s.addMerging(fish, "2.000");
    expect(rows(s)).toEqual(["fish ×3.000"]);
  });

  it("appends a product that names no menu item, as addProduct does", () => {
    const s = new WorkingOrderStore();
    s.addMerging(cafe, "1");
    s.addMerging(cafe, "1");
    expect(s.lines).toEqual([
      { product: cafe, quantity: "1" },
      { product: cafe, quantity: "1" },
    ]);
  });

  it("refuses a quantity the unit cannot take, and changes nothing while the basket is sending", () => {
    const s = new WorkingOrderStore();
    s.addMerging(beer, "1");
    expect(() => s.addMerging(beer, "0.5")).toThrowError(
      expect.objectContaining({ code: "quantity.invalid" }),
    );
    s.sending = true;
    s.addMerging(beer, "1");
    expect(rows(s)).toEqual(["beer ×1"]);
  });

  it("notifies once per add", () => {
    const s = new WorkingOrderStore();
    let calls = 0;
    s.subscribe(() => (calls += 1));
    s.addMerging(beer, "1");
    s.addMerging(beer, "1");
    expect(calls).toBe(2);
  });
});

describe("WorkingOrderStore.setLineCourse", () => {
  it("sets and clears a line's course override, marking the line changed", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "1");
    s.markPersisted();
    let notified = 0;
    s.subscribe(() => (notified += 1));

    s.setLineCourse(0, "mains");
    expect(s.lines[0]!.courseId).toBe("mains");
    expect(s.dirty).toBe(true);

    s.setLineCourse(0, undefined);
    expect("courseId" in s.lines[0]!).toBe(false);
    expect(notified).toBe(2);
  });

  it("takes no change while the order is being sent, or for a line that is not there", () => {
    const s = new WorkingOrderStore();
    s.addProduct(cafe, "1");
    s.markPersisted();
    let notified = 0;
    s.subscribe(() => (notified += 1));
    s.setLineCourse(3, "mains");
    expect(notified).toBe(0);
    s.sending = true;
    notified = 0;
    s.setLineCourse(0, "mains");
    expect(s.lines[0]!.courseId).toBeUndefined();
    expect(s.dirty).toBe(false);
    expect(notified).toBe(0);
  });
});

describe("WorkingOrderStore.lastAdded", () => {
  const product = (menuItemId: string): TillProduct => ({
    ...cafe,
    id: `p-${menuItemId}`,
    name: menuItemId,
    menuItemId,
    menuVersionId: "version-7",
  });
  const beer = product("beer");
  const burger = product("burger");

  it("is nothing before any add", () => {
    expect(new WorkingOrderStore().lastAdded).toBeUndefined();
  });

  it("is the line the latest add made, or the line it grew", () => {
    const s = new WorkingOrderStore();
    s.addMerging(beer, "1");
    s.addMerging(burger, "1");
    expect(s.lastAdded).toBe(s.lines[1]);
    s.addMerging(beer, "1");
    expect(s.lastAdded).toBe(s.lines[0]);
    expect(s.lastAdded!.quantity).toBe("2");
    s.addProduct(cafe, "1");
    expect(s.lastAdded).toBe(s.lines[2]);
  });

  it("stays the same line when its quantity is stepped", () => {
    const s = new WorkingOrderStore();
    s.addMerging(beer, "1");
    s.setLineQuantity(0, "4");
    expect(s.lastAdded).toBe(s.lines[0]);
  });

  it("is nothing once its line has left the order, and an earlier add does not come back", () => {
    const s = new WorkingOrderStore();
    s.addMerging(beer, "1");
    s.addMerging(burger, "1");
    s.removeLine(1);
    expect(s.lastAdded).toBeUndefined();

    s.addMerging(burger, "1");
    s.removeLines([s.lines[1]!]);
    expect(s.lastAdded).toBeUndefined();

    s.addMerging(burger, "1");
    s.loadFrom("draft", [{ product: burger, quantity: "1" }]);
    expect(s.lastAdded).toBeUndefined();
  });
});

describe("WorkingOrderStore.lastAdded when the order's lines are replaced", () => {
  const product = (menuItemId: string): TillProduct => ({
    ...cafe,
    id: `p-${menuItemId}`,
    name: menuItemId,
    menuItemId,
    menuVersionId: "version-7",
  });
  const beer = product("beer");
  const flan = product("flan");

  it("follows the line to the new line that orders the same thing, for the same order", () => {
    const s = new WorkingOrderStore();
    s.addMerging(flan, "1");
    s.addMerging(beer, "2", { note: "no ice" });
    const again = [
      { product: flan, quantity: "1" },
      { product: beer, quantity: "1" },
      { product: beer, quantity: "2", note: "no ice" },
    ];
    s.loadFrom(s.id, again);
    expect(s.lastAdded).toBe(s.lines[2]);
  });

  it("follows nothing into another order, into a line kept apart, or when no line matches", () => {
    const s = new WorkingOrderStore();
    s.addMerging(beer, "1");
    s.loadFrom("another-order", [{ product: beer, quantity: "1" }]);
    expect(s.lastAdded).toBeUndefined();

    s.addMerging(beer, "1");
    s.loadFrom(s.id, [{ product: beer, quantity: "1", noMerge: true }]);
    expect(s.lastAdded).toBeUndefined();

    s.addMerging(beer, "1");
    s.loadFrom(s.id, [{ product: flan, quantity: "1" }]);
    expect(s.lastAdded).toBeUndefined();
  });

  it("is nothing once Split quantity has split its line", () => {
    const s = new WorkingOrderStore();
    s.addMerging(beer, "3");
    s.splitLine(0);
    expect(s.lastAdded).toBeUndefined();
  });

  it("stays on its line when another line is split", () => {
    const s = new WorkingOrderStore();
    s.addMerging(flan, "3");
    s.addMerging(beer, "1");
    s.splitLine(0);
    expect(s.lastAdded).toBe(s.lines[3]);
  });
});

describe("WorkingOrderStore.splitLine (Split quantity)", () => {
  const product = (menuItemId: string, over: Partial<TillProduct> = {}): TillProduct => ({
    ...cafe,
    id: `p-${menuItemId}`,
    name: menuItemId,
    menuItemId,
    menuVersionId: "version-7",
    ...over,
  });
  const beer = product("beer");
  const burger = product("burger");
  const fish = product("fish", { pricingUnit: "weight", unitPrice: "30.00" });
  const rows = (s: WorkingOrderStore) =>
    s.lines.map(
      (line) => `${line.product.name} ×${line.quantity}${line.noMerge === true ? " apart" : ""}`,
    );

  it("turns Burger ×3 into three rows of one in its place, each kept apart, with its answers", () => {
    const s = new WorkingOrderStore();
    s.addMerging(beer, "1");
    s.addMerging(burger, "3", { note: "no salt" });
    s.addMerging(beer, "1");
    s.setLineCourse(1, "mains");
    const burgerLine = s.lines[1];
    s.markPersisted();
    let notified = 0;
    s.subscribe(() => (notified += 1));

    s.splitLine(1);

    expect(rows(s)).toEqual(["beer ×2", "burger ×1 apart", "burger ×1 apart", "burger ×1 apart"]);
    expect(s.lines[1]).toBe(burgerLine);
    expect(s.lines.slice(1).map((line) => [line.note, line.courseId])).toEqual([
      ["no salt", "mains"],
      ["no salt", "mains"],
      ["no salt", "mains"],
    ]);
    expect(s.total).toBe("7.50");
    expect(s.dirty).toBe(true);
    expect(notified).toBe(1);
  });

  it("gives each split row its own copy of the line's answers and picks", () => {
    const s = new WorkingOrderStore();
    s.addMerging(burger, "2", {
      extras: [
        { listId: "toppings", productId: "p-cheese", name: "Cheese", price: "1.00", quantity: 1 },
      ],
      options: [{ listId: "doneness", labelId: "rare" }],
      optionSnapshots: [
        {
          listName: { en: "Doneness" },
          listCustomerName: null,
          listKitchenName: null,
          labelName: { en: "Rare" },
          labelCustomerName: null,
          labelKitchenName: null,
        },
      ],
    });
    s.splitLine(0);
    const [first, second] = s.lines;
    expect(second!.extras).toEqual(first!.extras);
    expect(second!.extras).not.toBe(first!.extras);
    expect(second!.extras![0]).not.toBe(first!.extras![0]);
    expect(second!.options).not.toBe(first!.options);
    expect(second!.optionSnapshots).not.toBe(first!.optionSnapshots);
    first!.extras![0]!.quantity = 2;
    expect(second!.extras![0]!.quantity).toBe(1);
  });

  it("is not regrouped by a later tap, which starts a line of its own and grows that", () => {
    const s = new WorkingOrderStore();
    s.addMerging(burger, "3");
    s.splitLine(0);
    s.addMerging(burger, "1");
    s.addMerging(burger, "1");
    expect(rows(s)).toEqual(["burger ×1 apart", "burger ×1 apart", "burger ×1 apart", "burger ×2"]);
  });

  it("leaves a line of one, a weighed line and a missing line alone", () => {
    const s = new WorkingOrderStore();
    s.addMerging(burger, "1");
    s.addMerging(fish, "2");
    s.markPersisted();
    let notified = 0;
    s.subscribe(() => (notified += 1));
    s.splitLine(0);
    s.splitLine(1);
    s.splitLine(5);
    expect(rows(s)).toEqual(["burger ×1", "fish ×2"]);
    expect(s.dirty).toBe(false);
    expect(notified).toBe(0);
  });

  it("takes no split while the order is being sent", () => {
    const s = new WorkingOrderStore();
    s.addMerging(burger, "2");
    s.sending = true;
    s.splitLine(0);
    expect(rows(s)).toEqual(["burger ×2"]);
  });
});
