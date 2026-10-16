import { afterEach, beforeEach, expect, it } from "vitest";
import type { ComboboxOption, WtButton, WtFormActions, WtModal } from "@waitron/ui";
import { chooseOption, chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-add-joined-table.js";
import type { FloorPlanAddJoinedTable } from "./floor-plan-add-joined-table.js";
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

const placement = { x: 2, y: 3, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

const table = (key: string, label: string, seats: number | null, more: Partial<DraftTable> = {}) =>
  ({
    key,
    id: key,
    liveTableId: null,
    label,
    seats,
    fixed: false,
    placement: null,
    parts: null,
    keptSize: null,
    ...more,
  }) satisfies DraftTable;

const draft: FloorPlanDraft = {
  tables: [
    table("s2", "Stool 2", 1),
    table("c5", "Counter 5", 4),
    table("c1", "Counter 1", 4, { placement }),
    table("c3", "Counter 3", 2),
    table("c8", "Counter 8", 2),
    table("c9", "Counter 9", 2),
    table("bar", "Bar", 4, { parts: ["c8", "c9"] }),
    table("c4", "Counter 4", 6),
  ],
};

function listen(el: FloorPlanAddJoinedTable) {
  const changes: FloorPlanDraft[] = [];
  el.addEventListener("floor-plan-change", (e) =>
    changes.push((e as CustomEvent<{ draft: FloorPlanDraft }>).detail.draft),
  );
  return { changes };
}

async function openAdd(props: Partial<FloorPlanAddJoinedTable> = {}) {
  let n = 0;
  const { el } = await mountWidget<FloorPlanAddJoinedTable>("floor-plan-add-joined-table", {
    draft,
    nextKey: () => `new:${++n}`,
    ...props,
  });
  await el.updateComplete;
  el.show();
  await el.updateComplete;
  await dialog(el).updateComplete;
  return el;
}

const dialog = (el: FloorPlanAddJoinedTable) =>
  el.shadowRoot!.querySelector<WtModal>("wt-modal[data-dialog=add-joined-table]")!;
const field = (el: FloorPlanAddJoinedTable, name: string) =>
  dialog(el).querySelector<HTMLElement & { value: string; error: string; label: string }>(
    `[name=${name}]`,
  )!;
const madeOf = (el: FloorPlanAddJoinedTable) =>
  dialog(el).querySelector<
    HTMLElement & {
      options: ComboboxOption[];
      values: string[];
      error: string;
      label: string;
      placeholder: string;
      countLabel: (count: number) => string;
    }
  >("[name=made-of]")!;
const addButton = (el: FloorPlanAddJoinedTable) =>
  dialog(el).querySelector<WtButton>("wt-button[data-action=add-confirm]")!;
const formError = (el: FloorPlanAddJoinedTable) =>
  dialog(el).querySelector<WtFormActions>("wt-form-actions")!.error;

async function set(el: FloorPlanAddJoinedTable, name: string, value: string): Promise<void> {
  await chooseOption(field(el, name), value);
  await el.updateComplete;
}

async function choose(el: FloorPlanAddJoinedTable, keys: string[]): Promise<void> {
  await chooseOptions(madeOf(el), keys);
  await el.updateComplete;
}

async function pressAdd(el: FloorPlanAddJoinedTable): Promise<void> {
  addButton(el).click();
  await el.updateComplete;
}

const errors = (el: FloorPlanAddJoinedTable) => [
  field(el, "table-name").error,
  field(el, "seats").error,
  madeOf(el).error,
];

it("offers the tables off the plan and in no joined table, in number order, each with its seats", async () => {
  const el = await openAdd();
  expect(dialog(el).heading).toBe("Add joined table");
  expect(addButton(el).textContent!.trim()).toBe("Save");
  expect(madeOf(el).label).toBe("Made of");
  expect(
    madeOf(el).options.map(({ value, label, description }) => ({ value, label, description })),
  ).toEqual([
    { value: "c3", label: "Counter 3", description: "2 seats" },
    { value: "c4", label: "Counter 4", description: "6 seats" },
    { value: "c5", label: "Counter 5", description: "4 seats" },
    { value: "s2", label: "Stool 2", description: "1 seat" },
  ]);
  expect(madeOf(el).countLabel(3)).toBe("3 tables");
});

it("opens a standard-width modal at the medium height", async () => {
  const el = await openAdd();
  expect(dialog(el).getAttribute("size")).toBe("standard");
  expect(dialog(el).getAttribute("height")).toBe("medium");
});

it("gives a table with no seat count no seats line", async () => {
  const el = await openAdd({ draft: { tables: [table("c3", "Counter 3", null)] } });
  expect(madeOf(el).options).toEqual([{ value: "c3", label: "Counter 3" }]);
});

it("says so when no table is off the plan", async () => {
  const el = await openAdd({ draft: { tables: [table("c1", "Counter 1", 4, { placement })] } });
  expect(madeOf(el).options).toEqual([]);
  expect(madeOf(el).placeholder).toBe("No tables off the plan.");
});

it("opens empty, with Save quiet and disabled", async () => {
  const el = await openAdd();
  expect(dialog(el).open).toBe(true);
  expect(field(el, "table-name").value).toBe("");
  expect(field(el, "seats").value).toBe("");
  expect(madeOf(el).values).toEqual([]);
  expect(addButton(el).variant).toBe("secondary");
  expect(addButton(el).disabled).toBe(true);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this proves
// the handler itself does nothing for an untouched window.
it("Save pressed while unchanged does nothing", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await pressAdd(el);
  expect(changes).toEqual([]);
  expect(errors(el)).toEqual(["", "", ""]);
  expect(formError(el)).toBe("");
  expect(dialog(el).open).toBe(true);
});

it("marks Name, Seats and Made of required", async () => {
  const el = await openAdd();
  for (const name of ["table-name", "seats", "made-of"]) {
    expect(field(el, name).hasAttribute("required")).toBe(true);
  }
  expect(field(el, "seats").hasAttribute("clearable")).toBe(false);
});

it("names every field", async () => {
  const el = await openAdd();
  const names = [...dialog(el).querySelectorAll("[name]")].map((f) => f.getAttribute("name"));
  expect(names).toEqual(["table-name", "seats", "made-of"]);
});

it("after a change, Save with fields missing explains each field and keeps Save disabled until fixed", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, "table-name", "Long table");
  expect(addButton(el).variant).toBe("primary");
  expect(addButton(el).disabled).toBe(false);
  await pressAdd(el);
  expect(errors(el)).toEqual(["", "Enter 1 to 999.", "Choose at least 2 tables."]);
  expect(formError(el)).toBe("Correct the highlighted fields to continue.");
  expect(addButton(el).disabled).toBe(true);
  await set(el, "seats", "10");
  expect(errors(el)).toEqual(["", "", "Choose at least 2 tables."]);
  expect(addButton(el).disabled).toBe(true);
  await set(el, "table-name", " ");
  expect(errors(el)).toEqual(["Enter a name.", "", "Choose at least 2 tables."]);
  await set(el, "table-name", "Long table");
  await choose(el, ["c3", "c4"]);
  expect(errors(el)).toEqual(["", "", ""]);
  expect(formError(el)).toBe("");
  expect(addButton(el).disabled).toBe(false);
  expect(changes).toEqual([]);
});

it("a refused Save moves focus to the first field it marks", async () => {
  const el = await openAdd();
  await set(el, "table-name", "Long table");
  await pressAdd(el);
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(field(el, "seats"));
});

it("refuses one table, 0 seats and 1000 seats", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, "table-name", "Long table");
  await choose(el, ["c3"]);
  await set(el, "seats", "0");
  await pressAdd(el);
  expect(errors(el)).toEqual(["", "Enter 1 to 999.", "Choose at least 2 tables."]);
  await set(el, "seats", "1000");
  expect(field(el, "seats").error).toBe("Enter 1 to 999.");
  await set(el, "seats", "2.5");
  expect(field(el, "seats").error).toBe("Enter 1 to 999.");
  await set(el, "seats", "999");
  expect(field(el, "seats").error).toBe("");
  expect(changes).toEqual([]);
});

