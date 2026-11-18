import { expect, it } from "vitest";
import { renameOrderEvents } from "./os6-order-event-kinds.mjs";

it("moves the table and its event comparisons without renaming other kinds", () => {
  const before = [
    'eq(orderGroupEvents.kind, "fired")',
    'inArray(orderDraftEvents.kind, ["created", "submitted"])',
    "orderGroupEvents.createdAt",
    "orderPortionEvents.lineId",
    'eq(orderGroups.state, "fired")',
    'eq(kitchenNotices.kind, "moved")',
  ].join("\n");
  const after = [
    'eq(orderEvents.kind, "group.fired")',
    'inArray(orderEvents.kind, ["draft.created", "draft.submitted"])',
    "orderEvents.at",
    "orderEvents.lineId",
    'eq(orderGroups.state, "fired")',
    'eq(kitchenNotices.kind, "moved")',
  ].join("\n");
  expect(renameOrderEvents(before)).toBe(after);
  expect(renameOrderEvents(after)).toBe(after);
});
