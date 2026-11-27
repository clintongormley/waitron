import { describe, expect, it } from "vitest";
import type { TillProduct } from "../api/menu-api.js";
import { WorkingOrderStore, type OrderLine } from "../state/working-order.js";
import { foldDraftFamily, splitDraftLine } from "./draft-portions.js";

const burger: TillProduct = {
  id: "burger",
  menuItemId: "burger-item",
  name: "Burger",
  unitPrice: "10.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: {},
  offeredModifiers: [
    {
      kind: "extras",
      id: "toppings",
      name: "Toppings",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: 3,
      items: [],
    },
  ],
};

function storeWith(quantity: string): { store: WorkingOrderStore; line: OrderLine } {
  const line: OrderLine = { product: burger, quantity };
  const store = new WorkingOrderStore();
  store.loadFrom("draft", [line]);
  return { store, line };
}

function splitStore(): { store: WorkingOrderStore; family: readonly OrderLine[] } {
  const { store, line } = storeWith("3");
  splitDraftLine(store, line);
  return { store, family: store.splitFamily(line)! };
}

describe("splitDraftLine", () => {
  it("splits a whole count above one into portions of one", () => {
    const { store, line } = storeWith("3");
    splitDraftLine(store, line);
    expect(store.lines.map((member) => member.quantity)).toEqual(["1", "1", "1"]);
  });

  it("leaves the line whole while the order is being sent or its edits are locked", () => {
    const sending = storeWith("3");
    sending.store.sending = true;
    splitDraftLine(sending.store, sending.line);
    expect(sending.store.lines.map((member) => member.quantity)).toEqual(["3"]);

    const locked = storeWith("3");
    locked.store.lockEdits();
    splitDraftLine(locked.store, locked.line);
    expect(locked.store.lines.map((member) => member.quantity)).toEqual(["3"]);
  });

  it("does nothing for a line the store no longer holds, or a count of one", () => {
    const { store } = storeWith("3");
    splitDraftLine(store, { product: burger, quantity: "3" });
    expect(store.lines.map((member) => member.quantity)).toEqual(["3"]);

    const single = storeWith("1");
    splitDraftLine(single.store, single.line);
    expect(single.store.lines).toHaveLength(1);
  });
});

describe("foldDraftFamily", () => {
  it("keeps the folded row selected only when every portion was", () => {
    const all = splitStore();
    const selection = new WeakSet<OrderLine>(all.family);
    expect(foldDraftFamily(all.store, all.family[1]!, selection)).toBe(true);
    expect(all.store.lines.map((member) => member.quantity)).toEqual(["3"]);
    expect(selection.has(all.family[0]!)).toBe(true);
    expect(selection.has(all.family[1]!)).toBe(false);

    const some = splitStore();
    const partial = new WeakSet<OrderLine>([some.family[0]!, some.family[2]!]);
    expect(foldDraftFamily(some.store, some.family[0]!, partial)).toBe(true);
    expect(partial.has(some.family[0]!)).toBe(false);
    expect(partial.has(some.family[2]!)).toBe(false);
  });

  it("changes nothing while the order is being sent or its edits are locked", () => {
    const sending = splitStore();
    sending.store.sending = true;
    expect(foldDraftFamily(sending.store, sending.family[0]!, new WeakSet())).toBe(false);
    expect(sending.store.lines).toHaveLength(3);

    const locked = splitStore();
    locked.store.lockEdits();
    expect(foldDraftFamily(locked.store, locked.family[0]!, new WeakSet())).toBe(false);
    expect(locked.store.lines).toHaveLength(3);
  });

  it("answers false for a line with no split family", () => {
    const { store, line } = storeWith("3");
    const selection = new WeakSet<OrderLine>([line]);
    expect(foldDraftFamily(store, line, selection)).toBe(false);
    expect(selection.has(line)).toBe(true);
  });

  it("leaves the selection alone when the store declines to fold", () => {
    const { store, family } = splitStore();
    store.foldSplitFamily = () => undefined;
    const selection = new WeakSet<OrderLine>([family[1]!]);
    expect(foldDraftFamily(store, family[0]!, selection)).toBe(false);
    expect(selection.has(family[1]!)).toBe(true);
  });
});
