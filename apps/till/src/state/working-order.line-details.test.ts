import { expect, it } from "vitest";
import type { TillCourse, TillProduct } from "../api/client.js";
import { placeFor } from "./draft-place.js";
import { DraftStore } from "./draft-sync.js";
import { WorkingOrderStore } from "./working-order.js";

const dish: TillProduct = {
  id: "soup",
  name: "Staff soup",
  customerName: { en: "Customer soup" },
  kitchenName: "Kitchen soup",
  unitPrice: "5.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
};
const change = { quantity: "3", note: "New note", selection: {} };
function saved() {
  const store = new WorkingOrderStore();
  store.loadFrom("saved", [{ product: dish, quantity: "2", note: "Original note" }]);
  return store;
}
it.each(["sending", "reload"] as const)(
  "A738 combined line edits wait for %s and work after release",
  (kind) => {
    const store = saved();
    const line = store.lines[0]!;
    const before = structuredClone(store.lines);
    const release =
      kind === "sending"
        ? (() => {
            store.sending = true;
            return () => {
              store.sending = false;
            };
          })()
        : store.lockEdits();
    const observations: unknown[] = [];
    store.on("changed", () => observations.push(structuredClone(store.lines)));
    expect(store.setLineDetails(0, change)).toBe(false);
    expect(store.lines).toEqual(before);
    expect(store.lines[0]).toBe(line);
    expect(store.dirty).toBe(false);
    expect(observations).toEqual([]);
    release();
    observations.length = 0;
    expect(store.setLineDetails(0, change)).toBe(true);
    expect(store.lines[0]).toBe(line);
    expect(store.lines[0]!.quantity).toBe("3");
    expect(store.lines[0]!.note).toBe("New note");
    expect(store.dirty).toBe(true);
    expect(observations).toEqual([structuredClone(store.lines)]);
  },
);
it("A738 a stale line index refuses the complete edit without touching another line", () => {
  const store = saved();
  const before = structuredClone(store.lines);
  const changes: unknown[] = [];
  store.on("changed", () => changes.push(store.lines));
  expect(store.setLineDetails(99, change)).toBe(false);
  expect(store.lines).toEqual(before);
  expect(store.dirty).toBe(false);
  expect(changes).toEqual([]);
});
it("A738 an expired offer refuses an increase without saving its note but permits a same-quantity note", () => {
  const store = saved();
  const before = structuredClone(store.lines);
  const refusals: unknown[] = [];
  const changes: unknown[] = [];
  store.canSelectProduct = () => false;
  store.on("refused", (value) => refusals.push(value));
  store.on("changed", () => changes.push(structuredClone(store.lines)));
  expect(store.setLineDetails(0, change)).toBe(false);
  expect(refusals).toEqual([{ code: "menu_period.not_running" }]);
  expect(store.lines).toEqual(before);
  expect(store.dirty).toBe(false);
  expect(changes).toEqual([]);
  expect(store.setLineDetails(0, { ...change, quantity: "2" })).toBe(true);
  expect(store.lines[0]!.quantity).toBe("2");
  expect(store.lines[0]!.note).toBe("New note");
  expect(refusals).toHaveLength(1);
  expect(changes).toEqual([structuredClone(store.lines)]);
});
const starter: TillCourse = {
  id: "starter",
  name: "Starter",
  displayOrder: 0,
  heldUntilFired: true,
};
const mains: TillCourse = { id: "mains", name: "Mains", displayOrder: 1, heldUntilFired: true };
function courseDraft() {
  const store = new DraftStore();
  store.loadFrom("draft", [
    {
      product: dish,
      quantity: "2",
      note: "Original note",
      courseId: mains.id,
      course: mains,
      place: { kind: "fire" },
    },
    {
      product: { ...dish, id: "other", name: "Other staff dish" },
      quantity: "1",
      courseId: mains.id,
      course: mains,
      place: { kind: "new", slot: 1 },
    },
  ]);
  store.placer = (courseId, exceptIndex) =>
    placeFor(courseId, {
      courses: [starter, mains],
      held: [],
      firstOrder: true,
      placed: store.lines.flatMap((line, index) =>
        index === exceptIndex ? [] : [{ courseId: line.courseId ?? null, place: line.place! }],
      ),
    });
  return store;
}
it("A738 a combined course change inserts an earlier group and shifts its neighbour once", () => {
  const store = courseDraft();
  const line = store.lines[0]!;
  const observations: unknown[] = [];
  store.on("changed", () =>
    observations.push(store.lines.map((row) => ({ id: row.product.id, place: row.place }))),
  );
  expect(
    store.setLineDetails(0, {
      ...change,
      quantity: "2",
      course: { id: starter.id, value: starter },
    }),
  ).toBe(true);
  expect(store.lines[0]).toBe(line);
  expect(line.note).toBe("New note");
  expect(line.course).toEqual(starter);
  expect(line.courseId).toBe("starter");
  expect(observations).toEqual([
    [
      { id: "soup", place: { kind: "new", slot: 1 } },
      { id: "other", place: { kind: "new", slot: 2 } },
    ],
  ]);
});
it("A738 a refused combined total neither changes the course nor shifts another group", () => {
  const store = courseDraft();
  store.simplifiedInvoiceLimit = "15.00";
  const before = structuredClone(store.lines);
  const refusals: unknown[] = [];
  const changes: unknown[] = [];
  store.on("refused", (value) => refusals.push(value));
  store.on("changed", () => changes.push(store.lines));
  expect(store.setLineDetails(0, { ...change, course: { id: starter.id, value: starter } })).toBe(
    false,
  );
  expect(refusals).toEqual([{ code: "sale.total_exceeds_simplified_limit", limit: "15.00" }]);
  expect(store.lines).toEqual(before);
  expect(store.total).toBe("15.00");
  expect(store.dirty).toBe(false);
  expect(changes).toEqual([]);
});
