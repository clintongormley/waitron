/** Current orders fixtures shared by the table screen's Current orders suites. */
import type {
  CurrentOrderGroup,
  CurrentOrderRow,
  CurrentOrders,
  OrderGroup,
} from "../api/client.js";

export const fired = "2026-09-28T19:50:00.000Z";
/** 20:15, when group 3's reminder falls due. */
export const now = Date.parse("2026-09-28T20:15:00.000Z");

export function row(
  lineId: string,
  name: string,
  quantity: string,
  over: Partial<CurrentOrderRow> = {},
) {
  return {
    lineId,
    workingOrderId: "wo-4",
    lineNo: 1,
    name,
    quantity,
    unitPrecision: 0,
    servedQuantity: "0.000",
    servedAt: null,
    released: true,
    kitchen: { state: "queued", firedAt: fired, awayAt: null },
    note: null,
    extras: [],
    ...over,
  } satisfies CurrentOrderRow;
}

// Group 1: Croquetas ×4 half served, a Salad served, a Beer the pass marked ready, and Bravas the pass
// sent away. Group 2: a Steak needing no preparation, a Fish a station is preparing, and a Pulpo at a
// station that records nothing, on another bill of the party. Group 3 is held, added later, and its
// reminder is due. Group 4 is held. A Coffee sits in no group.
export const croquetas = row("l-croq", "Croquetas", "4.000", { servedQuantity: "2.000" });
export const salad = row("l-salad", "Salad", "1.000", {
  servedQuantity: "1.000",
  servedAt: "2026-09-28T20:05:00.000Z",
});
export const beer = row("l-beer", "Beer", "1.000", {
  kitchen: { state: "ready", firedAt: fired, awayAt: null },
});
export const bravas = row("l-bravas", "Bravas", "1.000", {
  kitchen: { state: "ready", firedAt: fired, awayAt: "2026-09-28T20:10:00.000Z" },
});
export const steak = row("l-steak", "Steak", "1.000", { kitchen: null });
export const fish = row("l-fish", "Fish", "1.000", {
  kitchen: { state: "preparing", firedAt: fired, awayAt: null },
});
export const pulpo = row("l-pulpo", "Pulpo", "1.000", { workingOrderId: "wo-check" });
export const flan = row("l-flan", "Flan", "2.000", {
  released: false,
  kitchen: { state: "queued", firedAt: null, awayAt: null },
  extras: [{ lineId: "l-cream", name: "Cream", quantity: "2.000" }],
});
export const tarta = row("l-tarta", "Tarta", "1.000", {
  released: false,
  kitchen: { state: "queued", firedAt: null, awayAt: null },
});
export const coffee = row("l-coffee", "Coffee", "1.000", { kitchen: null });

export function currentGroup(
  id: string,
  position: number,
  state: "held" | "fired",
  rows: CurrentOrderRow[],
  addedLater = false,
): CurrentOrderGroup {
  return {
    id,
    position,
    state,
    firedAt: state === "fired" ? fired : null,
    remindAt: null,
    addedLater,
    rows,
  };
}

export function orderGroup(id: string, position: number, state: "held" | "fired"): OrderGroup {
  return {
    id,
    position,
    state,
    firedAt: state === "fired" ? fired : null,
    remindAt: null,
    lineIds: [],
    summary: `summary of ${id}`,
  };
}

export const groups = [
  orderGroup("g1", 1, "fired"),
  orderGroup("g2", 2, "fired"),
  orderGroup("g3", 3, "held"),
  orderGroup("g4", 4, "held"),
];

export function current(over: Partial<CurrentOrders> = {}): CurrentOrders {
  return {
    revision: 7,
    reminder: { groupId: "g3", dueAt: "2026-09-28T20:15:00.000Z" },
    groups: [
      currentGroup("g1", 1, "fired", [croquetas, salad, beer, bravas]),
      currentGroup("g2", 2, "fired", [steak, fish, pulpo]),
      currentGroup("g3", 3, "held", [flan], true),
      currentGroup("g4", 4, "held", [tarta]),
    ],
    ungrouped: [coffee],
    ...over,
  };
}