it("refuses a name another table has", async () => {
  const el = await openAdd({ takenElsewhere: new Set(["Patio 9"]) });
  const { changes } = listen(el);
  await set(el, "seats", "10");
  await choose(el, ["c3", "c4"]);
  for (const name of ["Counter 1", " Bar", "Patio 9"]) {
    await set(el, "table-name", name);
    await pressAdd(el);
    expect(field(el, "table-name").error).toBe("A table with that name already exists");
  }
  expect(changes).toEqual([]);
});

it("adds Long table, 10 seats, made of Counter 3, 4 and 5, at the first free spot", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, "table-name", " Long table ");
  await set(el, "seats", "10");
  await choose(el, ["c3", "c4", "c5"]);
  await pressAdd(el);
  expect(changes).toHaveLength(1);
  expect(changes[0]!.tables.slice(0, draft.tables.length)).toEqual(draft.tables);
  expect(changes[0]!.tables.slice(draft.tables.length)).toEqual([
    {
      key: "new:1",
      id: null,
      liveTableId: null,
      label: "Long table",
      seats: 10,
      fixed: false,
      placement: { x: 11, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 },
      parts: ["c3", "c4", "c5"],
      keptSize: null,
    },
  ]);
  await expect.poll(() => dialog(el).open).toBe(false);
});

