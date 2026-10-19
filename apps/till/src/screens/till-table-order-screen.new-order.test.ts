import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { OrderGroup } from "../api/client.js";
import type { WtButton, WtDialog } from "@waitron/ui";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { beer, flan, mount, store } from "./till-table-order-screen.test-helpers.js";
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
  { id: "mains", name: "Mains", displayOrder: 1, heldUntilFired: true },
  { id: "dessert", name: "Desserts", displayOrder: 2, heldUntilFired: true },
];
const dish = (name: string, courseId: string | null = null) => ({
  ...beer,
  id: name,
  menuItemId: `offer-${name}`,
  name,
  courseId,
});
async function openReview(el: TillTableOrderScreen) {
  root(el).querySelector<HTMLElement>("[data-review-open]")!.click();
  await el.updateComplete;
}
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
      await openReview(el);
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
      expect(root(el).querySelectorAll('[data-draft-select][aria-pressed="true"]')).toHaveLength(1);
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
    await openReview(el);
    await userEvent.click(tick(el, "new:1")!);
    await el.updateComplete;
    expect(tick(el, "new:1")!.getAttribute("aria-checked")).toBe("true");
    expect(
      [...root(el).querySelectorAll('[data-draft-select][aria-pressed="true"]')].map((row) =>
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
    expect(root(el).querySelectorAll('[data-draft-select][aria-pressed="true"]')).toHaveLength(0);
  });

  it("removes unsent selection when the bill becomes read-only, keeping its arrangement visible", async () => {
    const { el } = await mount();
    const draft = store(el);
    draft.addProduct(beer, "1");
    await el.updateComplete;
    expect(tick(el, "fire")).not.toBeNull();
    await openReview(el);
    await userEvent.click(tick(el, "fire")!);
    draft.lockEdits();
    await el.updateComplete;

    expect(group(el, "fire")).not.toBeNull();
    expect(root(el).querySelectorAll("[data-draft-group-select]")).toHaveLength(0);
    expect(root(el).querySelectorAll("[data-draft-select]")).toHaveLength(0);
    expect(group(el, "fire")!.textContent).toContain("Beer");
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
    await openReview(el);
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
    await openReview(el);
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
    await openReview(el);
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
    await openReview(el);
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
    await openReview(el);
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
    await openReview(el);
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
    await openReview(el);
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
    await openReview(el);
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
    await openReview(el);
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
    await openReview(el);
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
    await openReview(el);
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
