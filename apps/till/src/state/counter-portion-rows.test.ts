import { describe, expect, it } from "vitest";
import type { SaleLine, TabLine, TillProduct } from "../api/client.js";
import type { StoredLines } from "../widgets/basket.js";
import { foldRetrievedPortions, portionWireLines } from "./counter-portion-rows.js";
import type { OrderLine } from "./working-order.js";

const caña: TillProduct = {
  id: "cana",
  name: "Caña",
  menuItemId: "offer-cana",
  unit: {
    staffName: "Staff unit",
    staffAbbreviation: "su",
    id: "unit-each",
    name: { en: "unit", es: "unidad" },
    abbreviation: { en: "ea", es: "ud" },
    precision: 0,
    hardwareUnit: null,
  },
  unitPrice: "2.00",
  vatClass: "general",
  category: null,
  allergens: null,
};

function stored(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: "Caña",
    productId: "cana",
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "2.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: "offer-cana",
    portion: true,
    ...over,
  };
}

const basketLine = (id: string, over: Partial<OrderLine> = {}): OrderLine => ({
  product: caña,
  quantity: "1",
  workingOrderLineId: id,
  ...over,
});

const listing = (lines: TabLine[]): StoredLines => ({ orderId: "o1", revision: 4, lines });

describe("A1208 counter rows: folding a retrieved order's portions", () => {
  it("shows three identical bound portions as one row of three, its members in line order", () => {
    const listed = listing([stored("c3", 3), stored("c1", 1), stored("c2", 2)]);
    const folded = foldRetrievedPortions(
      [basketLine("c3"), basketLine("c1"), basketLine("c2")],
      listed,
      false,
    );
    expect(folded).toEqual([
      basketLine("c1", { quantity: "3", portionLineIds: ["c1", "c2", "c3"] }),
    ]);
  });

  it.each<[string, Partial<TabLine>]>([
    ["another note", { note: "no foam" }],
    ["another kitchen state", { state: "ready", firedAt: "2026-10-29T12:00:00.000Z" }],
    ["another price", { unitPriceGross: "2.50" }],
  ])("keeps a portion with %s as a row of its own", (_, over) => {
    const listed = listing([stored("c1", 1), stored("c2", 2), stored("c3", 3, over)]);
    const lines = [basketLine("c1"), basketLine("c2"), basketLine("c3")];
    expect(foldRetrievedPortions(lines, listed, false)).toEqual([
      basketLine("c1", { quantity: "2", portionLineIds: ["c1", "c2"] }),
      basketLine("c3"),
    ]);
  });

  it("keeps a portion carrying an extra the others lack as a row of its own", () => {
    const cheese = stored("x2", 102, {
      name: "Cheese",
      productId: "cheese",
      parentLineNo: 2,
      listId: "toppings",
      stationId: null,
      menuItemId: null,
    });
    const listed = listing([stored("c1", 1), stored("c2", 2), cheese, stored("c3", 3)]);
    const withCheese = basketLine("c2", {
      extras: [
        { listId: "toppings", productId: "cheese", name: "Cheese", price: "1.00", quantity: 1 },
      ],
    });
    expect(
      foldRetrievedPortions([basketLine("c1"), withCheese, basketLine("c3")], listed, false),
    ).toEqual([basketLine("c1", { quantity: "2", portionLineIds: ["c1", "c3"] }), withCheese]);
  });

  it("leaves a line no portion is bound to, and a line the listing does not name, alone", () => {
    const listed = listing([
      stored("c1", 1, { portion: false }),
      stored("c2", 2, { portion: false }),
    ]);
    const lines = [basketLine("c1"), basketLine("c2"), basketLine("gone")];
    expect(foldRetrievedPortions(lines, listed, false)).toEqual(lines);
  });

  it("keeps a portion the basket makes at another station as a row of its own", () => {
    const listed = listing([stored("c1", 1), stored("c2", 2), stored("c3", 3)]);
    const terrace = basketLine("c3", { makeAt: "terrace" });
    expect(
      foldRetrievedPortions([basketLine("c1"), basketLine("c2"), terrace], listed, false),
    ).toEqual([basketLine("c1", { quantity: "2", portionLineIds: ["c1", "c2"] }), terrace]);
  });

  it("keeps a line with no stored id apart from the row its neighbours fold into", () => {
    const listed = listing([stored("c1", 1), stored("c2", 2)]);
    const unsaved: OrderLine = { product: caña, quantity: "1" };
    expect(
      foldRetrievedPortions([basketLine("c1"), unsaved, basketLine("c2")], listed, false),
    ).toEqual([basketLine("c1", { quantity: "2", portionLineIds: ["c1", "c2"] }), unsaved]);
  });

  it("returns the lines as given when the listing is unknown or the order holds money", () => {
    const listed = listing([stored("c1", 1), stored("c2", 2)]);
    const lines = [basketLine("c1"), basketLine("c2")];
    expect(foldRetrievedPortions(lines, null, false)).toEqual(lines);
    expect(foldRetrievedPortions(lines, listed, true)).toEqual(lines);
  });
});

describe("A1208 counter rows: the wire lines a row is saved as", () => {
  const wire: SaleLine = {
    menuItemId: "offer-cana",
    workingOrderLineId: "c1",
    quantity: "3",
    makeAt: "bar-2",
    note: "cold glass",
    extras: [{ listId: "toppings", picks: [{ productId: "lemon", quantity: 1 }] }],
    options: [{ listId: "size", labelId: "large" }],
  };
  const row = (quantity: string) =>
    basketLine("c1", { quantity, portionLineIds: ["c1", "c2", "c3"] });
  const sent = (lines: SaleLine[]) => lines.map((line) => [line.workingOrderLineId, line.quantity]);

  it("sends a line of one unchanged", () => {
    expect(portionWireLines(basketLine("c1"), wire)).toEqual([wire]);
  });

  it("sends a row of three at three as one line of one per member", () => {
    expect(sent(portionWireLines(row("3"), wire))).toEqual([
      ["c1", "1"],
      ["c2", "1"],
      ["c3", "1"],
    ]);
  });

  it("sends a row of three raised to five with the last member carrying the three added", () => {
    expect(sent(portionWireLines(row("5"), { ...wire, quantity: "5" }))).toEqual([
      ["c1", "1"],
      ["c2", "1"],
      ["c3", "3"],
    ]);
  });

  it("sends a row of three lowered to two as its first two members, leaving the last out", () => {
    expect(sent(portionWireLines(row("2"), { ...wire, quantity: "2" }))).toEqual([
      ["c1", "1"],
      ["c2", "1"],
    ]);
  });

  it("sends a row of three lowered to one as its first member alone", () => {
    expect(sent(portionWireLines(row("1"), { ...wire, quantity: "1" }))).toEqual([["c1", "1"]]);
  });

  it("carries the row's extras, answers, note and making station on every member", () => {
    for (const line of portionWireLines(row("3"), wire))
      expect(line).toEqual({ ...wire, workingOrderLineId: line.workingOrderLineId, quantity: "1" });
  });
});
