import { describe, expect, it } from "vitest";
import type {
  CurrentOrderGroup,
  CurrentOrderRow,
  CurrentOrders,
  TabLine,
} from "../api/kitchen-api.js";
import { sentRowPortionKey } from "./portion-groups.js";
import { type SentRow, sentSections } from "./sent-sections.js";
import { withRowRequestedAt } from "../../test/kitchen-stamps.js";

const at = (minute: number) => `2026-10-17T12:${String(minute).padStart(2, "0")}:00.000Z`;
function row(id: string, over: Partial<CurrentOrderRow> = {}): CurrentOrderRow {
  return withRowRequestedAt({
    lineId: id,
    workingOrderId: "bill-1",
    billStatus: "open",
    lineNo: 1,
    courseId: null,
    name: id,
    quantity: "1.000",
    netAmount: "3.00",
    unitPrecision: 0,
    servedQuantity: "0.000",
    servedAt: null,
    released: true,
    readyAt: null,
    firedAt: at(0),
    kitchen: null,
    note: null,
    extras: [],
    ...over,
  });
}
function group(
  id: string,
  state: "held" | "fired",
  rows: CurrentOrderRow[],
  position = 1,
  firedAt: string | null = state === "held" ? null : at(0),
): CurrentOrderGroup {
  return {
    id,
    position,
    displayNumber: position + 10,
    numberPartyId: "party-1",
    state,
    firedAt,
    remindAt: null,
    sentAt: at(0),
    sentBy: "Ana",
    rows,
  };
}
function current(
  groups: CurrentOrderGroup[] = [],
  ungrouped: CurrentOrderRow[] = [],
): CurrentOrders {
  return {
    revision: 4,
    hasGroups: groups.length > 0,
    nextDisplayNumber: 12,
    retainedCourses: [
      { id: "mains", name: "Mains", displayOrder: 2, fireNowZoneIds: [] },
      { id: "starters", name: "Starters", displayOrder: 1, fireNowZoneIds: [] },
    ],
    groups,
    ungrouped,
    reminder: null,
  };
}
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
    unitPriceGross: "3.00",
    servedAt: null,
    courseId: "mains",
    sentAt: at(0),
    firedAt: at(0),
    state: "queued",
    groupId: "g1",
    note: null,
    listId: null,
    menuItemId: "offer-burger",
    portion: true,
    ...over,
  };
}
const ids = (rows: readonly SentRow[]) => rows.map((each) => each.slices.map((s) => s.row.lineId));

