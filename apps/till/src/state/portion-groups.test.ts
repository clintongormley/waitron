import { describe, expect, it } from "vitest";
import type { CurrentOrderRow, TabLine } from "../api/client.js";
import type { SentSlice } from "./sent-panel.js";
import { portionGroups, sentSlicePortionKey, tabLinePortionKey } from "./portion-groups.js";

function line(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "grill",
    changesAfterSending: null,
    movable: true,
    name: "Burger",
    productId: "burger",
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "9.50",
    servedAt: null,
    courseId: "mains",
    sentAt: "2026-10-28T12:00:00.000Z",
    firedAt: "2026-10-28T12:00:00.000Z",
    state: "queued",
    groupId: "g1",
    note: null,
    listId: null,
    menuItemId: "offer-burger",
    ...over,
  };
}
const cheese = (id: string, parentLineNo: number, over: Partial<TabLine> = {}) =>
  line(id, parentLineNo + 100, {
    name: "Cheese",
    productId: "cheese",
    parentLineNo,
    unitPriceGross: "1.00",
    listId: "toppings",
    stationId: null,
    state: null,
    ...over,
  });
const keyOf = (lines: TabLine[]) => (dish: TabLine) => tabLinePortionKey(dish, lines);
const ids = (groups: TabLine[][]) => groups.map((group) => group.map((member) => member.id));

describe("A803 portion grouping: bill lines", () => {
  it("puts identical whole portions in one group at the first one's place, members by line number", () => {
    const lines = [
      line("b3", 3),
      line("water", 2, { name: "Water", productId: "water", unitPriceGross: "2.00" }),
      line("b1", 1),
    ];
    expect(ids(portionGroups(lines, keyOf(lines), (dish) => dish.lineNo))).toEqual([
      ["b1", "b3"],
      ["water"],
    ]);
  });

  it.each<[string, Partial<TabLine>]>([
    ["product", { productId: "burger-2" }],
    ["variant's parent", { parentProductId: "burger-family" }],
    ["offer", { menuItemId: "offer-burger-2" }],
    ["name", { name: "Burger deluxe" }],
    [
      "answers",
      {
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
      },
    ],
    ["note", { note: "no onion" }],
    ["course", { courseId: "starters" }],
    ["release group", { groupId: "g2" }],
    ["station", { stationId: "kitchen" }],
    ["kitchen state", { state: "ready" }],
    ["fired time", { firedAt: "2026-10-28T12:05:00.000Z" }],
    ["served", { servedAt: "2026-10-28T12:20:00.000Z" }],
    ["cancelled with its charge kept", { cancelledQuantity: "1.000" }],
    ["unit price", { unitPriceGross: "9.00" }],
    ["list price", { listUnitPriceGross: "10.00" }],
    ["movable", { movable: false }],
  ])("keeps two portions apart when their %s differs", (_field, over) => {
    const lines = [line("b1", 1), line("b2", 2, over)];
    expect(ids(portionGroups(lines, keyOf(lines), (dish) => dish.lineNo))).toEqual([
      ["b1"],
      ["b2"],
    ]);
  });

  it("keeps two portions apart when what the caller shows of them differs", () => {
    const lines = [line("b1", 1), line("b2", 2)];
    const shown = (dish: TabLine) =>
      tabLinePortionKey(dish, lines, dish.id === "b2" ? "Ana" : null);
    expect(ids(portionGroups(lines, shown, (dish) => dish.lineNo))).toEqual([["b1"], ["b2"]]);
  });

  it("groups dishes only when their extras are the same, in any order, with the same counts", () => {
    const bacon = (id: string, parent: number, over: Partial<TabLine> = {}) =>
      cheese(id, parent, { name: "Bacon", productId: "bacon", ...over });
    const lines = [
      line("b1", 1),
      cheese("b1-cheese", 1),
      bacon("b1-bacon", 1),
      line("b2", 2),
      bacon("b2-bacon", 2),
      cheese("b2-cheese", 2),
      line("b3", 3),
      cheese("b3-cheese", 3, { quantity: "2.000" }),
      bacon("b3-bacon", 3),
      line("b4", 4),
      cheese("b4-cheese", 4),
      line("b5", 5),
      cheese("b5-cheese", 5, { unitPriceGross: "0.00", listUnitPriceGross: "1.00" }),
      bacon("b5-bacon", 5),
      line("b6", 6),
      cheese("b6-cheese", 6, { listId: "sides" }),
      bacon("b6-bacon", 6),
      line("b7", 7),
      cheese("b7-cheese", 7, { priceQuantity: "2.000" }),
      bacon("b7-bacon", 7),
    ];
    const dishes = lines.filter((dish) => dish.parentLineNo === null);
    expect(ids(portionGroups(dishes, keyOf(lines), (dish) => dish.lineNo))).toEqual([
      ["b1", "b2"],
      ["b3"],
      ["b4"],
      ["b5"],
      ["b6"],
      ["b7"],
    ]);
  });

  it.each<[string, Partial<TabLine>]>([
    ["more than one", { quantity: "2.000" }],
    ["a part", { quantity: "0.500" }],
    ["weighed", { unitPrecision: 3 }],
    ["of an unknown unit", { unitPrecision: undefined }],
    ["priced per more than one unit", { priceQuantity: "100.000" }],
  ])("never groups a line %s", (_case, over) => {
    const lines = [line("b1", 1, over), line("b2", 2, over)];
    expect(tabLinePortionKey(lines[0]!, lines)).toBeNull();
    expect(ids(portionGroups(lines, keyOf(lines), (dish) => dish.lineNo))).toEqual([
      ["b1"],
      ["b2"],
    ]);
  });

  it("never groups an extra on its own", () => {
    const lines = [line("b1", 1), cheese("c1", 1)];
    expect(tabLinePortionKey(lines[1]!, lines)).toBeNull();
  });
});

