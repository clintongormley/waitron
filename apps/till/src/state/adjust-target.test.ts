import { describe, expect, it } from "vitest";
import type { TabLine } from "../api/client.js";
import { lineAdjustTarget, rowAdjustTarget } from "./adjust-target.js";

function line(over: Partial<TabLine>): TabLine {
  return {
    changesAfterSending: null,
    stationId: null,
    movable: false,
    id: "line-1",
    lineNo: 1,
    productId: "p-pizza",
    parentLineNo: null,
    quantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "9.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
    ...over,
  };
}

const sent = { sentAt: "2026-10-01T12:00:00.000Z", firedAt: "2026-10-01T12:00:00.000Z" };
const olives = line({
  id: "line-2",
  lineNo: 2,
  productId: "p-olives",
  parentLineNo: 1,
  unitPrecision: null,
  unitPriceGross: "1.50",
  listId: "list-1",
});

describe("lineAdjustTarget", () => {
  // Fails if an extra of a dish the kitchen has is not marked, so the dialog cannot say the kitchen
  // is told.
  it("marks an extra of a fired dish as one the kitchen is told about", () => {
    const pizza = line({ ...sent, state: "queued" });
    expect(lineAdjustTarget(olives, [pizza, olives], "Olives").kitchenTold).toBe(true);
  });

  it("leaves unmarked an extra of a dish not fired, and a fired dish itself", () => {
    const held = line({ groupId: "g-1", state: "queued" });
    const fired = line({ ...sent, state: "queued" });
    expect(lineAdjustTarget(olives, [held, olives], "Olives")).not.toHaveProperty("kitchenTold");
    expect(lineAdjustTarget(fired, [fired, olives], "Pizza")).not.toHaveProperty("kitchenTold");
  });

  it("marks a fired split-off extra of a no-preparation dish as told", () => {
    const dish = line({ sentAt: sent.sentAt });
    const chips = { ...olives, ...sent, state: "queued" as const };
    expect(lineAdjustTarget(chips, [dish, chips], "Chips").kitchenTold).toBe(true);
  });

  it("marks a started split-off extra as started", () => {
    const dish = line({ ...sent, state: "queued" });
    const chips = { ...olives, ...sent, state: "preparing" as const };
    expect(lineAdjustTarget(chips, [dish, chips], "Chips").started).toBe(true);
  });

  it("marks a dish as started when only its split-off extra has started", () => {
    const dish = line({ ...sent, state: "queued" });
    const chips = { ...olives, ...sent, state: "preparing" as const };
    expect(lineAdjustTarget(dish, [dish, chips], "Pizza").started).toBe(true);
  });
});

describe("A803 portion grouping: rowAdjustTarget", () => {
  const pizza = (n: number, over: Partial<TabLine> = {}) =>
    line({ ...sent, id: `pizza-${n}`, lineNo: n, state: "queued", portion: true, ...over });
  const olivesOf = (n: number) =>
    line({
      ...sent,
      id: `olives-${n}`,
      lineNo: n + 10,
      productId: "p-olives",
      parentLineNo: n,
      unitPriceGross: "1.50",
      listId: "list-1",
    });
  const row = [pizza(3), pizza(1), pizza(2)];
  const lines = [...row, olivesOf(1), olivesOf(2), olivesOf(3)];

  it("names every member by line number, counts them and totals them with their extras", () => {
    const target = rowAdjustTarget(row, lines, "Pizza");
    expect(target).toMatchObject({
      lineId: "pizza-1",
      lineIds: ["pizza-1", "pizza-2", "pizza-3"],
      name: "Pizza",
      quantity: "3",
      total: "31.50",
      unitTotal: "10.50",
      started: false,
    });
  });

  it("is started when any member is", () => {
    const started = [pizza(1), pizza(2, { state: "preparing" })];
    expect(rowAdjustTarget(started, [...started, olivesOf(1), olivesOf(2)], "Pizza").started).toBe(
      true,
    );
  });

  it("offers one extra product as one target naming that extra on every member", () => {
    const target = rowAdjustTarget(row, lines, "Pizza", (extra) => extra.productId ?? "");
    expect(target.extras).toEqual([
      {
        lineId: "olives-1",
        lineIds: ["olives-1", "olives-2", "olives-3"],
        name: "p-olives",
        quantity: "3",
        total: "4.50",
        unitTotal: null,
        started: false,
        extra: true,
        kitchenTold: true,
      },
    ]);
  });

  it("pairs one product offered by two lists list by list, whatever order each member stores them in", () => {
    const dishes = [pizza(1), pizza(2)];
    const fromList = (n: number, listId: string, lineNo: number) =>
      line({
        ...sent,
        id: `olives-${n}-${listId}`,
        lineNo,
        productId: "p-olives",
        parentLineNo: n,
        unitPriceGross: "1.50",
        listId,
      });
    const target = rowAdjustTarget(
      dishes,
      [
        ...dishes,
        fromList(1, "list-1", 11),
        fromList(1, "list-2", 12),
        fromList(2, "list-2", 13),
        fromList(2, "list-1", 14),
      ],
      "Pizza",
    );
    expect(target.extras!.map((extra) => extra.lineIds)).toEqual([
      ["olives-1-list-1", "olives-2-list-1"],
      ["olives-1-list-2", "olives-2-list-2"],
    ]);
  });
});
