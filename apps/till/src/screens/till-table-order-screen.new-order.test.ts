import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { OrderGroup } from "../api/kitchen-api.js";
import type { WtButton, WtDialog } from "@waitron/ui";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import type { TillBasket } from "../widgets/basket.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  beer,
  flan,
  mount,
  resized,
  rows,
  showView,
  store,
  tap,
} from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

const held = (id: string, position: number, displayNumber: number): OrderGroup => ({
  id,
  position,
  displayNumber,
  numberPartyId: "party",
  state: "held",
  firedAt: null,
  remindAt: null,
  lineIds: [],
  courseIds: ["mains"],
  summary: "Sent steak",
});
const courses = [
  { id: "mains", name: "Mains", displayOrder: 1, fireNowZoneIds: [] },
  { id: "dessert", name: "Desserts", displayOrder: 2, fireNowZoneIds: [] },
];
const dish = (name: string, courseId: string | null = null) => ({
  ...beer,
  id: name,
  menuItemId: `offer-${name}`,
  name,
  courseId,
});
const root = (el: TillTableOrderScreen) => el.shadowRoot!;
const group = (el: TillTableOrderScreen, key: string) =>
  root(el).querySelector<HTMLElement>(`[data-draft-group="${key}"]`);
const tick = (el: TillTableOrderScreen, key: string) =>
  root(el).querySelector<HTMLButtonElement>(`[data-draft-group-select="${key}"]`);
