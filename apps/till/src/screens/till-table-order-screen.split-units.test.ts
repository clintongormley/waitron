import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { beer, flan, jamon, mount, store } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { OrderLine } from "../state/working-order.js";

const source: NonNullable<OrderLine["source"]> = {
  line: {
    id: "sent-beer",
    name: "Recorded beer",
    productId: "beer",
    parentProductId: null,
    menuItemId: "offer-beer",
    lineNo: 1,
    parentLineNo: null,
    quantity: "3.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "3.00",
    listUnitPriceGross: "3.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    stationId: null,
    movable: true,
    groupId: "held",
    note: null,
    listId: null,
  },
  extras: [],
  netAmount: "9.00",
};

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const split = (el: TillTableOrderScreen, index = 0) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-split-draft-line="${index}"]`);

async function draftWithUnits() {
  const { el } = await mount();
  const draft = store(el);
  draft.addProduct(beer, "3");
  await el.updateComplete;
  const review = el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!;
  if (review.checkVisibility()) await userEvent.click(review);
  await el.updateComplete;
  return { el, draft };
}

it("splits from a trailing chevron instead of a separate tool under the row", async () => {
  const { el, draft } = await draftWithUnits();
  const control = split(el)!;
  expect(control.getAttribute("slot")).toBe("end-0");
  expect(control.textContent!.trim()).toBe("›");
  expect(control.getAttribute("aria-label")).toBe("Split quantity · Beer");
  await userEvent.click(control);
  await el.updateComplete;
  expect(draft.lines.map((line) => [line.product.name, line.quantity, line.noMerge])).toEqual([
    ["Beer", "1", true],
    ["Beer", "1", true],
    ["Beer", "1", true],
  ]);
  expect(split(el)).toBeNull();
});

it("follows the shown line identity if an earlier line disappears before its click", async () => {
  const { el } = await mount();
  const draft = store(el);
  draft.addProduct(flan, "2");
  draft.addProduct(beer, "3");
  await el.updateComplete;
  const control = split(el, 1)!;
  draft.removeLine(0);
  control.click();
  expect(draft.lines.map((line) => [line.product.name, line.quantity])).toEqual([
    ["Beer", "1"],
    ["Beer", "1"],
    ["Beer", "1"],
  ]);
});

it("a removed row's old chevron cannot split the row that took its index", async () => {
  const { el, draft } = await draftWithUnits();
  draft.addProduct(flan, "2");
  await el.updateComplete;
  const control = split(el)!;
  draft.removeLine(0);
  control.click();
  expect(draft.lines.map((line) => [line.product.name, line.quantity])).toEqual([["Flan", "2"]]);
});

it("a previous bill's chevron cannot change either bill before the next render", async () => {
  const { el, draft } = await draftWithUnits();
  const control = split(el)!;
  const other = new DraftStore();
  other.addProduct(flan, "2");
  el.draftStore = other;
  control.click();
  expect(draft.lines.map((line) => line.quantity)).toEqual(["3"]);
  expect(other.lines.map((line) => line.quantity)).toEqual(["2"]);
});

it.each(["sending", "locked", "group-command"] as const)(
  "an old chevron cannot split while %s takes editing authority",
  async (busy) => {
    const { el, draft } = await draftWithUnits();
    const control = split(el)!;
    if (busy === "sending") draft.sending = true;
    else if (busy === "locked") draft.lockEdits();
    else el.groupCommandBusy = true;
    control.click();
    expect(draft.lines.map((line) => line.quantity)).toEqual(["3"]);
  },
);

it("does not offer unit splitting for measured, single or fractional quantities", async () => {
  const { el } = await mount();
  store(el).loadFrom(store(el).id, [
    { product: jamon, quantity: "3" },
    { product: beer, quantity: "1" },
    { product: beer, quantity: "2.5" },
  ]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("[data-split-draft-line]")).toHaveLength(0);
});

it("a recalled line asks the server to split its source without copying priced references locally", async () => {
  const { el, draft } = await draftWithUnits();
  draft.lines[0]!.source = source;
  const onSplit = vi.fn();
  el.addEventListener("split-draft-source", onSplit);
  await userEvent.click(split(el)!);
  expect(onSplit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      detail: { store: draft, line: draft.lines[0] },
      bubbles: true,
      composed: true,
    }),
  );
  expect(draft.lines).toHaveLength(1);
  expect(draft.lines[0]!.quantity).toBe("3");
  expect(draft.lines[0]!.source).toBe(source);
});

it.each(["sending", "locked", "group-command"] as const)(
  "does not ask to split a recalled source after %s begins",
  async (busy) => {
    const { el, draft } = await draftWithUnits();
    const line = draft.lines[0]!;
    line.source = source;
    const onSplit = vi.fn();
    el.addEventListener("split-draft-source", onSplit);
    const control = split(el)!;
    if (busy === "sending") draft.sending = true;
    else if (busy === "locked") draft.lockEdits();
    else el.groupCommandBusy = true;
    control.click();
    expect(onSplit).not.toHaveBeenCalled();
    expect(draft.lines).toEqual([line]);
    expect(line.quantity).toBe("3");
  },
);