describe("A803 portion grouping: Sent panel rows", () => {
  function row(id: string, lineNo: number, over: Partial<CurrentOrderRow> = {}): CurrentOrderRow {
    return {
      billStatus: "open",
      netAmount: "9.50",
      readyAt: null,
      firedAt: "2026-10-28T12:00:00.000Z",
      lineId: id,
      workingOrderId: "bill-1",
      lineNo,
      courseId: "mains",
      name: "Burger",
      quantity: "1.000",
      unitPrecision: 0,
      servedQuantity: "0.000",
      servedAt: null,
      released: true,
      kitchen: {
        state: "queued",
        firedAt: "2026-10-28T12:00:00.000Z",
        stationId: "grill",
        movable: true,
      },
      note: null,
      extras: [],
      ...over,
    };
  }
  const slice = (of: CurrentOrderRow, over: Partial<Omit<SentSlice, "row">> = {}): SentSlice => ({
    row: of,
    kind: "fired",
    quantity: "1",
    amount: of.netAmount,
    ...over,
  });
  const lines = [line("b1", 1), line("b2", 2)];
  const group = (slices: SentSlice[], known = lines) =>
    portionGroups(
      slices,
      (entry) => sentSlicePortionKey(entry, known),
      (entry) => entry.row.lineNo,
    ).map((members) => members.map((entry) => entry.row.lineId));

  it("groups two identical sent portions", () => {
    expect(group([slice(row("b2", 2)), slice(row("b1", 1))])).toEqual([["b1", "b2"]]);
  });

  it.each<[string, Partial<CurrentOrderRow>, Partial<Omit<SentSlice, "row">>]>([
    ["kind", {}, { kind: "served" }],
    ["readiness", { readyAt: "2026-10-28T12:10:00.000Z" }, {}],
    ["release", { released: false }, {}],
    ["kitchen record", { kitchen: null }, {}],
    ["amount", { netAmount: "9.00" }, { amount: "9.00" }],
    ["firing", { firedAt: "2026-10-28T12:03:00.000Z" }, {}],
    ["bill", { workingOrderId: "bill-2" }, {}],
  ])("keeps two sent portions apart when their %s differs", (_field, rowOver, sliceOver) => {
    expect(group([slice(row("b1", 1)), slice(row("b2", 2, rowOver), sliceOver)])).toEqual([
      ["b1"],
      ["b2"],
    ]);
  });

  it("never groups a slice of a line of more than one, or a row whose bill line is not known", () => {
    expect(
      sentSlicePortionKey(slice(row("b1", 1, { quantity: "3.000" })), [
        line("b1", 1, { quantity: "3.000" }),
      ]),
    ).toBeNull();
    expect(sentSlicePortionKey(slice(row("b1", 1)), [line("b1", 2)])).toBeNull();
    expect(sentSlicePortionKey(slice(row("b1", 1, { quantity: "3.000" })), lines)).toBeNull();
    expect(
      sentSlicePortionKey(
        slice(row("b1", 1, { servedQuantity: "0.500" }), { quantity: "0.5" }),
        lines,
      ),
    ).toBeNull();
    expect(group([slice(row("b1", 1)), slice(row("b2", 2))], [line("b1", 1)])).toEqual([
      ["b1"],
      ["b2"],
    ]);
  });
});
