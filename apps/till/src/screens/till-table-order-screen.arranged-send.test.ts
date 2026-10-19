import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { OrderGroup } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import type { SubmitDraftDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, flan, mount, store } from "./till-table-order-screen.test-helpers.js";

const main = { id: "main", name: "Mains", displayOrder: 2, heldUntilFired: true };
const held: OrderGroup = {
  id: "held",
  position: 3,
  displayNumber: 8,
  numberPartyId: "party",
  state: "held",
  courseIds: ["main"],
  firedAt: null,
  remindAt: null,
  lineIds: [],
  summary: "Mains",
};
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function send(el: TillTableOrderScreen): Promise<SubmitDraftDetail> {
  const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
  if (review?.checkVisibility()) {
    await userEvent.click(review);
    await el.updateComplete;
  }
  const submitted = new Promise<SubmitDraftDetail>((resolve) =>
    el.addEventListener(
      "submit-draft",
      (event) => resolve((event as CustomEvent<SubmitDraftDetail>).detail),
      { once: true },
    ),
  );
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!,
  );
  return submitted;
}

it("Send all keeps two new groups of the same course separate and preserves a held anchor", async () => {
  const { el } = await mount({ courses: [main] });
  const draft = store(el);
  draft.addProduct({ ...beer, courseId: "main" }, "2");
  draft.addProduct({ ...flan, courseId: "main" }, "1");
  draft.setLinePlaces([0], { kind: "new", slot: 4, afterGroupId: "held" });
  draft.setLinePlaces([1], { kind: "new", slot: 1 });
  el.groups = [held];
  await el.updateComplete;
  const detail = await send(el);
  expect(detail.sent).toEqual([draft.lines[1], draft.lines[0]]);
  expect(detail.lines).toEqual([
    { menuItemId: "offer-flan", quantity: "1" },
    { menuItemId: "offer-beer", quantity: "2" },
  ]);
  expect(detail.groups).toEqual([
    { release: "hold", lineIndexes: [0] },
    { release: "hold", lineIndexes: [1], afterGroupId: "held" },
  ]);
});

it("Send all fires an inactive course placed in Fire now, retaining its recorded course", async () => {
  const { el } = await mount({ courses: [main] });
  const draft = store(el);
  draft.addProduct({ ...beer, courseId: "retired" }, "1");
  draft.lines[0]!.course = {
    id: "retired",
    name: "Old starters",
    displayOrder: 1,
    heldUntilFired: true,
  };
  draft.setLinePlaces([0], { kind: "fire" });
  await el.updateComplete;
  const detail = await send(el);
  expect(detail.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
  expect(detail.lines).toEqual([{ menuItemId: "offer-beer", quantity: "1" }]);
  expect(draft.lines[0]!.course?.name).toBe("Old starters");
});

it("Send all keeps Fire now, new and joined destinations even when their courses match", async () => {
  const { el } = await mount({ courses: [main] });
  const draft = store(el);
  draft.addProduct({ ...beer, courseId: "main" }, "2");
  draft.addProduct({ ...flan, courseId: "main" }, "1");
  draft.addProduct(
    { ...beer, id: "water", menuItemId: "offer-water", name: "Water", courseId: "main" },
    "3",
  );
  draft.setLinePlaces([0], { kind: "join", groupId: "held" });
  draft.setLinePlaces([1], { kind: "fire" });
  draft.setLinePlaces([2], { kind: "new", slot: 5 });
  el.groups = [held];
  await el.updateComplete;
  const detail = await send(el);
  expect(detail.sent).toEqual([draft.lines[1], draft.lines[2], draft.lines[0]]);
  expect(detail.groups).toEqual([
    { release: "fire", lineIndexes: [0] },
    { release: "hold", lineIndexes: [1] },
    { release: "hold", lineIndexes: [2], joinGroupId: "held" },
  ]);
  expect(detail.joinGroupId).toBeUndefined();
});

it("Send all leaves blocked dishes out without losing a sendable group's held anchor", async () => {
  const { el } = await mount({ courses: [main] });
  const draft = store(el);
  draft.loadFrom(draft.id, [
    { product: beer, quantity: "2", blocked: "period_ended", place: { kind: "fire" } },
    { product: flan, quantity: "1", place: { kind: "new", slot: 3, afterGroupId: "held" } },
  ]);
  el.groups = [held];
  await el.updateComplete;
  const detail = await send(el);
  expect(detail.sent).toEqual([draft.lines[1]]);
  expect(detail.lines).toEqual([{ menuItemId: "offer-flan", quantity: "1" }]);
  expect(detail.groups).toEqual([{ release: "hold", lineIndexes: [0], afterGroupId: "held" }]);
  expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1"]);
});
