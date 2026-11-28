import { afterEach, expect, it, vi } from "vitest";
import { current, now } from "../screens/till-table-order-screen.current-orders.test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillSentOrders } from "./sent-orders.js";

const built = vi.hoisted(() => ({ count: 0 }));
vi.mock("../state/sent-sections.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../state/sent-sections.js")>();
  return {
    ...original,
    sentSections: (...args: Parameters<typeof original.sentSections>) => {
      built.count += 1;
      return original.sentSections(...args);
    },
  };
});

afterEach(() => {
  cleanupWidgets();
  built.count = 0;
});

it("builds the sent list again only when the read inside the snapshot changes, not its wrapper", async () => {
  const read = current();
  const { el } = await mountWidget<TillSentOrders>("till-sent-orders", {
    scope: "visit",
    billId: "wo-4",
    now,
    snapshot: { scope: "visit", billId: "wo-4", current: read },
  });
  expect(el.shadowRoot!.querySelector("[data-sent-panel]")).not.toBeNull();
  const afterMount = built.count;
  expect(afterMount).toBeGreaterThan(0);
  el.requestUpdate();
  await el.updateComplete;
  expect(built.count).toBe(afterMount);
  el.snapshot = { scope: "visit", billId: "wo-4", current: read };
  await el.updateComplete;
  expect(built.count).toBe(afterMount);
  el.snapshot = { scope: "visit", billId: "wo-4", current: structuredClone(read) };
  await el.updateComplete;
  expect(built.count).toBe(afterMount + 1);
});
