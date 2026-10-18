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

const fold = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>("[data-fold-draft-family]");

async function expandedUnits() {
  const result = await draftWithUnits();
  await userEvent.click(split(result.el)!);
  await result.el.updateComplete;
  return result;
}

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

it("folds the expanded family's header into one priced line, retaining its saved identity", async () => {
  const { el, draft } = await expandedUnits();
  draft.lines[0]!.draftLineId = "saved-first";
  draft.markPersisted();
  const changed = vi.fn();
  draft.subscribe(changed);
  const header = fold(el);
  expect(header).not.toBeNull();
  expect(header!.textContent!.replace(/\s+/g, " ").trim()).toBe("Beer ×3 ⌃");
  expect(header!.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(header!);
  await el.updateComplete;
  expect(
    draft.lines.map((line) => [line.product.id, line.quantity, line.noMerge, line.draftLineId]),
  ).toEqual([["beer", "3", undefined, "saved-first"]]);
  expect(draft.total).toBe("9.00");
  expect(draft.dirty).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(fold(el)).toBeNull();
  expect(split(el)).not.toBeNull();
});

it("does not absorb an identical later addition into the split family", async () => {
  const { el, draft } = await expandedUnits();
  draft.addMerging(beer, "2");
  await el.updateComplete;
  expect(fold(el)).not.toBeNull();
  await userEvent.click(fold(el)!);
  expect(draft.lines.map((line) => line.quantity)).toEqual(["3", "2"]);
  expect(draft.total).toBe("15.00");
});

it.each([
  "move",
  "note",
  "station",
  "course",
  "remove",
  "source",
  "price",
  "unit",
  "options",
  "extras",
  "variant",
  "fraction",
] as const)("a family changed by %s cannot fold through its old header", async (change) => {
  const { el, draft } = await expandedUnits();
  const header = fold(el);
  expect(header).not.toBeNull();
  if (change === "move") draft.setLinePlaces([1], { kind: "new", slot: 1 });
  else if (change === "note") draft.lines[1]!.note = "No ice";
  else if (change === "station") draft.lines[1]!.makeAt = "bar";
  else if (change === "course") draft.lines[1]!.courseId = "mains";
  else if (change === "remove") draft.removeLine(1);
  else if (change === "source") draft.lines[1]!.source = source;
  else if (change === "price") draft.lines[1]!.product = { ...beer, unitPrice: "4.00" };
  else if (change === "unit") {
    for (const line of draft.lines) line.product = jamon;
  } else if (change === "options") draft.lines[1]!.options = [{ listId: "ice", labelId: "none" }];
  else if (change === "extras")
    draft.lines[1]!.extras = [
      { listId: "pick", productId: "lime", name: "Lime", price: "0.50", quantity: 1 },
    ];
  else if (change === "variant") draft.lines[1]!.product = { ...beer, variantId: "large" };
  else draft.lines[1]!.quantity = "1.5";
  const before = draft.lines.map((line) => [line.quantity, line.note, line.place, line.source]);
  header!.click();
  expect(draft.lines.map((line) => [line.quantity, line.note, line.place, line.source])).toEqual(
    before,
  );
  el.requestUpdate();
  await el.updateComplete;
  expect(fold(el)).toBeNull();
});

it("folds a complete family after all its rows move to the same new group", async () => {
  const { el, draft } = await expandedUnits();
  draft.setLinePlaces([0, 1, 2], { kind: "new", slot: 1 });
  await el.updateComplete;
  expect(fold(el)).not.toBeNull();
  await userEvent.click(fold(el)!);
  expect(draft.lines.map((line) => [line.quantity, line.place])).toEqual([
    ["3", { kind: "new", slot: 1 }],
  ]);
});

it.each(["sending", "locked", "group-command", "other-bill", "removed-screen"] as const)(
  "an old family header cannot fold after %s takes authority",
  async (busy) => {
    const { el, draft } = await expandedUnits();
    const header = fold(el);
    expect(header).not.toBeNull();
    if (busy === "sending") draft.sending = true;
    else if (busy === "locked") draft.lockEdits();
    else if (busy === "group-command") el.groupCommandBusy = true;
    else if (busy === "other-bill") el.draftStore = new DraftStore();
    else el.remove();
    header!.click();
    expect(draft.lines.map((line) => line.quantity)).toEqual(["1", "1", "1"]);
  },
);

it("clears a partial family selection when folding so Fire cannot select extra units", async () => {
  const { el, draft } = await expandedUnits();
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-draft-select="2"]')!);
  await el.updateComplete;
  expect(fold(el)).not.toBeNull();
  await userEvent.click(fold(el)!);
  await el.updateComplete;
  expect(draft.lines.map((line) => line.quantity)).toEqual(["3"]);
  expect(
    el.shadowRoot!.querySelector('[data-draft-select="0"]')!.getAttribute("aria-pressed"),
  ).toBe("false");
});

it("keeps the folded line selected when every expanded unit was ticked", async () => {
  const { el, draft } = await expandedUnits();
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-draft-group-select]")!);
  await el.updateComplete;
  expect(fold(el)).not.toBeNull();
  await userEvent.click(fold(el)!);
  await el.updateComplete;
  expect(draft.lines.map((line) => line.quantity)).toEqual(["3"]);
  expect(
    el.shadowRoot!.querySelector('[data-draft-select="0"]')!.getAttribute("aria-pressed"),
  ).toBe("true");
});
