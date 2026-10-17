import { describe, expect, it } from "vitest";
import type { CurrentOrderGroup, CurrentOrderRow, CurrentOrders } from "../api/client.js";
import { sentPanel } from "./sent-panel.js";

const now = Date.parse("2026-10-17T13:00:00.000Z");
const at = (minute: number) => `2026-10-17T12:${String(minute).padStart(2, "0")}:00.000Z`;
function row(id: string, over: Partial<CurrentOrderRow> = {}): CurrentOrderRow {
  return {
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
  };
}
function group(
  id: string,
  state: "held" | "fired",
  rows: CurrentOrderRow[],
  position = 1,
): CurrentOrderGroup {
  return {
    id,
    position,
    displayNumber: position + 10,
    numberPartyId: "party-1",
    state,
    firedAt: state === "held" ? null : at(0),
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
    retainedCourses: [],
    groups,
    ungrouped,
    reminder: null,
  };
}
const slices = (rows: ReturnType<typeof sentPanel>["served"]) =>
  rows.map(({ row, kind, quantity, amount }) => ({ id: row.lineId, kind, quantity, amount }));

describe("Sent panel (A773)", () => {
  it("separates actual serving, charged cancellation and active food without losing a rounding cent", () => {
    const dish = row("dish", {
      quantity: "3.000",
      servedQuantity: "1.000",
      cancelledQuantity: "1.000",
      netAmount: "10.00",
    });
    const panel = sentPanel(current([group("sent", "fired", [dish])]), "bill-1", now);
    expect(slices(panel.served)).toEqual([
      { id: "dish", kind: "cancelled_charged", quantity: "1", amount: "3.33" },
      { id: "dish", kind: "served", quantity: "1", amount: "3.33" },
    ]);
    expect(slices(panel.fired)).toEqual([
      { id: "dish", kind: "fired", quantity: "1", amount: "3.34" },
    ]);
    expect(panel.counts).toEqual({ ready: "0", firing: "1", held: "0", served: "2" });
    expect(panel.subtotals).toEqual({ served: "6.66", fired: "3.34", held: "0.00" });
    expect(panel.held).toEqual([]);
  });

  it("keeps fully charged cancellations in Served even when their original group is held", () => {
    const dish = row("cancelled", {
      quantity: "2.000",
      cancelledQuantity: "2.000",
      netAmount: "9.01",
      released: false,
      firedAt: null,
    });
    const panel = sentPanel(current([group("held", "held", [dish])]), "bill-1", now);
    expect(slices(panel.served)).toEqual([
      { id: "cancelled", kind: "cancelled_charged", quantity: "2", amount: "9.01" },
    ]);
    expect(panel.fired).toEqual([]);
    expect(panel.held).toEqual([]);
    expect(panel.counts).toEqual({ ready: "0", firing: "0", held: "0", served: "2" });
    expect(panel.subtotals).toEqual({ served: "9.01", fired: "0.00", held: "0.00" });
  });

  it("flattens fired groups, orders ready by effective ready time then the rest by fired time, and breaks ties by ID", () => {
    const data = current(
      [
        group("first", "fired", [
          row("later-ready", { readyAt: at(9) }),
          row("b", { firedAt: at(3) }),
          row("other-bill", { workingOrderId: "bill-2", netAmount: "999.00" }),
        ]),
        group(
          "second",
          "fired",
          [
            row("a", { firedAt: at(3) }),
            row("old-ready", { readyAt: at(2) }),
            row("old-firing", { firedAt: at(1) }),
          ],
          2,
        ),
      ],
      [row("no-kitchen", { firedAt: at(5) })],
    );
    const panel = sentPanel(data, "bill-1", now);
    expect(panel.fired.map((slice) => slice.row.lineId)).toEqual([
      "old-ready",
      "later-ready",
      "old-firing",
      "a",
      "b",
      "no-kitchen",
    ]);
    expect(panel.counts).toEqual({ ready: "2", firing: "4", held: "0", served: "0" });
    expect(panel.subtotals.fired).toBe("18.00");
  });

  it("shows only this bill's held prices and quantities, with active other-bill companions at the same group", () => {
    const held = group("shared", "held", [
      row("ours", {
        quantity: "3.000",
        cancelledQuantity: "1.000",
        netAmount: "12.00",
        released: false,
      }),
      row("theirs", {
        workingOrderId: "bill-2",
        quantity: "4.000",
        netAmount: "900.00",
        released: false,
      }),
      row("gone", { workingOrderId: "bill-2", cancelledQuantity: "1.000", released: false }),
    ]);
    const data = current([
      group("unrelated", "held", [row("unrelated", { workingOrderId: "bill-3" })]),
      held,
    ]);
    const panel = sentPanel(data, "bill-1", now);
    expect(panel.held).toHaveLength(1);
    expect(panel.held[0]!.group).toBe(held);
    expect(slices(panel.held[0]!.rows)).toEqual([
      { id: "ours", kind: "held", quantity: "2", amount: "8.00" },
    ]);
    expect(panel.held[0]!.companions.map((row) => row.lineId)).toEqual(["theirs"]);
    expect(panel.counts).toEqual({ ready: "0", firing: "0", held: "2", served: "1" });
    expect(panel.subtotals).toEqual({ served: "4.00", fired: "0.00", held: "8.00" });
  });

  it("keeps exact fractional counts and large money values, clamps serving to the uncancelled food", () => {
    const data = current(
      [],
      [
        row("weighed", {
          unitPrecision: 3,
          quantity: "0.375",
          servedQuantity: "0.125",
          cancelledQuantity: "0.125",
          netAmount: "999999999999.97",
        }),
        row("clamped", {
          quantity: "2.000",
          servedQuantity: "2.000",
          cancelledQuantity: "1.000",
          netAmount: "0.01",
        }),
      ],
    );
    const panel = sentPanel(data, "bill-1", now);
    expect(slices(panel.fired)).toEqual([
      { id: "weighed", kind: "fired", quantity: "0.125", amount: "333333333333.33" },
    ]);
    expect(slices(panel.served)).toEqual([
      { id: "weighed", kind: "cancelled_charged", quantity: "0.125", amount: "333333333333.32" },
      { id: "weighed", kind: "served", quantity: "0.125", amount: "333333333333.32" },
      { id: "clamped", kind: "cancelled_charged", quantity: "1", amount: "0.01" },
      { id: "clamped", kind: "served", quantity: "1", amount: "0.00" },
    ]);
    expect(panel.counts).toEqual({ ready: "0", firing: "0.125", held: "0", served: "2.25" });
    expect(panel.subtotals).toEqual({
      served: "666666666666.65",
      fired: "333333333333.33",
      held: "0.00",
    });
  });

  it("retains the party-wide reminder for a group shared with another bill without redating it", () => {
    const data = current([
      group("held", "held", [row("their-dish", { workingOrderId: "bill-2", released: false })]),
    ]);
    data.reminder = { groupId: "held", dueAt: at(59) };
    const before = structuredClone(data);
    const panel = sentPanel(data, "bill-1", now);
    expect(panel.reminder).toEqual(data.reminder);
    expect(panel.held).toEqual([]);
    expect(panel.counts).toEqual({ ready: "0", firing: "0", held: "0", served: "0" });
    expect(data).toEqual(before);
    expect(sentPanel(data, "bill-1", now + 50000).reminder).toEqual(data.reminder);
  });

  it("keeps a released dish in Fired when its original held group still holds the other dishes", () => {
    const data = current([
      group("mixed", "held", [row("released"), row("held", { released: false })]),
    ]);
    const panel = sentPanel(data, "bill-1", now);
    expect(panel.fired.map((slice) => slice.row.lineId)).toEqual(["released"]);
    expect(panel.held[0]!.rows.map((slice) => slice.row.lineId)).toEqual(["held"]);
    expect(panel.subtotals).toEqual({ served: "0.00", fired: "3.00", held: "3.00" });
  });

  it("does not turn missing kitchen times or a zero-count row into ready food", () => {
    const data = current(
      [],
      [row("no-time", { firedAt: null }), row("none", { quantity: "0", netAmount: "0.00" })],
    );
    const panel = sentPanel(data, "bill-1", now);
    expect(slices(panel.fired)).toEqual([
      { id: "no-time", kind: "fired", quantity: "1", amount: "3.00" },
    ]);
    expect(panel.counts).toEqual({ ready: "0", firing: "1", held: "0", served: "0" });
  });

  it("needs attention for ready active food or the existing reminder becoming due, never for cancellation alone", () => {
    const data = current([], [row("cancelled", { cancelledQuantity: "1.000", readyAt: at(1) })]);
    expect(sentPanel(data, "bill-1", now).attention).toBe(false);
    data.reminder = { groupId: "held", dueAt: "2026-10-17T13:01:00.000Z" };
    expect(sentPanel(data, "bill-1", now).attention).toBe(false);
    expect(sentPanel(data, "bill-1", now + 60000).attention).toBe(true);
    data.reminder = { groupId: "held", dueAt: null };
    expect(sentPanel(data, "bill-1", now).attention).toBe(false);
    data.ungrouped = [row("ready", { readyAt: at(1) })];
    expect(sentPanel(data, "bill-1", now).attention).toBe(true);
  });

  it("preserves paid bill facts and counts the stored family amount only once", () => {
    const dish = row("paid", {
      billStatus: "settled",
      netAmount: "4.25",
      readyAt: at(2),
      extras: [
        {
          lineId: "extra",
          name: "Sauce",
          quantity: "1.000",
          netAmount: "1.25",
          unitPriceGross: "1.25",
          priceQuantity: "1.000",
        },
      ],
    });
    const panel = sentPanel(current([], [dish]), "bill-1", now);
    expect(panel.fired[0]!.row).toBe(dish);
    expect(panel.subtotals.fired).toBe("4.25");
    expect(panel.counts.ready).toBe("1");
  });
});