describe("sentSections (till redesign PR 8a)", () => {
  it("places each fire group in firing order, the rows sent outside any group last", () => {
    const sections = sentSections(
      current(
        [group("g2", "fired", [row("b")], 2), group("g1", "fired", [row("a")], 1)],
        [row("c", { courseId: "mains", firedAt: at(9) }), row("d", { firedAt: at(4) })],
      ),
      "bill-1",
    );
    expect(sections.map((section) => section.group?.id ?? null)).toEqual(["g1", "g2", null]);
    expect(sections[2]).toMatchObject({
      companions: [],
      title: { courseIds: ["mains"], state: "fired", firedAt: at(4) },
    });
    expect(ids(sections[2]!.rows)).toEqual([["d"], ["c"]]);
  });

  it("leaves out groups and rows of other bills, and gives no ungrouped section without rows", () => {
    const sections = sentSections(
      current([group("g1", "fired", [row("a", { workingOrderId: "bill-2" })])], []),
      "bill-1",
    );
    expect(sections).toEqual([]);
  });

  it("puts ready rows first, then the rest by firing time, then served and cancelled rows", () => {
    const [section] = sentSections(
      current([
        group("g1", "fired", [
          row("served", { lineNo: 1, servedQuantity: "1.000", servedAt: at(8) }),
          row("late", { lineNo: 2, firedAt: at(6) }),
          row("ready", { lineNo: 3, readyAt: at(5) }),
          row("early", { lineNo: 4, firedAt: at(1) }),
          row("cancelled", { lineNo: 5, cancelledQuantity: "1.000" }),
        ]),
      ]),
      "bill-1",
    );
    expect(ids(section!.rows)).toEqual([["ready"], ["early"], ["late"], ["served"], ["cancelled"]]);
    expect(section!.rows.map((each) => each.state)).toEqual([
      "ready",
      "fired",
      "fired",
      "served",
      "cancelled_charged",
    ]);
  });

  it("orders ready rows by readiness and same-time rows by line id, whatever order they come in", () => {
    const [section] = sentSections(
      current([
        group("g1", "fired", [
          row("z-done", { lineNo: 1, servedQuantity: "1.000", servedAt: at(9) }),
          row("y-done", { lineNo: 2, servedQuantity: "1.000", servedAt: at(9) }),
          row("b-same", { lineNo: 3, firedAt: at(2) }),
          row("a-same", { lineNo: 4, firedAt: at(2) }),
          row("ready-late", { lineNo: 5, readyAt: at(7) }),
          row("ready-early", { lineNo: 6, readyAt: at(3) }),
        ]),
      ]),
      "bill-1",
    );
    expect(ids(section!.rows).flat()).toEqual([
      "ready-early",
      "ready-late",
      "a-same",
      "b-same",
      "z-done",
      "y-done",
    ]);
  });

  it("lists a held group's rows in line order, whatever their line ids", () => {
    const [section] = sentSections(
      current([
        group("held", "held", [
          row("z-first", { lineNo: 1, released: false, firedAt: null }),
          row("a-second", { lineNo: 2, released: false, firedAt: null }),
        ]),
      ]),
      "bill-1",
    );
    expect(ids(section!.rows).flat()).toEqual(["z-first", "a-second"]);
  });

  it("lists a held group's rows as the read lists them, even when line numbers disagree", () => {
    const [section] = sentSections(
      current([
        group("held", "held", [
          row("z-steak", { lineNo: 3, released: false, firedAt: null }),
          row("a-steak-part", { lineNo: 6, released: false, firedAt: null }),
          row("m-fish", { lineNo: 4, released: false, firedAt: null }),
        ]),
      ]),
      "bill-1",
    );
    expect(ids(section!.rows).flat()).toEqual(["z-steak", "a-steak-part", "m-fish"]);
  });

  it("orders a held group mixing held and released dishes the same way whatever order they come in", () => {
    const rows = [
      row("z-held", { lineNo: 1, released: false, firedAt: null }),
      row("m-fired", { lineNo: 2, firedAt: at(3) }),
      row("a-held", { lineNo: 3, released: false, firedAt: null }),
      row("q-unfired", { lineNo: 4, firedAt: null }),
      row("r-ready", { lineNo: 5, readyAt: at(5) }),
      row("s-served", { lineNo: 6, servedQuantity: "1.000", servedAt: at(6) }),
    ];
    const heldOrder = (list: CurrentOrderRow[]) =>
      list.filter((each) => !each.released).map((each) => each.lineId);
    const permutations = (list: CurrentOrderRow[]): CurrentOrderRow[][] =>
      list.length <= 1
        ? [list]
        : list.flatMap((first, index) =>
            permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [
              first,
              ...rest,
            ]),
          );
    for (const order of permutations(rows)) {
      const [section] = sentSections(current([group("held", "held", order)]), "bill-1");
      const [first, second] = heldOrder(order);
      expect(ids(section!.rows).flat()).toEqual([
        "r-ready",
        "m-fired",
        "q-unfired",
        first,
        second,
        "s-served",
      ]);
    }
  });

  it("orders groups at one position by id, and sorts a course it does not know first", () => {
    const sections = sentSections(
      current([
        group("gb", "fired", [row("b", { courseId: "mains" })], 1),
        group("ga", "fired", [row("a", { courseId: "mains" }), row("c", { courseId: "gone" })], 1),
      ]),
      "bill-1",
    );
    expect(sections.map((section) => section.group!.id)).toEqual(["ga", "gb"]);
    expect(sections[0]!.title.courseIds).toEqual(["gone", "mains"]);
  });

  it("gives the ungrouped section no firing time when none of its rows has one", () => {
    const [section] = sentSections(
      current([], [row("a", { firedAt: null, requestedAt: at(2) })]),
      "bill-1",
    );
    expect(section!.title).toEqual({ courseIds: [], state: "at_the_pass", firedAt: null });
  });

  it("keeps a held group with another bill's dish, which fires with it, as a held section", () => {
    const other = row("theirs", { workingOrderId: "bill-2", courseId: "mains", released: false });
    const sections = sentSections(
      current([
        group("held", "held", [row("mine", { courseId: "starters", released: false }), other]),
      ]),
      "bill-1",
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      companions: [other],
      title: { courseIds: ["starters", "mains"], state: "held", firedAt: null },
    });
    expect(sections[0]!.rows.map((each) => each.state)).toEqual(["held"]);
  });

  it("gives no held section when nothing is held", () => {
    const sections = sentSections(
      current([group("g1", "fired", [row("a")]), group("g2", "held", [row("b")], 2)]),
      "bill-1",
    );
    expect(sections.map((section) => section.title.state === "held")).toEqual([false, false]);
  });

  it("heads a section Fired from its group's firing time", () => {
    const [section] = sentSections(
      current([group("g1", "fired", [row("a", { courseId: "mains" })], 1, at(48))]),
      "bill-1",
    );
    expect(section!.title).toEqual({ courseIds: ["mains"], state: "fired", firedAt: at(48) });
  });

  it("heads a section At the pass when every row with something left waits there", () => {
    const waiting = { firedAt: null, requestedAt: at(2) };
    const [section] = sentSections(
      current([
        group("g1", "fired", [
          row("a", { lineNo: 1, ...waiting }),
          row("b", { lineNo: 2, ...waiting }),
          row("c", { lineNo: 3, servedQuantity: "1.000", servedAt: at(3) }),
        ]),
      ]),
      "bill-1",
    );
    expect(section!.title.state).toBe("at_the_pass");
    expect(section!.rows.map((each) => each.state)).toEqual([
      "at_the_pass",
      "at_the_pass",
      "served",
    ]);
  });

  it("heads a mixed section Fired, its waiting row saying At the pass", () => {
    const [section] = sentSections(
      current([
        group("g1", "fired", [
          row("a", { lineNo: 1, firedAt: null, requestedAt: at(2) }),
          row("b", { lineNo: 2 }),
        ]),
      ]),
      "bill-1",
    );
    expect(section!.title.state).toBe("fired");
    expect(
      Object.fromEntries(section!.rows.map((each) => [each.slices[0]!.row.lineId, each.state])),
    ).toEqual({ a: "at_the_pass", b: "fired" });
  });

  it("heads a wholly served section Fired", () => {
    const [section] = sentSections(
      current([group("g1", "fired", [row("a", { servedQuantity: "1.000", servedAt: at(3) })])]),
      "bill-1",
    );
    expect(section!.title.state).toBe("fired");
  });

  it("draws a line of 3 with 1 served as one row, 1 of 3 served, 2 left", () => {
    const [section] = sentSections(
      current([
        group("g1", "fired", [
          row("a", { quantity: "3.000", servedQuantity: "1.000", netAmount: "10.00" }),
        ]),
      ]),
      "bill-1",
    );
    expect(section!.rows).toHaveLength(1);
    const [only] = section!.rows;
    expect(only).toMatchObject({ quantity: "3", served: "1", amount: "10.00", state: "fired" });
    expect(only!.slices.map((s) => [s.kind, s.quantity, s.amount])).toEqual([
      ["served", "1", "3.33"],
      ["fired", "2", "6.67"],
    ]);
    expect(only!.left.map((s) => [s.row.lineId, s.quantity])).toEqual([["a", "2"]]);
  });

  it("draws three identical lines of 1 with one served as one row, 1 of 3 served", () => {
    const served = { servedQuantity: "1.000", servedAt: at(7), readyAt: at(5) };
    const rows = [
      row("b2", { lineNo: 2, courseId: "mains", ...served }),
      row("b1", { lineNo: 1, courseId: "mains" }),
      row("b3", { lineNo: 3, courseId: "mains" }),
    ];
    const lines = [
      line("b1", 1),
      line("b2", 2, { servedAt: at(7), state: "ready", movable: false }),
      line("b3", 3),
    ];
    const [section] = sentSections(current([group("g1", "fired", rows)]), "bill-1", (slice) =>
      sentRowPortionKey(slice, lines),
    );
    expect(section!.rows).toHaveLength(1);
    const [only] = section!.rows;
    expect(only).toMatchObject({ quantity: "3", served: "1", amount: "9.00", state: "fired" });
    expect(only!.slices.map((s) => s.row.lineId)).toEqual(["b1", "b2", "b3"]);
    expect(only!.left.map((s) => s.row.lineId)).toEqual(["b1", "b3"]);
  });

  it("keeps identical unserved portions apart by readiness, served twins joining the first listed", () => {
    const rows = [
      row("b1", { lineNo: 1, courseId: "mains" }),
      row("b2", { lineNo: 2, courseId: "mains", readyAt: at(5) }),
      row("b3", { lineNo: 3, courseId: "mains", servedQuantity: "1.000", servedAt: at(7) }),
      row("b4", { lineNo: 4, courseId: "mains", servedQuantity: "1.000", servedAt: at(8) }),
    ];
    const lines = [
      line("b1", 1),
      line("b2", 2, { state: "ready" }),
      line("b3", 3, { servedAt: at(7), movable: false }),
      line("b4", 4, { servedAt: at(8), movable: false }),
    ];
    const [section] = sentSections(current([group("g1", "fired", rows)]), "bill-1", (slice) =>
      sentRowPortionKey(slice, lines),
    );
    expect(ids(section!.rows)).toEqual([["b2", "b3", "b4"], ["b1"]]);
    expect(section!.rows.map((each) => [each.state, each.served, each.quantity])).toEqual([
      ["ready", "2", "3"],
      ["fired", "0", "1"],
    ]);
  });

  it("joins identical served portions with no unserved twin into one served row", () => {
    const served = { courseId: "mains", servedQuantity: "1.000", servedAt: at(7) };
    const lines = [line("b1", 1, { servedAt: at(7) }), line("b2", 2, { servedAt: at(7) })];
    const [section] = sentSections(
      current([
        group("g1", "fired", [
          row("b1", { lineNo: 1, ...served }),
          row("b2", { lineNo: 2, ...served }),
        ]),
      ]),
      "bill-1",
      (slice) => sentRowPortionKey(slice, lines),
    );
    expect(section!.rows.map((each) => [each.state, each.served, each.quantity])).toEqual([
      ["served", "2", "2"],
    ]);
  });

  it("keeps a cancelled, charged part as its own row beside the rest of its line", () => {
    const [section] = sentSections(
      current([
        group("g1", "fired", [
          row("a", {
            quantity: "3.000",
            cancelledQuantity: "1.000",
            servedQuantity: "1.000",
            netAmount: "9.00",
          }),
        ]),
      ]),
      "bill-1",
    );
    expect(
      section!.rows.map((each) => [each.state, each.quantity, each.served, each.amount]),
    ).toEqual([
      ["fired", "2", "1", "6.00"],
      ["cancelled_charged", "1", "0", "3.00"],
    ]);
  });

  it("prices a row as the sum of its slices", () => {
    const lines = [line("b1", 1), line("b2", 2)];
    const [section] = sentSections(
      current(
        [],
        [
          row("b1", { lineNo: 1, courseId: "mains" }),
          row("b2", { lineNo: 2, courseId: "mains", netAmount: "3.00" }),
        ],
      ),
      "bill-1",
      (slice) => sentRowPortionKey(slice, lines),
    );
    expect(section!.rows.map((each) => each.amount)).toEqual(["6.00"]);
  });

  it("draws a held row's portions as held, and nothing served", () => {
    const [section] = sentSections(
      current([group("held", "held", [row("a", { quantity: "2.000", released: false })])]),
      "bill-1",
    );
    expect(section!.rows).toEqual([
      expect.objectContaining({ state: "held", quantity: "2", served: "0" }),
    ]);
  });
});
