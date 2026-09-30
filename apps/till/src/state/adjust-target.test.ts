import { describe, expect, it } from "vitest";
import type { TabLine } from "../api/client.js";
import { lineAdjustTarget } from "./adjust-target.js";

function line(over: Partial<TabLine>): TabLine {
  return {
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
});
