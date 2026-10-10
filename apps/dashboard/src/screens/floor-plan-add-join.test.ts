import { afterEach, beforeEach, expect, it } from "vitest";
import type { WtButton, WtFormActions, WtModal } from "@waitron/ui";
import { chooseOption, chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-add-join.js";
import type { FloorPlanAddJoin } from "./floor-plan-add-join.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { FloorPlan } from "../api/client.js";
import {
  deleteTable,
  draftFromPlan,
  patchTable,
  rekeyDraft,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";

let originalLocale = currentLocale();
beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  setLocale(originalLocale);
  cleanupWidgets();
});

const plan: FloorPlan = {
  zoneId: "z1",
  revision: 3,
  savedAt: "2026-10-01T10:00:00.000Z",
  tables: [
    {
      id: "m1",
      liveTableId: "l1",
      label: "T1",
      seats: 4,
      fixed: false,
      placement: { x: 2, y: 3, width: 8, height: 8, shape: "rect", rotation: 0 },
    },
    { id: "m2", liveTableId: "l2", label: "T2", seats: 2, fixed: true, placement: null },
    { id: null, liveTableId: "l9", label: "T9", seats: null, fixed: false, placement: null },
  ],
  joins: [{ id: "j1", seats: 6, tableIds: ["m1", "m2"] }],
};

async function mount(draft: FloorPlanDraft = draftFromPlan(plan)): Promise<FloorPlanAddJoin> {
  let n = 0;
  const { el } = await mountWidget<FloorPlanAddJoin>("floor-plan-add-join", {
    draft,
    nextJoinKey: () => `join:${++n}`,
  });
  await el.updateComplete;
  return el;
}

async function show(el: FloorPlanAddJoin, tableKey = "m1"): Promise<void> {
  el.show(tableKey);
  await el.updateComplete;
  await dialog(el).updateComplete;
}

function listen(el: FloorPlanAddJoin): FloorPlanDraft[] {
  const changes: FloorPlanDraft[] = [];
  el.addEventListener("floor-plan-change", (e) =>
    changes.push((e as CustomEvent<{ draft: FloorPlanDraft }>).detail.draft),
  );
  return changes;
}

const dialog = (el: FloorPlanAddJoin) =>
  el.shadowRoot!.querySelector<WtModal>("wt-modal[data-dialog=add-join]")!;
type Field = HTMLElement & {
  value: string;
  error: string;
  options: { value: string; label: string }[];
};
const field = (el: FloorPlanAddJoin, name: string) =>
  dialog(el).querySelector<Field>(`[name=${name}]`)!;
const confirm = (el: FloorPlanAddJoin) =>
  dialog(el).querySelector<WtButton>("wt-button[data-action=join-confirm]")!;
const formError = (el: FloorPlanAddJoin) =>
  dialog(el).querySelector<WtFormActions>("wt-form-actions")!.error;

it("opens closed until shown, headed Join and its table's name", async () => {
  const el = await mount();
  expect(dialog(el).open).toBe(false);
  await show(el);
  expect(dialog(el).open).toBe(true);
  expect(dialog(el).heading).toBe("Join T1");
  expect(field(el, "join-seats").value).toBe("");
});

it("heads a table with no name Join Unnamed, and a name holding $& as typed", async () => {
  const el = await mount(patchTable(draftFromPlan(plan), "m1", { label: "  " }));
  await show(el);
  expect(dialog(el).heading).toBe("Join Unnamed");
  el.draft = patchTable(draftFromPlan(plan), "m1", { label: "A$&B $1" });
  await el.updateComplete;
  expect(dialog(el).heading).toBe("Join A$&B $1");
});

it("Add join waits for a table and the seats", async () => {
  const el = await mount();
  const changes = listen(el);
  await show(el);
  expect(confirm(el).variant).toBe("secondary");
  expect(confirm(el).disabled).toBe(true);
  await chooseOptions(field(el, "join-tables"), ["live:l9"]);
  await el.updateComplete;
  expect(confirm(el).variant).toBe("secondary");
  expect(confirm(el).disabled).toBe(true);
  await chooseOption(field(el, "join-seats"), "4");
  await el.updateComplete;
  expect(confirm(el).variant).toBe("primary");
  expect(confirm(el).disabled).toBe(false);
  confirm(el).click();
  await el.updateComplete;
  expect(changes).toHaveLength(1);
  expect(changes[0]!.joins.at(-1)).toEqual({
    tableKeys: ["m1", "live:l9"],
    seats: 4,
    key: "join:1",
  });
  await expect.poll(() => dialog(el).open).toBe(false);
});

