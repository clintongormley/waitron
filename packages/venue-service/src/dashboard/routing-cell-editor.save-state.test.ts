import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup } from "@waitron/ui/src/test-helpers.js";
import { mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { RoutingPeriod } from "../routing-types.js";
import type { RoutingCellEditor, RoutingCellEditorCell } from "./routing-cell-editor.js";
import "./routing-cell-editor.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const PERIODS: RoutingPeriod[] = [
  {
    id: "lunch",
    departmentId: "dining",
    departmentName: "Dining",
    name: "Lunch",
    colour: "blue",
    productIds: ["mojito"],
  },
];
const up = { kind: "station", stationId: "up" } as const;
const down = { kind: "station", stationId: "down" } as const;

async function mount(cell: Partial<RoutingCellEditorCell> = {}, isDefaultCell = false) {
  setLocale("en");
  const el = (await mountThemed(
    "<routing-cell-editor></routing-cell-editor>",
  )) as RoutingCellEditor;
  el.cell = {
    address: { row: { kind: "category", categoryId: "cocktails" }, zoneId: null },
    label: "Cocktails, Every zone",
    target: up,
    ...cell,
  };
  el.periods = PERIODS;
  el.stations = [
    { id: "up", name: "Upstairs", active: true },
    { id: "down", name: "Downstairs", active: true },
  ];
  el.rowProductIds = ["mojito"];
  el.isDefaultCell = isDefaultCell;
  el.open = true;
  await el.updateComplete;
  return el;
}

const saveButton = (el: RoutingCellEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-cell]")!;

/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: RoutingCellEditor) {
  await el.updateComplete;
  const save = saveButton(el);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };

async function pickTarget(el: RoutingCellEditor, value: string) {
  el.shadowRoot!.querySelector("[name=target]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function saves(el: RoutingCellEditor) {
  const seen: unknown[] = [];
  el.addEventListener("routing-cell-save", (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

it("opens a stored cell's Save quiet, wakes it on a change and quiets it on undo", async () => {
  const el = await mount({ periods: [{ periodId: "lunch", target: down }] });
  const seen = saves(el);
  expect(await saveState(el)).toEqual(quiet);
  saveButton(el).click();
  await el.updateComplete;
  expect(seen).toEqual([]);
  await pickTarget(el, "station:down");
  expect(await saveState(el)).toEqual(ready);
  await pickTarget(el, "station:up");
  expect(await saveState(el)).toEqual(quiet);
});

it("opens a stored cell with no period lines quiet, whether its lines are absent or empty", async () => {
  expect(await saveState(await mount())).toEqual(quiet);
  expect(await saveState(await mount({ periods: [] }))).toEqual(quiet);
});

it("opens an inherited cell's Save ready, so its choice can be pinned as it stands", async () => {
  const el = await mount({
    inheritedFrom: "Every zone",
    periods: [{ periodId: "lunch", target: down }],
  });
  const seen = saves(el);
  expect(await saveState(el)).toEqual(ready);
  saveButton(el).click();
  await el.updateComplete;
  expect(seen).toEqual([{ target: up, periods: [{ periodId: "lunch", target: down }] }]);
});

it("opens the default cell's Save quiet", async () => {
  const el = await mount(
    { address: { row: { kind: "all" }, zoneId: null }, label: "All categories, Every zone" },
    true,
  );
  expect(await saveState(el)).toEqual(quiet);
  await pickTarget(el, "station:down");
  expect(await saveState(el)).toEqual(ready);
});

it("keeps Save working after a refusal and quiet while saving", async () => {
  const el = await mount();
  await pickTarget(el, "station:down");
  el.refusal = { code: "route.station_inactive", params: { stationId: "down" } };
  expect(await saveState(el)).toEqual(ready);
  el.busy = true;
  expect((await saveState(el)).disabled).toBe(true);
});
