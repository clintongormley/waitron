import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { RoutingPeriod } from "../routing-types.js";
import type { RoutingCellEditor, RoutingCellEditorCell } from "./routing-cell-editor.js";
import "./routing-cell-editor.js";

const dining = { departmentId: "dining", departmentName: "Dining", colour: "blue" as const };
const bar = { departmentId: "bar", departmentName: "Bar", colour: "blue" as const };
const PERIODS: RoutingPeriod[] = [
  { id: "breakfast", ...dining, name: "Breakfast", productIds: ["mojito"] },
  { id: "lunch", ...dining, name: "Lunch", productIds: ["mojito", "bread"] },
  { id: "brunch", ...dining, name: "Brunch", productIds: ["bread"] },
  { id: "bar-lunch", ...bar, name: "Lunch", productIds: ["daiquiri"] },
  { id: "bar-late", ...bar, name: "Late", productIds: ["bread"] },
  {
    id: "old-lunch",
    departmentId: "old",
    departmentName: "Old",
    departmentInactive: true,
    colour: "blue",
    name: "Lunch",
    productIds: ["mojito"],
  },
];
const STATIONS = [
  { id: "up", name: "Upstairs", active: true },
  { id: "down", name: "Downstairs", active: true },
  { id: "off", name: "Off", active: false },
];
const up = { kind: "station", stationId: "up" } as const;
const down = { kind: "station", stationId: "down" } as const;
const cocktails = { kind: "category", categoryId: "cocktails" } as const;

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