it("seats alone do not enable Add", async () => {
  const el = await mount();
  await show(el);
  await chooseOption(field(el, "join-seats"), "4");
  await el.updateComplete;
  expect(confirm(el).disabled).toBe(true);
  expect(confirm(el).variant).toBe("secondary");
});

it("a seat count out of range says nothing until Add is pressed, then holds Add and says why", async () => {
  const el = await mount();
  const changes = listen(el);
  await show(el);
  await chooseOptions(field(el, "join-tables"), ["live:l9"]);
  await chooseOption(field(el, "join-seats"), "0");
  await el.updateComplete;
  expect(field(el, "join-seats").error).toBe("");
  expect(formError(el)).toBe("");
  expect(confirm(el).variant).toBe("primary");
  expect(confirm(el).disabled).toBe(false);
  confirm(el).click();
  await el.updateComplete;
  expect(changes).toEqual([]);
  expect(dialog(el).open).toBe(true);
  for (const seats of ["0", "1000", "1.5", "1e1", " 5"]) {
    await chooseOption(field(el, "join-seats"), seats);
    await el.updateComplete;
    expect(confirm(el).disabled).toBe(true);
    expect(field(el, "join-seats").error).toBe("Enter 1 to 999.");
    expect(formError(el)).toBe("Correct the highlighted fields to continue.");
  }
  await chooseOption(field(el, "join-seats"), "999");
  await el.updateComplete;
  expect(field(el, "join-seats").error).toBe("");
  expect(formError(el)).toBe("");
  expect(confirm(el).disabled).toBe(false);
});

it("a refused Add moves focus to the first field it marks", async () => {
  const el = await mount();
  await show(el, "m2");
  await chooseOptions(field(el, "join-tables"), ["m1"]);
  await chooseOption(field(el, "join-seats"), "0");
  await el.updateComplete;
  confirm(el).click();
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(field(el, "join-tables"));
  await chooseOptions(field(el, "join-tables"), ["live:l9"]);
  await el.updateComplete;
  confirm(el).click();
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(field(el, "join-seats"));
});

it("Add join offers the zone's other tables only", async () => {
  const el = await mount();
  await show(el);
  expect(field(el, "join-tables").options).toEqual([
    { value: "m2", label: "T2" },
    { value: "live:l9", label: "T9" },
  ]);
});

it("offers an unnamed table as Unnamed", async () => {
  const el = await mount(patchTable(draftFromPlan(plan), "m2", { label: "  " }));
  await show(el);
  expect(field(el, "join-tables").options[0]).toEqual({ value: "m2", label: "Unnamed" });
});

it("opens empty again after an add", async () => {
  const el = await mount();
  await show(el);
  await chooseOptions(field(el, "join-tables"), ["live:l9"]);
  await chooseOption(field(el, "join-seats"), "6");
  await el.updateComplete;
  confirm(el).click();
  await expect.poll(() => dialog(el).open).toBe(false);
  await show(el, "m2");
  expect(field(el, "join-seats").value).toBe("");
  expect((field(el, "join-tables") as Field & { values: string[] }).values).toEqual([]);
  expect(field(el, "join-tables").options.map((o) => o.value)).toEqual(["m1", "live:l9"]);
});

it("is in Spanish", async () => {
  setLocale("es-ES");
  const el = await mount();
  await show(el);
  expect(dialog(el).heading).toBe("Unir T1");
  expect((field(el, "join-tables") as Field & { label: string }).label).toBe("Mesas");
  expect((field(el, "join-seats") as Field & { label: string }).label).toBe("Plazas");
});