const move = (el: TillTableOrderScreen) => root(el).querySelector<WtButton>("[data-draft-move]");
async function chooseMove(el: TillTableOrderScreen, key: string) {
  await userEvent.click(move(el)!);
  await el.updateComplete;
  await userEvent.click(root(el).querySelector<WtButton>(`[data-draft-move-to="${key}"]`)!);
  await el.updateComplete;
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("New order: stored placement and selection", () => {
  it.each(["locked", "sending", "command"])(
    "ignores a retained group tick while %s, then allows a fresh selection",
    async (state) => {
      const { el } = await mount();
      const draft = store(el);
      draft.addProduct(beer, "1");
      await el.updateComplete;
      await showView(el, "order", { scripted: true });
      const retained = tick(el, "fire")!;
      let release: (() => void) | undefined;
      if (state === "locked") release = draft.lockEdits();
      else if (state === "sending") draft.sending = true;
      else el.groupCommandBusy = true;
      retained.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      if (state === "locked") release!();
      else if (state === "sending") draft.sending = false;
      else el.groupCommandBusy = false;
      await el.updateComplete;
      expect(tick(el, "fire")!.getAttribute("aria-checked")).toBe("false");
      await userEvent.click(tick(el, "fire")!);
      await el.updateComplete;
      expect(tick(el, "fire")!.getAttribute("aria-checked")).toBe("true");
      expect(root(el).querySelectorAll('[data-draft-select][aria-checked="true"]')).toHaveLength(1);
    },
  );
  it("shows Fire now, numbered new groups and joins, sorting only inside their stored places", async () => {
    const { el } = await mount({ courses, groups: [held("held", 1, 7)] });
    const draft = store(el);
    draft.addProduct(dish("Zebra", "mains"), "1");
    draft.addProduct(dish("Apple", "mains"), "1");
    draft.addProduct(flan, "1");
    draft.addProduct(dish("Joined dish"), "1");
    draft.setLinePlaces([0, 1], { kind: "new", slot: 2 });
    draft.setLinePlaces([2], { kind: "fire" });
    draft.setLinePlaces([3], { kind: "join", groupId: "held" });
    await el.updateComplete;

    expect(
      [...root(el).querySelectorAll("[data-draft-group]")].map((part) =>
        part.getAttribute("data-draft-group"),
      ),
    ).toEqual(["fire", "new:2", "join:held"]);
    expect(group(el, "fire")!.querySelector("[data-draft-group-name]")!.textContent).toContain(
      "Fire now",
    );
    expect(group(el, "new:2")!.querySelector("[data-draft-group-name]")!.textContent).toContain(
      "Group 9 · Mains",
    );
    expect(group(el, "join:held")!.querySelector("[data-draft-group-name]")!.textContent).toContain(
      "Joins Group 7",
    );
    expect(
      [...group(el, "new:2")!.querySelectorAll("[data-draft-select]")].map((row) =>
        row.getAttribute("data-draft-select"),
      ),
    ).toEqual(["1", "0"]);
    expect(group(el, "new:2")!.querySelector(".draft-section-name")).toBeNull();
    expect(group(el, "join:held")!.textContent).not.toContain("Sent steak");
    expect(draft.lines.map((line) => line.product.name)).toEqual([
      "Zebra",
      "Apple",
      "Flan",
      "Joined dish",
    ]);
  });

  it("gives only mixed groups quiet course headings, with no selection on a course", async () => {
    const { el } = await mount({ courses });
    const draft = store(el);
    draft.addProduct({ ...flan, courseId: "dessert" }, "1");
    draft.addProduct({ ...beer, courseId: "mains" }, "1");
    draft.addProduct(dish("Bread"), "1");
    draft.setLinePlaces([0, 1, 2], { kind: "new", slot: 1 });
    await el.updateComplete;

    const part = group(el, "new:1");
    expect(part).not.toBeNull();
    expect(
      [...part!.querySelectorAll(".draft-section-name")].map((heading) => heading.textContent),
    ).toEqual(["Mains", "Desserts"]);
    expect(part!.querySelectorAll(".draft-section-name button")).toHaveLength(0);
    expect(
      [...part!.querySelectorAll("[data-draft-select]")].map((row) =>
        row.getAttribute("data-draft-select"),
      ),
    ).toEqual(["2", "1", "0"]);
  });

  it("ticks only a group's unsent rows and reports a partial group selection", async () => {
    const { el } = await mount({ courses, groups: [held("held", 1, 7)] });
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.addProduct(flan, "1");
    draft.addProduct(dish("Other"), "1");
    draft.setLinePlaces([0, 1], { kind: "new", slot: 1 });
    draft.setLinePlaces([2], { kind: "join", groupId: "held" });
    await el.updateComplete;

    expect(tick(el, "new:1")).not.toBeNull();
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "new:1")!);
    await el.updateComplete;
    expect(tick(el, "new:1")!.getAttribute("aria-checked")).toBe("true");
    expect(
      [...root(el).querySelectorAll('[data-draft-select][aria-checked="true"]')].map((row) =>
        row.getAttribute("data-draft-select"),
      ),
    ).toEqual(["0", "1"]);
    expect(tick(el, "join:held")!.getAttribute("aria-checked")).toBe("false");

    await userEvent.click(root(el).querySelector<HTMLButtonElement>('[data-draft-select="0"]')!);
    await el.updateComplete;
    expect(tick(el, "new:1")!.getAttribute("aria-checked")).toBe("mixed");
    await userEvent.click(tick(el, "new:1")!);
    await el.updateComplete;
    expect(tick(el, "new:1")!.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(tick(el, "new:1")!);
    await el.updateComplete;
    expect(root(el).querySelectorAll('[data-draft-select][aria-checked="true"]')).toHaveLength(0);
  });

  it("removes unsent selection when the bill becomes read-only, keeping its arrangement visible", async () => {
    const { el } = await mount();
    const draft = store(el);
    draft.addProduct(beer, "1");
    await el.updateComplete;
    expect(tick(el, "fire")).not.toBeNull();
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "fire")!);
    draft.lockEdits();
    await el.updateComplete;

    expect(group(el, "fire")).not.toBeNull();
    expect(root(el).querySelectorAll("[data-draft-group-select]")).toHaveLength(0);
    expect(root(el).querySelectorAll("[data-draft-select]")).toHaveLength(0);
    const basket = group(el, "fire")!.querySelector<TillBasket>("till-basket")!;
    await basket.updateComplete;
    expect(basket.shadowRoot!.querySelector('[data-draft-row="0"]')!.textContent).toContain("Beer");
  });

  it("keeps Move to quiet until selected, and offers Fire now, every new slot, held targets and a new group", async () => {
    const { el } = await mount({ groups: [held("later", 3, 4), held("first", 1, 7)] });
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.addProduct(flan, "1");
    draft.setLinePlaces([1], { kind: "new", slot: 2 });
    await el.updateComplete;
    expect(move(el)).not.toBeNull();
    expect(move(el)!.disabled).toBe(true);
    expect(move(el)!.variant).toBe("secondary");
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "fire")!);
    await el.updateComplete;
    expect(move(el)!.disabled).toBe(false);
    await userEvent.click(move(el)!);
    await el.updateComplete;
    expect(
      [...root(el).querySelectorAll("[data-draft-move-to]")].map((choice) =>
        choice.getAttribute("data-draft-move-to"),
      ),
    ).toEqual(["fire", "new:2", "join:first", "join:later", "new"]);
    expect(root(el).querySelector('[data-draft-move-to="join:first"]')!.textContent).toContain(
      "Joins Group 7",
    );
    expect(root(el).querySelector('[data-draft-move-to="new"]')!.textContent).toContain(
      "+ New group",
    );
  });

  it("moves exactly the selected rows into an existing slot, retains its held anchor and clears no other placement", async () => {
    const { el } = await mount({ groups: [held("held", 1, 7)] });
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.addProduct(flan, "1");
    draft.addProduct(dish("Other"), "1");
    draft.setLinePlaces([1], { kind: "new", slot: 2, afterGroupId: "held" });
    draft.setLinePlaces([2], { kind: "join", groupId: "held" });
    await el.updateComplete;
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "fire")!);
    await chooseMove(el, "new:2");
    expect(draft.lines.map((line) => line.place)).toEqual([
      { kind: "new", slot: 2, afterGroupId: "held" },
      { kind: "new", slot: 2, afterGroupId: "held" },
      { kind: "join", groupId: "held" },
    ]);
    expect(root(el).querySelector<WtDialog>("[data-draft-move-dialog]")!.open).toBe(false);
  });

  it("inserts a new slot immediately after the last selected source slot, shifting later slots", async () => {
    const { el } = await mount();
    const draft = store(el);
    for (const name of ["A", "B", "C", "D"]) draft.addProduct(dish(name), "1");
    draft.setLinePlaces([0], { kind: "new", slot: 1 });
    draft.setLinePlaces([1, 2], { kind: "new", slot: 3 });
    draft.setLinePlaces([3], { kind: "new", slot: 4 });
    await el.updateComplete;
    await showView(el, "order", { scripted: true });
    await userEvent.click(root(el).querySelector<HTMLButtonElement>('[data-draft-select="0"]')!);
    await userEvent.click(root(el).querySelector<HTMLButtonElement>('[data-draft-select="1"]')!);
    await chooseMove(el, "new");
    expect(draft.lines.map((line) => line.place)).toEqual([
      { kind: "new", slot: 4 },
      { kind: "new", slot: 4 },
      { kind: "new", slot: 3 },
      { kind: "new", slot: 5 },
    ]);
  });

  it("uses firing order for a new group's held anchor, even though joins are displayed after all new groups", async () => {
    const { el } = await mount({ groups: [held("first", 1, 7), held("later", 2, 8)] });
    const draft = store(el);
    for (const name of ["A", "B", "C"]) draft.addProduct(dish(name), "1");
    draft.setLinePlaces([0], { kind: "new", slot: 3, afterGroupId: "later" });
    draft.setLinePlaces([1], { kind: "join", groupId: "first" });
    draft.setLinePlaces([2], { kind: "new", slot: 4 });
    await el.updateComplete;
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "new:3")!);
    await userEvent.click(tick(el, "join:first")!);
    await chooseMove(el, "new");
    expect(draft.lines.map((line) => line.place)).toEqual([
      { kind: "new", slot: 4, afterGroupId: "later" },
      { kind: "new", slot: 4, afterGroupId: "later" },
      { kind: "new", slot: 5 },
    ]);
  });

  it("refuses a move from an open chooser after the bill loses editing authority", async () => {
    const { el } = await mount();
    const draft = store(el);
    draft.addProduct(beer, "1");
    await el.updateComplete;
    expect(move(el)).not.toBeNull();
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "fire")!);
    await userEvent.click(move(el)!);
    await el.updateComplete;
    const oldChoice = root(el).querySelector<WtButton>('[data-draft-move-to="new"]')!;
    draft.lockEdits();
    await el.updateComplete;
    oldChoice.click();
    await el.updateComplete;
    expect(draft.lines[0]!.place).toBeUndefined();
    expect(root(el).querySelector<WtDialog>("[data-draft-move-dialog]")!.open).toBe(false);
  });

  it("keeps the origin label on joins whose permanent number collides after tables join", async () => {
    const { el } = await mount({
      groups: [{ ...held("held", 1, 7), numberPartyLabel: "Table 4" }],
    });
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.setLinePlaces([0], { kind: "join", groupId: "held" });
    await el.updateComplete;
    expect(group(el, "join:held")!.querySelector("[data-draft-group-name]")!.textContent).toContain(
      "Joins Group 7 · Table 4",
    );
  });

  it("moves to a held group, then to Fire now, leaving the other row's stored place intact", async () => {
    const { el } = await mount({ groups: [held("held", 1, 7)] });
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.addProduct(flan, "1");
    draft.setLinePlaces([1], { kind: "new", slot: 2 });
    await el.updateComplete;
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "fire")!);
    await chooseMove(el, "join:held");
    expect(draft.lines.map((line) => line.place)).toEqual([
      { kind: "join", groupId: "held" },
      { kind: "new", slot: 2 },
    ]);
    await chooseMove(el, "fire");
    expect(draft.lines.map((line) => line.place)).toEqual([
      { kind: "fire" },
      { kind: "new", slot: 2 },
    ]);
  });

  it("inserts immediately after a held source and before an existing new slot at that anchor", async () => {
    const { el } = await mount({ groups: [held("held", 1, 7)] });
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.addProduct(flan, "1");
    draft.setLinePlaces([0], { kind: "join", groupId: "held" });
    draft.setLinePlaces([1], { kind: "new", slot: 2, afterGroupId: "held" });
    await el.updateComplete;
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "join:held")!);
    await chooseMove(el, "new");
    expect(draft.lines.map((line) => line.place)).toEqual([
      { kind: "new", slot: 2, afterGroupId: "held" },
      { kind: "new", slot: 3, afterGroupId: "held" },
    ]);
  });

  it("ignores a captured held target after that group fires while the chooser is open", async () => {
    const { el } = await mount({ groups: [held("held", 1, 7)] });
    const draft = store(el);
    draft.addProduct(beer, "1");
    await el.updateComplete;
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "fire")!);
    await userEvent.click(move(el)!);
    await el.updateComplete;
    const oldChoice = root(el).querySelector<WtButton>('[data-draft-move-to="join:held"]')!;
    el.groups = [{ ...held("held", 1, 7), state: "fired" }];
    await el.updateComplete;
    oldChoice.click();
    await el.updateComplete;
    expect(draft.lines[0]!.place).toBeUndefined();
  });

  it("closes the old chooser and drops the old selection when switching away and back to a bill", async () => {
    const { el } = await mount();
    const draft = store(el);
    draft.addProduct(beer, "1");
    await el.updateComplete;
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "fire")!);
    await userEvent.click(move(el)!);
    await el.updateComplete;
    const oldChoice = root(el).querySelector<WtButton>('[data-draft-move-to="new"]')!;
    const other = new DraftStore();
    other.addProduct(flan, "1");
    el.draftStore = other;
    await el.updateComplete;
    oldChoice.click();
    await el.updateComplete;
    expect(draft.lines[0]!.place).toBeUndefined();
    expect(other.lines[0]!.place).toBeUndefined();
    expect(root(el).querySelector<WtDialog>("[data-draft-move-dialog]")!.open).toBe(false);

    el.draftStore = draft;
    await el.updateComplete;
    expect(tick(el, "fire")!.getAttribute("aria-checked")).toBe("false");
    expect(move(el)!.disabled).toBe(true);
  });

  it("ignores a captured new-slot choice after that slot has emptied", async () => {
    const { el } = await mount();
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.addProduct(flan, "1");
    draft.setLinePlaces([1], { kind: "new", slot: 2 });
    await el.updateComplete;
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "fire")!);
    await userEvent.click(move(el)!);
    await el.updateComplete;
    const oldChoice = root(el).querySelector<WtButton>('[data-draft-move-to="new:2"]')!;
    draft.removeLine(1);
    await el.updateComplete;
    oldChoice.click();
    await el.updateComplete;
    expect(draft.lines[0]!.place).toBeUndefined();
    expect(group(el, "new:2")).toBeNull();
  });

  it("keeps the chooser closed after a sending interval, even before native close is reported", async () => {
    const { el } = await mount();
    const draft = store(el);
    draft.addProduct(beer, "1");
    await el.updateComplete;
    await showView(el, "order", { scripted: true });
    await userEvent.click(tick(el, "fire")!);
    await userEvent.click(move(el)!);
    await el.updateComplete;
    draft.sending = true;
    await el.updateComplete;
    draft.sending = false;
    await el.updateComplete;
    expect(root(el).querySelector<WtDialog>("[data-draft-move-dialog]")!.open).toBe(false);
    expect(draft.lines[0]!.place).toBeUndefined();
    expect(tick(el, "fire")!.getAttribute("aria-checked")).toBe("true");
  });
});

