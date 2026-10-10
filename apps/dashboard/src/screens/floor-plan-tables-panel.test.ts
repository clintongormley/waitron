import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-tables-panel.js";
import type { FloorPlanTablesPanel } from "./floor-plan-tables-panel.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { DraftTable, FloorPlanDraft } from "./floor-plan-draft.js";

let originalLocale = currentLocale();
beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  setLocale(originalLocale);
  cleanupWidgets();
});

const table = (key: string, label: string, placed = false): DraftTable => ({
  key,
  id: key,
  liveTableId: null,
  label,
  seats: null,
  fixed: false,
  placement: placed ? { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } : null,
});

const draft: FloorPlanDraft = {
  tables: [
    table("m1", "Terrace 1", true),
    table("m2", "Terrace 10"),
    table("m3", "Terrace 2"),
    table("m4", "Terrace bar 3"),
  ],
  joins: [],
};

async function mount(props: Partial<FloorPlanTablesPanel> = {}) {
  const mounted = await mountWidget<FloorPlanTablesPanel>("floor-plan-tables-panel", {
    draft,
    ...props,
  });
  await mounted.el.updateComplete;
  return mounted;
}

async function open(props: Partial<FloorPlanTablesPanel> = {}): Promise<FloorPlanTablesPanel> {
  return (await mount(props)).el;
}

const rows = (el: FloorPlanTablesPanel) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-table]"),
];
const row = (el: FloorPlanTablesPanel, label: string) =>
  rows(el).find((r) => r.textContent!.trim() === label)!;

function listen(el: FloorPlanTablesPanel) {
  const changes: FloorPlanDraft[] = [];
  const selects: (string | null)[] = [];
  el.addEventListener("floor-plan-change", (e) =>
    changes.push((e as CustomEvent<{ draft: FloorPlanDraft }>).detail.draft),
  );
  el.addEventListener("floor-plan-select", (e) =>
    selects.push((e as CustomEvent<{ key: string | null }>).detail.key),
  );
  return { changes, selects };
}

it("lists the tables in numeric order, placed ones muted", async () => {
  const el = await open();
  expect(el.shadowRoot!.querySelector("h2")!.textContent!.trim()).toBe("Tables");
  expect(rows(el).map((r) => r.textContent!.trim())).toEqual([
    "Terrace 1",
    "Terrace 2",
    "Terrace 10",
    "Terrace bar 3",
  ]);
  expect(
    rows(el)
      .filter((r) => r.hasAttribute("data-placed"))
      .map((r) => r.textContent!.trim()),
  ).toEqual(["Terrace 1"]);
});

it("pressing an unplaced table places it at the first free spot and selects it", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  row(el, "Terrace 2").click();
  expect(changes).toHaveLength(1);
  expect(changes[0]!.tables.find((t) => t.key === "m3")!.placement).toEqual({
    x: 9,
    y: 0,
    width: 8,
    height: 8,
    shape: "rect",
    rotation: 0,
  });
  expect(selects).toEqual(["m3"]);
});

it("pressing a placed table selects it and changes nothing", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  row(el, "Terrace 1").click();
  expect(selects).toEqual(["m1"]);
  expect(changes).toEqual([]);
});

it("paints a placed table's row in the muted text colour", async () => {
  const { el, host } = await mount();
  host.style.setProperty("--wt-color-text-muted", "rgb(41, 42, 43)");
  host.style.setProperty("--wt-color-text", "rgb(11, 12, 13)");
  const inner = (label: string) => row(el, label).shadowRoot!.querySelector("button")!;
  expect(getComputedStyle(inner("Terrace 1")).color).toBe("rgb(41, 42, 43)");
  expect(getComputedStyle(inner("Terrace 2")).color).toBe("rgb(11, 12, 13)");
});

it("names a table with a blank name Unnamed", async () => {
  const el = await open({
    draft: { tables: [table("m1", "  "), table("m2", "Terrace 1")], joins: [] },
  });
  expect(rows(el).map((r) => r.textContent!.trim())).toEqual(["Unnamed", "Terrace 1"]);
});

it("leaves out its heading inside a sheet, whose toggle already names it", async () => {
  const el = await open({ inSheet: true });
  expect(el.shadowRoot!.querySelector("h2")).toBeNull();
});

it("writes a refused table's reason after its name in the error colour", async () => {
  const el = await open({ refused: { key: "m2", reason: "Booked 12 Oct, 21:00" } });
  el.style.setProperty("--wt-color-danger", "rgb(7, 8, 9)");
  const refusedRow = rows(el).find((r) => r.dataset.table === "m2")!;
  expect(refusedRow.textContent!.trim()).toBe("Terrace 10 — Booked 12 Oct, 21:00");
  expect(getComputedStyle(refusedRow.querySelector(".refused")!).color).toBe("rgb(7, 8, 9)");
  expect(row(el, "Terrace 2").querySelector(".refused")).toBeNull();
});