it("holds Add with a reason when the tables are already joined, in any order", async () => {
  const el = await mount();
  const changes = listen(el);
  await show(el, "m2");
  await chooseOptions(field(el, "join-tables"), ["m1"]);
  await chooseOption(field(el, "join-seats"), "8");
  await el.updateComplete;
  expect(field(el, "join-tables").error).toBe("");
  expect(confirm(el).disabled).toBe(false);
  confirm(el).click();
  await el.updateComplete;
  expect(changes).toEqual([]);
  expect(field(el, "join-tables").error).toBe("Already joined.");
  expect(formError(el)).toBe("Correct the highlighted fields to continue.");
  expect(confirm(el).disabled).toBe(true);
  await chooseOptions(field(el, "join-tables"), ["m1", "live:l9"]);
  await el.updateComplete;
  expect(field(el, "join-tables").error).toBe("");
  expect(formError(el)).toBe("");
  expect(confirm(el).disabled).toBe(false);
});

it("says Already joined in Spanish", async () => {
  setLocale("es-ES");
  const el = await mount();
  await show(el);
  await chooseOptions(field(el, "join-tables"), ["m2"]);
  await chooseOption(field(el, "join-seats"), "6");
  await el.updateComplete;
  confirm(el).click();
  await el.updateComplete;
  expect(field(el, "join-tables").error).toBe("Ya están unidas.");
  expect(formError(el)).toBe("Corrige los campos marcados para continuar.");
});

it("opens without messages after a refused Add was cancelled", async () => {
  const el = await mount();
  await show(el);
  await chooseOptions(field(el, "join-tables"), ["m2"]);
  await chooseOption(field(el, "join-seats"), "0");
  await el.updateComplete;
  confirm(el).click();
  await el.updateComplete;
  expect(formError(el)).not.toBe("");
  dialog(el).querySelector<HTMLElement>("wt-button[data-action=join-cancel]")!.click();
  await expect.poll(() => dialog(el).open).toBe(false);
  await closeReportsDelivered();
  await show(el);
  await chooseOptions(field(el, "join-tables"), ["m2"]);
  await chooseOption(field(el, "join-seats"), "0");
  await el.updateComplete;
  expect(field(el, "join-seats").error).toBe("");
  expect(formError(el)).toBe("");
});

it("re-keys its table and chosen tables when the page re-keys its draft", async () => {
  const el = await mount();
  const changes = listen(el);
  await show(el, "live:l9");
  await chooseOptions(field(el, "join-tables"), ["m2"]);
  el.rekey({ "live:l9": "m9", m2: "m2" });
  el.draft = rekeyDraft(el.draft, { "live:l9": "m9" });
  await el.updateComplete;
  expect(field(el, "join-tables").options.map((o) => o.value)).toEqual(["m1", "m2"]);
  await chooseOption(field(el, "join-seats"), "4");
  await el.updateComplete;
  confirm(el).click();
  expect(changes[0]!.joins.at(-1)!.tableKeys).toEqual(["m9", "m2"]);
});

it("adds only the chosen tables the draft still holds", async () => {
  const el = await mount();
  const changes = listen(el);
  await show(el);
  await chooseOptions(field(el, "join-tables"), ["m2", "live:l9"]);
  await chooseOption(field(el, "join-seats"), "4");
  el.draft = deleteTable(el.draft, "m2");
  await el.updateComplete;
  confirm(el).click();
  expect(changes[0]!.joins.at(-1)!.tableKeys).toEqual(["m1", "live:l9"]);
});

it("is not ready when every chosen table has gone from the draft", async () => {
  const el = await mount();
  const changes = listen(el);
  await show(el);
  await chooseOptions(field(el, "join-tables"), ["m2"]);
  await chooseOption(field(el, "join-seats"), "4");
  el.draft = deleteTable(el.draft, "m2");
  await el.updateComplete;
  expect(confirm(el).disabled).toBe(true);
  confirm(el).click();
  expect(changes).toEqual([]);
});

it("closes without adding when its table has gone from the draft", async () => {
  const el = await mount();
  const changes = listen(el);
  await show(el);
  await chooseOptions(field(el, "join-tables"), ["live:l9"]);
  await chooseOption(field(el, "join-seats"), "4");
  await el.updateComplete;
  el.draft = deleteTable(el.draft, "m1");
  confirm(el).click();
  await el.updateComplete;
  expect(changes).toEqual([]);
  await expect.poll(() => dialog(el).open).toBe(false);
});