describe("New order: compact rows", () => {
  beforeEach(async () => {
    await page.viewport(1280, 1800);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function wide(over: Parameters<typeof mount>[0] = {}) {
    const mounted = await mount(over);
    mounted.el.style.width = "1280px";
    await resized(mounted.el);
    return mounted;
  }
  const basketOf = (el: TillTableOrderScreen, index: number) =>
    [...root(el).querySelectorAll<TillBasket>("till-basket")].find((basket) =>
      basket.lineIndexes?.includes(index),
    )!;
  async function rowOf(el: TillTableOrderScreen, index: number) {
    await el.updateComplete;
    const basket = basketOf(el, index);
    await basket.updateComplete;
    return basket.shadowRoot!.querySelector<HTMLButtonElement>(`[data-draft-row="${index}"]`)!;
  }
  const pickerOf = (el: TillTableOrderScreen, index: number) =>
    basketOf(el, index).shadowRoot!.querySelector("till-modifier-picker");
  function point(target: HTMLElement) {
    const box = target.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  function pointer(target: EventTarget, type: string, at: { x: number; y: number }) {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: 72,
        pointerType: "touch",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: at.x,
        clientY: at.y,
      }),
    );
  }
  async function hold(target: HTMLElement) {
    const at = point(target);
    vi.useFakeTimers();
    pointer(target, "pointerdown", at);
    await vi.advanceTimersByTimeAsync(500);
    return at;
  }

  it("adds a second tap on one dish to its row, which reads 2", async () => {
    const { el } = await wide();
    await tap(el, "Beer");
    await tap(el, "Beer");
    expect(rows(el)).toEqual(["Beer ×2"]);
    const row = await rowOf(el, 0);
    expect(row.querySelector(".row-qty")!.textContent!.trim()).toBe("2");
    expect(
      [...root(el).querySelectorAll<TillBasket>("till-basket")].flatMap((basket) => [
        ...basket.shadowRoot!.querySelectorAll("[data-draft-row]"),
      ]),
    ).toHaveLength(1);
  });

  it("opens the dish in place on a tap on its row, and its details once through Options", async () => {
    const { el } = await wide();
    store(el).addProduct(beer, "1");
    const row = await rowOf(el, 0);
    const open = vi.spyOn(basketOf(el, 0), "openLineDetails");
    await userEvent.click(row);
    await basketOf(el, 0).updateComplete;
    expect(open).not.toHaveBeenCalled();
    expect(pickerOf(el, 0)).toBeNull();
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const options = root(el).querySelector<HTMLElement>(
      '[data-draft-open="0"] [data-draft-open-options]',
    )!;
    await userEvent.click(options);
    await basketOf(el, 0).updateComplete;
    expect(open).toHaveBeenCalledTimes(1);
    expect(pickerOf(el, 0)).not.toBeNull();
  });

  it("does nothing on a row while the order is sending", async () => {
    const { el } = await wide();
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.sending = true;
    const row = await rowOf(el, 0);
    expect(row.disabled).toBe(true);
    row.click();
    await basketOf(el, 0).updateComplete;
    expect(pickerOf(el, 0)).toBeNull();
  });

  it("ticks and unticks the selection box, drawn as the selecting checkbox", async () => {
    const { el } = await wide();
    store(el).addProduct(beer, "1");
    await rowOf(el, 0);
    const select = root(el).querySelector<HTMLButtonElement>('[data-draft-select="0"]')!;
    expect(select.slot).toBe("lead-0");
    expect(select.classList.contains("draft-row-select")).toBe(true);
    expect(select.getAttribute("aria-label")).toBe("Select · Beer ×1");
    expect(select.textContent!.trim()).toBe("");
    const box = select.querySelector<HTMLElement>(".draft-select-box")!;
    const look = getComputedStyle(box);
    const unticked = look.backgroundColor;
    expect([look.width, look.height, look.borderTopWidth, look.borderTopLeftRadius]).toEqual([
      "24px",
      "24px",
      "2px",
      "6px",
    ]);
    const target = select.getBoundingClientRect();
    expect([target.width, target.height].every((side) => side >= 44)).toBe(true);
    const drawn = box.getBoundingClientRect();
    expect(drawn.left - target.left).toBeCloseTo(target.right - drawn.right, 0);
    expect(drawn.top - target.top).toBeCloseTo(target.bottom - drawn.bottom, 0);
    expect(box.hasAttribute("data-ticked")).toBe(false);
    expect(box.querySelector('wt-icon[name="check"]')).toBeNull();

    await userEvent.click(select);
    await el.updateComplete;
    expect(select.getAttribute("aria-checked")).toBe("true");
    const ticked = select.querySelector<HTMLElement>(".draft-select-box")!;
    expect(ticked.hasAttribute("data-ticked")).toBe(true);
    expect(ticked.querySelector('wt-icon[name="check"]')).not.toBeNull();
    expect(getComputedStyle(ticked).backgroundColor).not.toBe(unticked);

    await userEvent.click(select);
    await el.updateComplete;
    expect(select.getAttribute("aria-checked")).toBe("false");
    expect(select.querySelector(".draft-select-box")!.hasAttribute("data-ticked")).toBe(false);
  });

  it("names each selection box by its dish's quantity and note, so two rows of one dish differ", async () => {
    const draft = new DraftStore();
    draft.loadFrom("draft", [
      { product: beer, quantity: "1", place: { kind: "fire" } },
      { product: beer, quantity: "2", place: { kind: "new", slot: 1 } },
      { product: beer, quantity: "2", place: { kind: "new", slot: 2 }, note: "No ice" },
    ]);
    const { el } = await wide({ draftStore: draft });
    await rowOf(el, 2);
    const names = [...root(el).querySelectorAll("[data-draft-select]")].map((box) =>
      box.getAttribute("aria-label"),
    );
    expect(names).toEqual(["Select · Beer ×1", "Select · Beer ×2", "Select · Beer ×2 · No ice"]);
  });

  it("outlines the whole held row, not its selection box, and still moves it when dragged", async () => {
    const draft = new DraftStore();
    draft.loadFrom("draft", [
      { product: beer, quantity: "1", place: { kind: "fire" } },
      { product: flan, quantity: "1", place: { kind: "new", slot: 1 } },
    ]);
    const { el } = await wide({ draftStore: draft });
    const row = await rowOf(el, 1);
    const entry = row.closest<HTMLElement>(".entry")!;
    const select = root(el).querySelector<HTMLElement>('[data-draft-select="1"]')!;
    expect(getComputedStyle(entry).outlineStyle).toBe("none");
    await hold(row);
    await el.updateComplete;
    await basketOf(el, 1).updateComplete;
    expect(getComputedStyle(entry).outlineStyle).not.toBe("none");
    expect(getComputedStyle(select).outlineStyle).toBe("none");
    const at = point(group(el, "fire")!.querySelector<HTMLElement>("h3")!);
    pointer(window, "pointermove", at);
    await el.updateComplete;
    pointer(window, "pointerup", at);
    vi.useRealTimers();
    await el.updateComplete;
    expect(draft.lines[1]!.place).toEqual({ kind: "fire" });
  });

  it.each(["locked", "sending", "in flight on its basket"] as const)(
    "opens no details on a tap that arrives once the order is %s, before it redraws",
    async (state) => {
      const { el } = await wide();
      const draft = store(el);
      draft.addProduct(beer, "1");
      const row = await rowOf(el, 0);
      const basket = basketOf(el, 0);
      const open = vi.spyOn(basket, "openLineDetails");
      if (state === "locked") draft.lockEdits();
      else if (state === "sending") draft.sending = true;
      else basket.orderInFlight = true;
      row.click();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("moves a row pressed and dragged from the row itself, without opening its details", async () => {
    const draft = new DraftStore();
    draft.loadFrom("draft", [
      { product: beer, quantity: "1", place: { kind: "fire" } },
      { product: flan, quantity: "1", place: { kind: "new", slot: 1 } },
    ]);
    const { el } = await wide({ draftStore: draft });
    const row = await rowOf(el, 1);
    const open = vi.spyOn(basketOf(el, 1), "openLineDetails");
    await hold(row);
    const at = point(group(el, "fire")!.querySelector<HTMLElement>("h3")!);
    pointer(window, "pointermove", at);
    await el.updateComplete;
    pointer(window, "pointerup", at);
    row.click();
    vi.useRealTimers();
    await el.updateComplete;
    expect(draft.lines[1]!.place).toEqual({ kind: "fire" });
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the dish's details once on a long press of its row that does not move", async () => {
    const { el } = await wide();
    store(el).addProduct(beer, "1");
    const row = await rowOf(el, 0);
    const open = vi.spyOn(basketOf(el, 0), "openLineDetails");
    const at = await hold(row);
    pointer(window, "pointerup", at);
    row.click();
    vi.useRealTimers();
    await basketOf(el, 0).updateComplete;
    expect(open).toHaveBeenCalledTimes(1);
    expect(pickerOf(el, 0)).not.toBeNull();
  });

  const remove = (el: TillTableOrderScreen) =>
    root(el).querySelector<WtButton>("[data-draft-remove]");
  async function selectRow(el: TillTableOrderScreen, index: number) {
    await rowOf(el, index);
    await userEvent.click(root(el).querySelector<HTMLElement>(`[data-draft-select="${index}"]`)!);
    await el.updateComplete;
  }

  it("removes every selected row from the draft bar, and only those", async () => {
    const { el } = await wide();
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.addProduct(flan, "1");
    draft.addProduct(dish("Other"), "1");
    await selectRow(el, 0);
    await selectRow(el, 2);
    expect(remove(el)!.disabled).toBe(false);
    expect(remove(el)!.textContent!.trim()).toBe("Remove");
    await userEvent.click(remove(el)!);
    await el.updateComplete;
    expect(draft.lines.map((line) => line.product.name)).toEqual(["Flan"]);
    expect(root(el).querySelectorAll('[data-draft-select][aria-checked="true"]')).toHaveLength(0);
    expect(remove(el)!.disabled).toBe(true);
  });

  it("keeps Remove quiet and disabled while no row is selected", async () => {
    const { el } = await wide();
    const draft = store(el);
    draft.addProduct(beer, "1");
    await rowOf(el, 0);
    expect(remove(el)!.disabled).toBe(true);
    expect(remove(el)!.variant).toBe("secondary");
    remove(el)!.click();
    await el.updateComplete;
    expect(draft.lines).toHaveLength(1);
    await selectRow(el, 0);
    expect(remove(el)!.variant).toBe("primary");
  });

  it.each(["sending", "command"])("removes nothing while %s", async (state) => {
    const { el } = await wide();
    const draft = store(el);
    draft.addProduct(beer, "1");
    await selectRow(el, 0);
    const button = remove(el)!;
    if (state === "sending") draft.sending = true;
    else el.groupCommandBusy = true;
    await el.updateComplete;
    expect(button.disabled).toBe(true);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(draft.lines).toHaveLength(1);
  });

  it.each(["locked", "sending", "command"])(
    "removes nothing on a click that arrives once %s starts, before the bar redraws",
    async (state) => {
      const { el } = await wide();
      const draft = store(el);
      draft.addProduct(beer, "1");
      await selectRow(el, 0);
      const button = remove(el)!;
      if (state === "locked") draft.lockEdits();
      else if (state === "sending") draft.sending = true;
      else el.groupCommandBusy = true;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      expect(draft.lines).toHaveLength(1);
      await el.updateComplete;
      expect(root(el).activeElement).not.toBe(root(el).querySelector("#draft-title"));
    },
  );

  it.each([
    ["another dish remains", 2],
    ["the last dish goes", 1],
  ] as const)(
    "puts focus on the order's heading after Remove by keyboard when %s",
    async (_case, count) => {
      const { el } = await wide();
      const draft = store(el);
      draft.addProduct(beer, "1");
      if (count === 2) draft.addProduct(flan, "1");
      await selectRow(el, 0);
      const button = remove(el)!;
      await button.updateComplete;
      button.shadowRoot!.querySelector<HTMLButtonElement>("button")!.focus();
      await userEvent.keyboard("{Enter}");
      expect(draft.lines).toHaveLength(count - 1);
      await vi.waitFor(() =>
        expect(root(el).activeElement).toBe(root(el).querySelector("#draft-title")),
      );
    },
  );

  it("scrolls the last-added row into view", async () => {
    const { el } = await wide();
    await tap(el, "Beer");
    await rowOf(el, 0);
    const scrolled: Element[] = [];
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (
      this: HTMLElement,
    ) {
      scrolled.push(this);
    });
    try {
      await tap(el, "Flan");
      const row = await rowOf(el, 1);
      await vi.waitFor(() => expect(scrolled).toContain(row.closest(".entry")));
      expect(row.closest(".entry")!.hasAttribute("data-last-added")).toBe(true);
    } finally {
      scroll.mockRestore();
    }
  });
});