it("opens afresh after an add", async () => {
  const el = await openAdd();
  await set(el, "table-name", "Long table");
  await set(el, "seats", "10");
  await choose(el, ["c3", "c4"]);
  await pressAdd(el);
  el.show();
  await el.updateComplete;
  expect(field(el, "table-name").value).toBe("");
  expect(madeOf(el).values).toEqual([]);
  expect(addButton(el).disabled).toBe(true);
});

it("speaks Spanish", async () => {
  setLocale("es-ES");
  const el = await openAdd();
  expect(dialog(el).heading).toBe("Añadir mesa unida");
  expect(madeOf(el).label).toBe("Formada por");
  expect(madeOf(el).options.map((o) => o.description)).toEqual([
    "2 plazas",
    "6 plazas",
    "4 plazas",
    "1 plaza",
  ]);
  expect(madeOf(el).countLabel(3)).toBe("3 mesas");
  await set(el, "table-name", "Mesa larga");
  await pressAdd(el);
  expect(errors(el)).toEqual(["", "Escribe de 1 a 999.", "Elige al menos 2 mesas."]);
  const none = await openAdd({ draft: { tables: [] } });
  expect(madeOf(none).placeholder).toBe("No hay mesas fuera del plano.");
});

it("A671: a full plan keeps the joined-table form and its values open until a place is available", async () => {
  const full = {
    tables: draft.tables.map((t) =>
      t.key === "c1"
        ? {
            ...t,
            placement: { ...placement, x: 0, y: 0, width: 999, height: 999 },
          }
        : t,
    ),
  };
  const el = await openAdd({ draft: full });
  const { changes } = listen(el);
  await set(el, "table-name", "Long table");
  await set(el, "seats", "10");
  await choose(el, ["c3", "c4", "c5"]);
  await pressAdd(el);
  expect(changes).toEqual([]);
  expect(dialog(el).open).toBe(true);
  expect(formError(el)).toBe("No room on the plan.");
  expect(field(el, "table-name").value).toBe("Long table");
  expect(madeOf(el).values).toEqual(["c3", "c4", "c5"]);
  expect(addButton(el).disabled).toBe(false);
  await set(el, "table-name", "Long table 2");
  expect(formError(el)).toBe("");
  await pressAdd(el);
  expect(changes).toEqual([]);
  expect(formError(el)).toBe("No room on the plan.");
  el.draft = draft;
  await el.updateComplete;
  await pressAdd(el);
  expect(changes).toHaveLength(1);
  expect(changes[0]!.tables.at(-1)!.placement).not.toBeNull();
  expect(dialog(el).open).toBe(false);
});

it("A747 prefills the selected tables total and saves it unchanged", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await choose(el, ["c3", "c4"]);
  expect(field(el, "seats").value).toBe("8");
  await choose(el, ["c3", "c4", "c5"]);
  expect(field(el, "seats").value).toBe("12");
  await set(el, "table-name", "Together");
  await pressAdd(el);
  expect(changes[0]!.tables.find((table) => table.key === "new:1")!.seats).toBe(12);
});

it("A747 keeps a manually edited total when the parts change", async () => {
  const el = await openAdd();
  await choose(el, ["c3", "c4"]);
  expect(field(el, "seats").value).toBe("8");
  await set(el, "seats", "7");
  await choose(el, ["c3", "c4", "c5"]);
  expect(field(el, "seats").value).toBe("7");
});

it.each([
  { a: 700, b: 600, want: "999" },
  { a: 0, b: 0, want: "1" },
  { a: null, b: 6, want: "" },
])("A747 defaults $a plus $b as $want", async ({ a, b, want }) => {
  const el = await openAdd({ draft: { tables: [table("a", "A", a), table("b", "B", b)] } });
  await choose(el, ["a", "b"]);
  expect(field(el, "seats").value).toBe(want);
});

it("A747 reopening after a manually edited add suggests totals again", async () => {
  const el = await openAdd();
  await choose(el, ["c3", "c4"]);
  await set(el, "seats", "7");
  await set(el, "table-name", "Together");
  await pressAdd(el);
  expect(dialog(el).open).toBe(false);
  el.show();
  await el.updateComplete;
  await choose(el, ["c3", "c4"]);
  expect(field(el, "seats").value).toBe("8");
});
