import { describe, expect, it } from "vitest";
import type { CurrentOrderGroup, CurrentOrderRow, CurrentOrders } from "../api/kitchen-api.js";
import { sentPanel } from "./sent-panel.js";
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
  it("puts a fully cancelled fractional dish in Served at its original quantity", () => {
    const panel = sentPanel(
      current(
        [],
        [
          row("fraction", {
            quantity: "2.5",
            cancelledQuantity: "2.5",
            countsWholePortions: true,
          }),
        ],
      ),
      "bill-1",
    );
    expect(panel.served[0]!.quantity).toBe("2.5");
  });

  it("separates actual serving, charged cancellation and active food without losing a rounding cent", () => {
    const dish = row("dish", {
      quantity: "3.000",
      servedQuantity: "1.000",
      cancelledQuantity: "1.000",
      netAmount: "10.00",
    });
    const panel = sentPanel(current([group("sent", "fired", [dish])]), "bill-1");
    expect(slices(panel.served)).toEqual([
      { id: "dish", kind: "cancelled_charged", quantity: "1", amount: "3.33" },
      { id: "dish", kind: "served", quantity: "1", amount: "3.33" },
    ]);
    expect(slices(panel.fired)).toEqual([
      { id: "dish", kind: "fired", quantity: "1", amount: "3.34" },
    ]);
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
    const panel = sentPanel(current([group("held", "held", [dish])]), "bill-1");
    expect(slices(panel.served)).toEqual([
      { id: "cancelled", kind: "cancelled_charged", quantity: "2", amount: "9.01" },
    ]);
    expect(panel.fired).toEqual([]);
    expect(panel.held).toEqual([]);
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
    const panel = sentPanel(data, "bill-1");
    expect(panel.fired.map((slice) => slice.row.lineId)).toEqual([
      "old-ready",
      "later-ready",
      "old-firing",
      "a",
      "b",
      "no-kitchen",
    ]);
  });

  it("shows only this bill's held prices and quantities", () => {
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
    const panel = sentPanel(data, "bill-1");
    expect(panel.held).toHaveLength(1);
    expect(panel.held[0]!.group).toBe(held);
    expect(slices(panel.held[0]!.rows)).toEqual([
      { id: "ours", kind: "held", quantity: "2", amount: "8.00" },
    ]);
  });

  it("keeps measured food's exact portions and large money values in each slice", () => {
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
    const panel = sentPanel(data, "bill-1");
    expect(slices(panel.fired)).toEqual([
      { id: "weighed", kind: "fired", quantity: "0.125", amount: "333333333333.33" },
    ]);
    expect(slices(panel.served)).toEqual([
      { id: "weighed", kind: "cancelled_charged", quantity: "0.125", amount: "333333333333.32" },
      { id: "weighed", kind: "served", quantity: "0.125", amount: "333333333333.32" },
      { id: "clamped", kind: "cancelled_charged", quantity: "1", amount: "0.01" },
      { id: "clamped", kind: "served", quantity: "1", amount: "0.00" },
    ]);
  });

  it.each(["150", "330"])("keeps a zero-precision measure of %s as one slice", (quantity) => {
    const panel = sentPanel(
      current([], [row("measure", { quantity, countsWholePortions: false })]),
      "bill-1",
    );
    expect(panel.fired[0]!.quantity).toBe(quantity);
  });

  it("splits a part-served dish between Served and Fired at its exact quantities", () => {
    const panel = sentPanel(
      current([], [row("portions", { quantity: "3", servedQuantity: "1.5", netAmount: "9.00" })]),
      "bill-1",
    );
    expect(slices(panel.fired)).toEqual([
      { id: "portions", kind: "fired", quantity: "1.5", amount: "4.50" },
    ]);
    expect(slices(panel.served)).toEqual([
      { id: "portions", kind: "served", quantity: "1.5", amount: "4.50" },
    ]);
  });

  it("lists nothing for a held group holding only another bill's dish, and leaves the read unchanged", () => {
    const data = current([
      group("held", "held", [row("their-dish", { workingOrderId: "bill-2", released: false })]),
    ]);
    const before = structuredClone(data);
    const panel = sentPanel(data, "bill-1");
    expect(panel.held).toEqual([]);
    expect(data).toEqual(before);
  });

  it("keeps a released dish in Fired when its original held group still holds the other dishes", () => {
    const data = current([
      group("mixed", "held", [row("released"), row("held", { released: false })]),
    ]);
    const panel = sentPanel(data, "bill-1");
    expect(panel.fired.map((slice) => slice.row.lineId)).toEqual(["released"]);
    expect(panel.held[0]!.rows.map((slice) => slice.row.lineId)).toEqual(["held"]);
  });

  it("keeps a dish with no fired time and drops a row of no quantity", () => {
    const data = current(
      [],
      [row("no-time", { firedAt: null }), row("none", { quantity: "0", netAmount: "0.00" })],
    );
    const panel = sentPanel(data, "bill-1");
    expect(slices(panel.fired)).toEqual([
      { id: "no-time", kind: "fired", quantity: "1", amount: "3.00" },
    ]);
  });

  it("preserves paid bill facts and gives the slice the stored family amount once", () => {
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
    const panel = sentPanel(current([], [dish]), "bill-1");
    expect(panel.fired[0]!.row).toBe(dish);
    expect(panel.fired[0]!.amount).toBe("4.25");
  });
});