async function mount(
  cell: Partial<RoutingCellEditorCell> = {},
  options: {
    zoneDepartmentId?: string | null;
    zoneWithoutDepartment?: boolean;
    isDefaultCell?: boolean;
    rowProductIds?: string[];
  } = {},
) {
  const el = document.createElement("routing-cell-editor");
  el.cell = {
    address: {
      row: cocktails,
      zoneId: options.zoneDepartmentId || options.zoneWithoutDepartment ? "terrace" : null,
    },
    label: "Cocktails, Terrace",
    target: up,
    ...cell,
  };
  el.periods = PERIODS;
  el.stations = STATIONS;
  el.rowProductIds = options.rowProductIds ?? ["mojito", "daiquiri"];
  el.zoneDepartmentId = options.zoneDepartmentId ?? null;
  el.zoneWithoutDepartment = options.zoneWithoutDepartment ?? false;
  el.isDefaultCell = options.isDefaultCell ?? false;
  el.open = true;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

type Combobox = HTMLElementTagNameMap["wt-combobox"];
const all = <T extends Element = Combobox>(el: RoutingCellEditor, selector: string) => [
  ...el.shadowRoot!.querySelectorAll<T>(selector),
];
const one = <T extends Element = HTMLElement>(el: RoutingCellEditor, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const linePeriods = (el: RoutingCellEditor) => all(el, "[name=line-periods]");
const lineTargets = (el: RoutingCellEditor) => all(el, "[name=line-target]");
const offered = (field: Combobox) => field.options.map((option) => option.value);
const button = (el: RoutingCellEditor, test: string) =>
  one<HTMLElementTagNameMap["wt-button"]>(el, `[data-test=${test}]`);
const bottom = (el: RoutingCellEditor) =>
  one<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error;

async function pick(el: RoutingCellEditor, field: Combobox, detail: object) {
  field.dispatchEvent(new CustomEvent("wt-change", { detail, bubbles: true, composed: true }));
  await el.updateComplete;
}
async function click(el: RoutingCellEditor, test: string) {
  button(el, test)!.click();
  await el.updateComplete;
}
function events(el: RoutingCellEditor, name: string) {
  const seen: unknown[] = [];
  el.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

it("offers a zone column its department's periods that meet the row, ungrouped", async () => {
  const el = await mount({}, { zoneDepartmentId: "dining" });
  await click(el, "add-line");
  const [periods] = linePeriods(el);
  expect(periods!.multiple).toBe(true);
  expect(offered(periods!)).toEqual(["breakfast", "lunch"]);
  expect(periods!.options.every((option) => option.group === undefined)).toBe(true);
});

it("offers Every zone every active department's periods that meet the row, grouped by department", async () => {
  const el = await mount();
  await click(el, "add-line");
  const [periods] = linePeriods(el);
  expect(periods!.options).toEqual([
    { value: "breakfast", label: "Breakfast", group: "Dining" },
    { value: "lunch", label: "Lunch", group: "Dining", valueLabel: "Lunch (Dining)" },
    { value: "bar-lunch", label: "Lunch", group: "Bar", valueLabel: "Lunch (Bar)" },
  ]);
});

it("offers the station choices beside each line and for any other time", async () => {
  const el = await mount();
  await click(el, "add-line");
  const expected = [
    { value: "station:up", label: "Upstairs" },
    { value: "station:down", label: "Downstairs" },
    { value: "no_preparation", label: "No preparation" },
  ];
  expect(lineTargets(el)[0]!.options).toEqual(expected);
  expect(one<Combobox>(el, "[name=target]")!.options).toEqual(expected);
  expect(one<Combobox>(el, "[name=target]")!.label).toBe("Any other time");
  expect(one<Combobox>(el, "[name=target]")!.required).toBe(true);
});

it("keeps a stored line's period offered in the line holding its stored target after its menus drop the row", async () => {
  const el = await mount({ periods: [{ periodId: "brunch", target: down }] });
  const [periods] = linePeriods(el);
  expect(periods!.values).toEqual(["brunch"]);
  expect(lineTargets(el)[0]!.value).toBe("station:down");
  expect(offered(periods!)).toEqual(["breakfast", "lunch", "brunch", "bar-lunch"]);
  await pick(el, periods!, { values: [] });
  expect(offered(linePeriods(el)[0]!)).toContain("brunch");
  await click(el, "add-line");
  expect(offered(linePeriods(el)[1]!)).not.toContain("brunch");
});

it("still shows a stored line naming a switched-off department's period", async () => {
  const el = await mount({ periods: [{ periodId: "old-lunch", target: down }] });
  const [periods] = linePeriods(el);
  expect(periods!.values).toEqual(["old-lunch"]);
  expect(periods!.options.find((option) => option.value === "old-lunch")).toEqual({
    value: "old-lunch",
    label: "Lunch",
    group: "Old",
    valueLabel: "Lunch (Old)",
  });
  await click(el, "add-line");
  expect(offered(linePeriods(el)[1]!)).not.toContain("old-lunch");
});

it("does not offer a period one line holds in another line", async () => {
  const el = await mount({ periods: [{ periodId: "lunch", target: down }] });
  await click(el, "add-line");
  expect(offered(linePeriods(el)[1]!)).toEqual(["breakfast", "bar-lunch"]);
  await pick(el, linePeriods(el)[1]!, { values: ["breakfast"] });
  expect(offered(linePeriods(el)[0]!)).toEqual(["lunch", "bar-lunch"]);
});

it("groups stored lines by target and saves an added line with the cell's choice", async () => {
  const el = await mount({
    periods: [
      { periodId: "lunch", target: down },
      { periodId: "breakfast", target: down },
    ],
  });
  expect(linePeriods(el).map((field) => field.values)).toEqual([["breakfast", "lunch"]]);
  const saves = events(el, "routing-cell-save");
  await click(el, "add-line");
  await pick(el, linePeriods(el)[1]!, { values: ["bar-lunch"] });
  await pick(el, lineTargets(el)[1]!, { value: "no_preparation" });
  await click(el, "save-cell");
  expect(saves).toEqual([
    {
      target: up,
      periods: [
        { periodId: "breakfast", target: down },
        { periodId: "lunch", target: down },
        { periodId: "bar-lunch", target: { kind: "no_preparation" } },
      ],
    },
  ]);
});

it("saves two lines naming one station as that station's periods", async () => {
  const el = await mount();
  await click(el, "add-line");
  await click(el, "add-line");
  await pick(el, linePeriods(el)[0]!, { values: ["lunch"] });
  await pick(el, lineTargets(el)[0]!, { value: "station:down" });
  await pick(el, linePeriods(el)[1]!, { values: ["breakfast"] });
  await pick(el, lineTargets(el)[1]!, { value: "station:down" });
  const saves = events(el, "routing-cell-save");
  await click(el, "save-cell");
  expect(saves).toEqual([
    {
      target: up,
      periods: [
        { periodId: "lunch", target: down },
        { periodId: "breakfast", target: down },
      ],
    },
  ]);
});

it("Remove takes a line away and saving sends no lines", async () => {
  const el = await mount({ periods: [{ periodId: "lunch", target: down }] });
  const saves = events(el, "routing-cell-save");
  await click(el, "remove-line");
  expect(linePeriods(el)).toEqual([]);
  await click(el, "save-cell");
  expect(saves).toEqual([{ target: up, periods: [] }]);
});

it("marks an unfinished line and blocks Save until it is fixed", async () => {
  const el = await mount();
  const saves = events(el, "routing-cell-save");
  await click(el, "add-line");
  await click(el, "save-cell");
  expect(saves).toEqual([]);
  expect(linePeriods(el)[0]!.error).toBe("Choose at least one period.");
  expect(lineTargets(el)[0]!.error).toBe("Choose a station.");
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(button(el, "save-cell")!.disabled).toBe(true);
  await pick(el, linePeriods(el)[0]!, { values: ["lunch"] });
  await pick(el, lineTargets(el)[0]!, { value: "station:down" });
  expect(bottom(el)).toBe("");
  await click(el, "save-cell");
  expect(saves).toEqual([{ target: up, periods: [{ periodId: "lunch", target: down }] }]);
});

it("requires a station for any other time", async () => {
  const el = await mount({ target: null, inheritedFrom: "Every zone" });
  const saves = events(el, "routing-cell-save");
  await click(el, "save-cell");
  expect(saves).toEqual([]);
  expect(one<Combobox>(el, "[name=target]")!.error).toBe("Choose a station.");
});

it("offers Clear only for a stored cell, and Clear asks the screen to clear it", async () => {
  const stored = await mount();
  const clears = events(stored, "routing-cell-clear");
  await click(stored, "clear-cell");
  expect(clears).toHaveLength(1);
  const inherited = await mount({ inheritedFrom: "Every zone" });
  expect(button(inherited, "clear-cell")).toBeNull();
});

it("gives the default cell no period lines and no Clear, and offers it stations only", async () => {
  const el = await mount(
    { address: { row: { kind: "all" }, zoneId: null }, label: "All categories, Every zone" },
    { isDefaultCell: true },
  );
  expect(button(el, "add-line")).toBeNull();
  expect(button(el, "clear-cell")).toBeNull();
  expect(offered(one<Combobox>(el, "[name=target]")!)).toEqual(["station:up", "station:down"]);
});

it("shows a stored switched-off or unknown station as a disabled choice", async () => {
  const el = await mount({ target: { kind: "station", stationId: "off" } });
  expect(one<Combobox>(el, "[name=target]")!.options).toContainEqual({
    value: "station:off",
    label: "Off (Disabled)",
    disabled: true,
  });
  const gone = await mount({
    periods: [{ periodId: "lunch", target: { kind: "station", stationId: "gone" } }],
  });
  expect(lineTargets(gone)[0]!.options).toContainEqual({
    value: "station:gone",
    label: "station:gone",
    disabled: true,
  });
});

it("drops a line's period the model no longer lists, without counting it as a change", async () => {
  const el = await mount({
    periods: [
      { periodId: "deleted", target: down },
      { periodId: "lunch", target: down },
    ],
  });
  expect(linePeriods(el).map((field) => field.values)).toEqual([["lunch"]]);
  expect(button(el, "save-cell")!.disabled).toBe(true);
  const inherited = await mount({
    inheritedFrom: "Every zone",
    periods: [{ periodId: "deleted", target: down }],
  });
  expect(linePeriods(inherited)).toEqual([]);
  expect(one(inherited, "[data-test=not-copied]")).toBeNull();
});

it("ignores every change and action while saving", async () => {
  const el = await mount({ periods: [{ periodId: "lunch", target: down }] });
  const fired: string[] = [];
  for (const name of ["routing-cell-save", "routing-cell-clear", "routing-cell-close"])
    el.addEventListener(name, () => fired.push(name));
  await pick(el, one<Combobox>(el, "[name=target]")!, { value: "station:down" });
  el.busy = true;
  await el.updateComplete;
  await pick(el, one<Combobox>(el, "[name=target]")!, { value: "no_preparation" });
  await pick(el, linePeriods(el)[0]!, { values: [] });
  await pick(el, lineTargets(el)[0]!, { value: "station:up" });
  for (const test of ["remove-line", "add-line", "clear-cell", "cancel-cell", "save-cell"])
    await click(el, test);
  expect(one<Combobox>(el, "[name=target]")!.value).toBe("station:down");
  expect(linePeriods(el).map((field) => [field.values, field.disabled])).toEqual([
    [["lunch"], true],
  ]);
  expect(lineTargets(el)[0]!.value).toBe("station:down");
  expect([fired, el.open]).toEqual([[], true]);
});

it("puts a not_offered refusal under the line holding its period, until that line changes", async () => {
  const el = await mount({
    periods: [
      { periodId: "lunch", target: down },
      { periodId: "brunch", target: up },
    ],
  });
  await pick(el, one<Combobox>(el, "[name=target]")!, { value: "station:down" });
  el.refusal = {
    code: "route.period_invalid",
    params: { periodId: "brunch", reason: "not_offered" },
  };
  await el.updateComplete;
  const [, brunchLine] = linePeriods(el);
  expect(brunchLine!.values).toEqual(["brunch"]);
  expect(brunchLine!.error).toBe("Brunch offers none of these products.");
  expect(linePeriods(el)[0]!.error).toBe("");
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(button(el, "save-cell")!.disabled).toBe(false);
  await pick(el, lineTargets(el)[1]!, { value: "station:down" });
  expect(linePeriods(el)[1]!.error).toBe("");
  expect(bottom(el)).toBe("");
});

it("words the other refusals of a period under its line", async () => {
  const el = await mount({ periods: [{ periodId: "bar-lunch", target: down }] });
  el.refusal = {
    code: "route.period_invalid",
    params: { periodId: "bar-lunch", reason: "other_department" },
  };
  await el.updateComplete;
  expect(linePeriods(el)[0]!.error).toBe("Lunch is another department's.");
  el.refusal = {
    code: "route.period_invalid",
    params: { periodId: "bar-lunch", reason: "repeated" },
  };
  await el.updateComplete;
  expect(linePeriods(el)[0]!.error).toBe("Lunch is in two lines.");
});

it("puts a refusal naming no shown line at the bottom", async () => {
  const el = await mount();
  el.refusal = { code: "route.period_invalid", params: { periodId: "gone", reason: "repeated" } };
  await el.updateComplete;
  expect(bottom(el)).toBe("The change could not be saved.");
  el.refusal = { code: "route.station_inactive", params: { stationId: "off" } };
  await el.updateComplete;
  expect(bottom(el)).toBe("This station is disabled. Choose an active station.");
});

it("Cancel closes and tells the screen", async () => {
  const el = await mount();
  const cancels = events(el, "routing-cell-close");
  const modal = one<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!;
  const closed = new Promise((resolve) =>
    modal.addEventListener("wt-close", resolve, { once: true }),
  );
  await click(el, "cancel-cell");
  await closed;
  await expect.poll(() => cancels.length).toBe(1);
  await expect.poll(() => el.open).toBe(false);
});

it("names where an inherited choice comes from", async () => {
  const el = await mount({ inheritedFrom: "Every zone" });
  expect(one(el, "[data-test=inherited-from]")!.textContent!.trim()).toBe("From Every zone");
  const stored = await mount();
  expect(one(stored, "[data-test=inherited-from]")).toBeNull();
});

it("a Terrace cell inheriting two departments' Lunches keeps only its department's", async () => {
  const el = await mount(
    {
      inheritedFrom: "Every zone",
      periods: [
        { periodId: "lunch", target: down },
        { periodId: "bar-lunch", target: down },
      ],
    },
    { zoneDepartmentId: "dining" },
  );
  expect(linePeriods(el).map((field) => field.values)).toEqual([["lunch"]]);
  expect(one(el, "[data-test=not-copied]")!.textContent!.trim()).toBe(
    "Not copied: Lunch (Bar) — another department's",
  );
  const saves = events(el, "routing-cell-save");
  await click(el, "save-cell");
  expect(saves).toEqual([{ target: up, periods: [{ periodId: "lunch", target: down }] }]);
});

it("offers a zone that serves no department no period lines, and copies none it inherits", async () => {
  const el = await mount(
    { inheritedFrom: "Every zone", periods: [{ periodId: "lunch", target: down }] },
    { zoneWithoutDepartment: true },
  );
  expect(button(el, "add-line")).toBeNull();
  expect(linePeriods(el)).toEqual([]);
  expect(one(el, "[data-test=not-copied]")!.textContent!.trim()).toBe(
    "Not copied: Lunch (Dining) — another department's",
  );
  const saves = events(el, "routing-cell-save");
  await click(el, "save-cell");
  expect(saves).toEqual([{ target: up, periods: [] }]);
});

it("leaves out an inherited period whose menus dropped the row's products", async () => {
  const el = await mount({
    inheritedFrom: "Every zone",
    periods: [
      { periodId: "lunch", target: down },
      { periodId: "brunch", target: down },
    ],
  });
  expect(linePeriods(el).map((field) => field.values)).toEqual([["lunch"]]);
  expect(one(el, "[data-test=not-copied]")!.textContent!.trim()).toBe(
    "Not copied: Brunch — offers none of these products",
  );
  const saves = events(el, "routing-cell-save");
  await click(el, "save-cell");
  expect(saves).toEqual([{ target: up, periods: [{ periodId: "lunch", target: down }] }]);
});

it("leaves out a category's Lunch from a product row Lunch does not offer, and names both reasons", async () => {
  const el = await mount(
    {
      address: { row: { kind: "product", productId: "daiquiri" }, zoneId: "terrace" },
      label: "Daiquiri, Terrace",
      inheritedFrom: "Cocktails",
      periods: [
        { periodId: "lunch", target: down },
        { periodId: "breakfast", target: up },
        { periodId: "bar-late", target: down },
      ],
    },
    { zoneDepartmentId: "dining", rowProductIds: ["daiquiri"] },
  );
  expect(linePeriods(el)).toEqual([]);
  expect(one(el, "[data-test=not-copied]")!.textContent!.trim()).toBe(
    "Not copied: Breakfast — offers none of these products; Lunch — offers none of these products; Late (Bar) — another department's",
  );
  const saves = events(el, "routing-cell-save");
  await click(el, "save-cell");
  expect(saves).toEqual([{ target: up, periods: [] }]);
});

it("shows no left-out line when every inherited period is kept", async () => {
  const el = await mount({
    inheritedFrom: "Every zone",
    periods: [{ periodId: "lunch", target: down }],
  });
  expect(one(el, "[data-test=not-copied]")).toBeNull();
});

it("speaks Spanish", async () => {
  setLocale("es");
  const el = await mount({ inheritedFrom: "Todas las zonas" });
  expect(one<Combobox>(el, "[name=target]")!.label).toBe("El resto del tiempo");
  expect(button(el, "add-line")!.textContent!.trim()).toBe("+ Otra estación en algunos periodos");
  expect(one(el, "[data-test=inherited-from]")!.textContent!.trim()).toBe("De Todas las zonas");
});

it("keeps the draft and a refusal when handed a new object for the same cell, and starts afresh for another cell", async () => {
  const el = await mount({
    periods: [
      { periodId: "lunch", target: down },
      { periodId: "brunch", target: up },
    ],
  });
  await pick(el, one<Combobox>(el, "[name=target]")!, { value: "station:down" });
  el.refusal = {
    code: "route.period_invalid",
    params: { periodId: "brunch", reason: "not_offered" },
  };
  await el.updateComplete;
  el.cell = { ...el.cell!, address: { ...el.cell!.address } };
  await el.updateComplete;
  expect(one<Combobox>(el, "[name=target]")!.value).toBe("station:down");
  expect(linePeriods(el)[1]!.error).toBe("Brunch offers none of these products.");
  expect(button(el, "save-cell")!.disabled).toBe(false);
  el.refusal = { code: "route.station_inactive", params: { stationId: "off" } };
  el.cell = { ...el.cell!, periods: [...el.cell!.periods!] };
  await el.updateComplete;
  expect(one<Combobox>(el, "[name=target]")!.value).toBe("station:down");
  expect(bottom(el)).toBe("This station is disabled. Choose an active station.");
  el.cell = {
    ...el.cell!,
    address: { row: { kind: "product", productId: "mojito" }, zoneId: null },
  };
  await el.updateComplete;
  expect(one<Combobox>(el, "[name=target]")!.value).toBe("station:up");
  expect(bottom(el)).toBe("");
  expect(button(el, "save-cell")!.disabled).toBe(true);
});

it("offers a stored period only in a line with its stored station", async () => {
  const el = await mount({ periods: [{ periodId: "brunch", target: down }] });
  await pick(el, linePeriods(el)[0]!, { values: [] });
  await click(el, "add-line");
  await pick(el, lineTargets(el)[1]!, { value: "station:up" });
  expect(offered(linePeriods(el)[1]!)).not.toContain("brunch");
  await pick(el, lineTargets(el)[1]!, { value: "station:down" });
  expect(offered(linePeriods(el)[1]!)).toContain("brunch");
});

const removeNames = (el: RoutingCellEditor) =>
  all<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=remove-line]").map((remove) =>
    remove.shadowRoot!.querySelector("button")!.getAttribute("aria-label"),
  );

it("names a period another offered period shares a name with by its department, and only then", async () => {
  const el = await mount({
    periods: [
      { periodId: "lunch", target: down },
      { periodId: "breakfast", target: down },
      { periodId: "bar-lunch", target: up },
    ],
  });
  const [first, second] = linePeriods(el);
  expect(first!.countLabel(2)).toBe("Breakfast, Lunch (Dining)");
  expect(second!.options.find((option) => option.value === "bar-lunch")!.valueLabel).toBe(
    "Lunch (Bar)",
  );
  expect(second!.options.find((option) => option.value === "bar-lunch")!.label).toBe("Lunch");
  const zone = await mount(
    { periods: [{ periodId: "lunch", target: down }] },
    { zoneDepartmentId: "dining" },
  );
  expect(linePeriods(zone)[0]!.options.every((option) => option.valueLabel === undefined)).toBe(
    true,
  );
  expect(removeNames(zone)).toEqual(["Remove Lunch"]);
});

it("names each line's Remove by its periods, or by its place while it has none", async () => {
  const el = await mount({
    periods: [
      { periodId: "lunch", target: down },
      { periodId: "breakfast", target: down },
      { periodId: "bar-lunch", target: up },
    ],
  });
  await click(el, "add-line");
  expect(removeNames(el)).toEqual([
    "Remove Breakfast, Lunch (Dining)",
    "Remove Lunch (Bar)",
    "Remove line 3",
  ]);
  setLocale("es");
  const es = await mount({ periods: [{ periodId: "bar-lunch", target: up }] });
  await click(es, "add-line");
  expect(removeNames(es)).toEqual(["Quitar Lunch (Bar)", "Quitar línea 2"]);
});

it("says in Spanish which inherited periods were not copied", async () => {
  setLocale("es");
  const el = await mount({
    inheritedFrom: "Todas las zonas",
    periods: [{ periodId: "brunch", target: down }],
  });
  expect(one(el, "[data-test=not-copied]")!.textContent!.trim()).toBe(
    "Sin copiar: Brunch — no ofrece ninguno de estos productos",
  );
});

it("takes a period deleted live out of the draft, keeps the other edits, and says so", async () => {
  const el = await mount({
    periods: [
      { periodId: "lunch", target: down },
      { periodId: "breakfast", target: up },
      { periodId: "brunch", target: up },
    ],
  });
  expect(linePeriods(el).map((field) => field.values)).toEqual([
    ["breakfast", "brunch"],
    ["lunch"],
  ]);
  await pick(el, one<Combobox>(el, "[name=target]")!, { value: "station:down" });
  el.periods = PERIODS.filter((period) => period.id !== "lunch" && period.id !== "brunch");
  el.cell = { ...el.cell!, periods: [{ periodId: "breakfast", target: up }] };
  await el.updateComplete;
  expect(linePeriods(el).map((field) => field.values)).toEqual([["breakfast"]]);
  expect(one<Combobox>(el, "[name=target]")!.value).toBe("station:down");
  expect(one(el, "[data-test=periods-removed]")!.textContent!.trim()).toBe(
    "Periods deleted: Lunch (Dining), Brunch",
  );
  const saves = events(el, "routing-cell-save");
  await click(el, "save-cell");
  expect(saves).toEqual([{ target: down, periods: [{ periodId: "breakfast", target: up }] }]);
});

it("stays quiet when a stored period nobody changed is deleted live", async () => {
  const el = await mount({ periods: [{ periodId: "lunch", target: down }] });
  el.periods = PERIODS.filter((period) => period.id !== "lunch");
  el.cell = { ...el.cell!, periods: [] };
  await el.updateComplete;
  expect(linePeriods(el)).toEqual([]);
  expect(el.dirty).toBe(false);
  expect(button(el, "save-cell")!.disabled).toBe(true);
});

it("drops a refusal naming a period deleted live and still draws", async () => {
  const el = await mount({ periods: [{ periodId: "brunch", target: down }] });
  el.refusal = {
    code: "route.period_invalid",
    params: { periodId: "brunch", reason: "not_offered" },
  };
  await el.updateComplete;
  expect(linePeriods(el)[0]!.error).toBe("Brunch offers none of these products.");
  el.periods = PERIODS.filter((period) => period.id !== "brunch");
  el.cell = { ...el.cell!, periods: [] };
  await el.updateComplete;
  expect(linePeriods(el)).toEqual([]);
  expect(bottom(el)).toBe("");
  expect(one(el, "[data-test=periods-removed]")!.textContent!.trim()).toBe(
    "Periods deleted: Brunch",
  );
});

it("says in Spanish which deleted periods were taken out", async () => {
  setLocale("es");
  const el = await mount({ periods: [{ periodId: "bar-lunch", target: down }] });
  el.periods = PERIODS.filter((period) => period.id !== "bar-lunch");
  await el.updateComplete;
  expect(one(el, "[data-test=periods-removed]")!.textContent!.trim()).toBe(
    "Periodos eliminados: Lunch (Bar)",
  );
});
