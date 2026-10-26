import { CALENDAR_COLOURS } from "../hours-types.js";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtColourChooser } from "@waitron/ui/src/components/wt-colour-chooser.js";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host, mount as mountHtml } from "@waitron/ui/src/test-helpers.js";
import {
  refusalOf,
  type StationEditor,
  type StationEditorSave,
  type StationEditorStation,
} from "./station-editor.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const GRILL: StationEditorStation = {
  id: "grill",
  name: "Grill",
  colour: "orange",
  active: true,
  showsRestOfOrder: false,
  printMovedSlips: true,
  ticketGrouping: "combined",
  printHeldWork: false,
  bumpMode: "line",
  changesAfterSending: "held-or-waiting",
  printerIds: ["epson"],
  warmAfterMinutes: 5,
  overdueAfterMinutes: 12,
  forgottenAfterMinutes: 15,
  readyWarningAfterMinutes: 3,
};

const STATIONS = [
  { id: "grill", name: "Grill", colour: "orange" as const },
  { id: "bar", name: "Bar", colour: "blue" as const },
  { id: "pizza", name: "Pizza oven", colour: "orange" as const },
];

async function mount(
  station: StationEditorStation = GRILL,
  { canManagePrinters = true, locale = "en" as "en" | "es" } = {},
) {
  setLocale(locale);
  const el = (await mountHtml("<prep-station-editor></prep-station-editor>")) as StationEditor;
  el.station = station;
  el.printers = [
    { id: "epson", name: "Epson" },
    { id: "star", name: "Star" },
    { id: "old", name: "Old printer", active: false },
    { id: "pass", name: "Pass printer" },
  ];
  el.stations = STATIONS;
  el.canManagePrinters = canManagePrinters;
  el.open = true;
  await el.updateComplete;
  return el;
}

const $ = <T extends Element = HTMLElement>(el: StationEditor, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const nameField = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-input"]>(el, "wt-input[name=stationName]")!;
const printersField = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-combobox"]>(el, "wt-combobox[name=printerIds]");
const restSwitch = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-switch"]>(el, "wt-switch[name=showsRestOfOrder]")!;
const movedField = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-combobox"]>(el, "wt-combobox[name=printMovedSlips]")!;
const groupingField = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-combobox"]>(el, "wt-combobox[name=ticketGrouping]")!;
const bumpField = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-combobox"]>(el, "wt-combobox[name=bumpMode]")!;
const changesField = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-combobox"]>(el, "wt-combobox[name=changesAfterSending]")!;
const heldSwitch = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-switch"]>(el, "wt-switch[name=printHeldWork]")!;
const saveButton = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save-station-edit]")!;
const timingField = (el: StationEditor, name: string) =>
  $<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name=${name}]`)!;
const formMessage = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error;

async function rename(el: StationEditor, value: string) {
  nameField(el).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}
async function setTiming(el: StationEditor, name: string, value: string) {
  timingField(el, name).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}
async function pickPrinters(el: StationEditor, values: string[]) {
  printersField(el)!.dispatchEvent(new CustomEvent("wt-change", { detail: { values } }));
  await el.updateComplete;
}
async function flipRest(el: StationEditor, checked: boolean) {
  restSwitch(el).dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
  await el.updateComplete;
}
async function pickMoved(el: StationEditor, value: string) {
  movedField(el).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}
function saves(el: StationEditor) {
  const seen: StationEditorSave[] = [];
  el.addEventListener("station-save", (event) =>
    seen.push((event as CustomEvent<StationEditorSave>).detail),
  );
  return seen;
}
const picker = (el: StationEditor) => $<WtColourChooser>(el, "wt-colour-chooser[name=colour]")!;
const tile = (el: StationEditor, colour: string) =>
  picker(el).shadowRoot!.querySelector<HTMLButtonElement>(`[role=radio][data-value="${colour}"]`)!;
async function pickColour(el: StationEditor, colour: string) {
  picker(el).show();
  await userEvent.click(tile(el, colour));
  await el.updateComplete;
}
async function save(el: StationEditor) {
  $(el, "[data-test=save-station-edit]")!.click();
  await el.updateComplete;
}

it("opens with the station's name, printers and rest-of-order choice, the name required", async () => {
  const el = await mount({ ...GRILL, showsRestOfOrder: true });
  expect($(el, "wt-modal")!.getAttribute("heading")).toBe("Edit station");
  expect(nameField(el).value).toBe("Grill");
  expect(nameField(el).required).toBe(true);
  expect(printersField(el)!.multiple).toBe(true);
  expect(printersField(el)!.values).toEqual(["epson"]);
  expect(restSwitch(el).checked).toBe(true);
  expect(restSwitch(el).label).toBe("Also list the order's dishes from other stations");
});

it("sends the name, printers and rest-of-order choice in one save", async () => {
  const el = await mount();
  const seen = saves(el);
  await rename(el, "  Hot grill ");
  await pickPrinters(el, ["epson", "star"]);
  await flipRest(el, true);
  await save(el);
  expect(seen).toEqual([
    { name: "Hot grill", printerIds: ["epson", "star"], showsRestOfOrder: true },
  ]);
});

it("sends only what changed, so a name change carries no printers", async () => {
  const el = await mount();
  const seen = saves(el);
  await rename(el, "Hot grill");
  await save(el);
  await pickPrinters(el, ["star"]);
  await save(el);
  expect(seen).toEqual([{ name: "Hot grill" }, { name: "Hot grill", printerIds: ["star"] }]);
});

it("offers every active printer, and keeps a chosen disabled one", async () => {
  const el = await mount({ ...GRILL, printerIds: ["epson", "old"] });
  const options = printersField(el)!.options;
  expect(options.map(({ value, disabled }) => [value, !!disabled])).toEqual([
    ["epson", false],
    ["star", false],
    ["old", false],
    ["pass", false],
  ]);
  expect(options.find((option) => option.value === "old")!.description).toBe("Disabled");
  expect(options.find((option) => option.value === "pass")!.description).toBeUndefined();
});

it.each([
  ["without printer.manage", GRILL, false],
  ["for a switched-off station", { ...GRILL, active: false }, true],
] as const)("shows printers as a read-out %s and never sends them", async (_, station, can) => {
  const el = await mount({ ...station, printerIds: ["epson", "star"] }, { canManagePrinters: can });
  const seen = saves(el);
  expect(printersField(el)).toBeNull();
  const readout = $(el, "[data-test=station-printers]")!;
  expect(readout.textContent).toContain("Printers");
  expect(readout.textContent).toContain("Epson, Star");
  await rename(el, "Hot grill");
  await flipRest(el, true);
  await save(el);
  expect(seen).toEqual([{ name: "Hot grill", showsRestOfOrder: true }]);
});

it("reads None for a station that prints nowhere", async () => {
  const el = await mount({ ...GRILL, printerIds: [] }, { canManagePrinters: false });
  expect($(el, "[data-test=station-printers]")!.textContent).toContain("None");
});

it("explains a blank name beside the field and above the buttons, and sends nothing", async () => {
  const el = await mount();
  const seen = saves(el);
  await rename(el, "  ");
  await save(el);
  expect(seen).toEqual([]);
  expect(nameField(el).error).toBe("Enter a name.");
  expect(formMessage(el)).toBe("Correct the highlighted fields to continue.");
  expect($<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save-station-edit]")!.disabled).toBe(
    true,
  );
  await rename(el, "Grill two");
  expect(nameField(el).error).toBe("");
  expect(formMessage(el)).toBe("");
});

it.each([
  ["printer.not_found", { printerId: "star" }],
  ["management.request_invalid", { field: "printerIds" }],
] as const)("puts a %s refusal under Printers", async (code, params) => {
  const el = await mount();
  await pickPrinters(el, ["star"]);
  el.refusal = { code, params };
  await el.updateComplete;
  expect(printersField(el)!.error).toBe("Choose active printers.");
  expect(nameField(el).error).toBe("");
  expect(formMessage(el)).toBe("Correct the highlighted fields to continue.");
  await pickPrinters(el, ["epson", "star"]);
  expect(printersField(el)!.error).toBe("");
  expect(formMessage(el)).toBe("");
});

it("puts a printer.manage refusal under Printers", async () => {
  const el = await mount();
  await pickPrinters(el, ["star"]);
  el.refusal = { code: "authorization.not_permitted", params: { permission: "printer.manage" } };
  await el.updateComplete;
  expect(printersField(el)!.error).toBe("You can't change printers.");
  expect(formMessage(el)).toBe("Correct the highlighted fields to continue.");
});

it("puts a taken name under the name and anything else above the buttons", async () => {
  const el = await mount();
  await rename(el, "Bar");
  el.refusal = { code: "station.name_taken" };
  await el.updateComplete;
  expect(nameField(el).error).toBe("This name is already in use.");
  expect(printersField(el)!.error).toBe("");
  el.refusal = { code: "connection.failed" };
  await el.updateComplete;
  expect(nameField(el).error).toBe("");
  expect(formMessage(el)).toBe("The change could not be saved.");
  el.refusal = { code: "station.not_found", params: { stationId: "grill" } };
  await el.updateComplete;
  expect(formMessage(el)).toBe("The change could not be saved. This station could not be found.");
});

it("closes once saved, or stays open on an edit made while saving", async () => {
  const el = await mount();
  await rename(el, "Hot grill");
  await save(el);
  await rename(el, "Hotter grill");
  expect(el.saved()).toBe(false);
  await el.updateComplete;
  expect($<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.open).toBe(true);
  expect(el.dirty).toBe(true);
  await save(el);
  expect(el.saved()).toBe(true);
  expect(el.dirty).toBe(false);
});

it("reads in Spanish", async () => {
  const el = await mount(GRILL, { locale: "es" });
  expect($(el, "wt-modal")!.getAttribute("heading")).toBe("Editar estación");
  expect(printersField(el)!.label).toBe("Impresoras");
  expect(restSwitch(el).label).toBe("Mostrar también los platos del pedido de otras estaciones");
});

it("ignores a cancel and a save while busy", async () => {
  const el = await mount();
  const seen = saves(el);
  await rename(el, "Hot grill");
  el.busy = true;
  await el.updateComplete;
  await save(el);
  expect(seen).toEqual([]);
  expect(await $<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.requestClose("cancel")).toBe(
    false,
  );
});

it("tells its host when it is cancelled", async () => {
  const el = await mount();
  let cancelled = 0;
  el.addEventListener("station-close", () => cancelled++);
  const modal = $<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!;
  const closed = new Promise((resolve) =>
    modal.addEventListener("wt-close", resolve, { once: true }),
  );
  $(el, "[data-test=cancel-station-edit]")!.click();
  await closed;
  await expect.poll(() => cancelled).toBe(1);
  expect(el.open).toBe(false);
});

it("names a printer it cannot find by its id", async () => {
  const el = await mount({ ...GRILL, printerIds: ["gone"] }, { canManagePrinters: false });
  expect($(el, "[data-test=station-printers]")!.textContent).toContain("gone");
});

it("does not close on a saved() with no save sent", async () => {
  const el = await mount();
  expect(el.saved()).toBe(false);
  expect(el.open).toBe(true);
});

it("reads a refusal's code and params, and a bare rejection as a server failure", () => {
  expect(refusalOf({ code: "printer.not_found", params: { id: "x" } })).toEqual({
    code: "printer.not_found",
    params: { id: "x" },
  });
  expect(refusalOf("boom")).toEqual({ code: "server.internal" });
  expect(refusalOf({ code: "station.name_taken", params: "odd" })).toEqual({
    code: "station.name_taken",
  });
});

it("keeps a printer choice it can no longer send out of the save when the station is switched off meanwhile", async () => {
  const el = await mount();
  const seen = saves(el);
  await pickPrinters(el, ["star"]);
  el.station = { ...GRILL, active: false };
  await el.updateComplete;
  expect(printersField(el)).toBeNull();
  expect($(el, "[data-test=station-printers]")!.textContent).toContain("Epson");
  expect($(el, "[data-test=station-printers]")!.textContent).not.toContain("Star");
  expect(el.shadowRoot!.textContent).toContain("Enable the station to change its printers.");
  const button = $<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save-station-edit]")!;
  expect(button.disabled).toBe(true);
  expect(button.variant).toBe("secondary");
  await save(el);
  expect(seen).toEqual([]);
  expect(el.open).toBe(true);
  await rename(el, "Hot grill");
  expect(button.disabled).toBe(false);
  expect(button.variant).toBe("primary");
  await save(el);
  expect(seen).toEqual([{ name: "Hot grill" }]);
  expect(el.saved()).toBe(false);
  expect(el.dirty).toBe(true);
});

const TIMINGS = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;
const STATION_MINUTES = [...TIMINGS, "readyWarningAfterMinutes"] as const;
it("opens on the station's own minutes, each required, with no placeholder and no venue note", async () => {
  const el = await mount();
  expect(STATION_MINUTES.map((name) => timingField(el, name).value)).toEqual([
    "5",
    "12",
    "15",
    "3",
  ]);
  expect(STATION_MINUTES.map((name) => timingField(el, name).placeholder)).toEqual([
    "",
    "",
    "",
    "",
  ]);
  expect(STATION_MINUTES.map((name) => timingField(el, name).label)).toEqual([
    "Waiting",
    "Overdue",
    "Forgotten",
    "Ready warning",
  ]);
  for (const name of STATION_MINUTES) {
    expect(timingField(el, name).required).toBe(true);
    expect(timingField(el, name).type).toBe("number");
    expect(timingField(el, name).hint).toBe("");
  }
  expect($(el, "#timing-inheritance")).toBeNull();
});

it("a cleared minutes field is marked beside it and at the bottom and sends nothing", async () => {
  const el = await mount();
  const seen = saves(el);
  await setTiming(el, "warmAfterMinutes", "");
  await save(el);
  expect(seen).toEqual([]);
  expect(timingField(el, "warmAfterMinutes").error).toBe(
    "Use whole minutes with waiting < overdue < forgotten.",
  );
  expect(formMessage(el)).toBe("Correct the highlighted fields to continue.");
  expect(saveButton(el).disabled).toBe(true);
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(timingField(el, "warmAfterMinutes"));
  await setTiming(el, "warmAfterMinutes", "4");
  await save(el);
  expect(seen).toEqual([{ warmAfterMinutes: 4 }]);
});

it("sends a typed minute, and nothing for a minute typed back as its stored value", async () => {
  const el = await mount();
  const seen = saves(el);
  await setTiming(el, "warmAfterMinutes", "3");
  await save(el);
  expect(seen).toEqual([{ warmAfterMinutes: 3 }]);
  expect(el.saved()).toBe(true);
  const again = await mount();
  const seenAgain = saves(again);
  await setTiming(again, "warmAfterMinutes", "05");
  expect(saveButton(again).disabled).toBe(true);
  await save(again);
  expect(seenAgain).toEqual([]);
});

it("sends a rename and a timing in one save", async () => {
  const el = await mount();
  const seen = saves(el);
  await rename(el, "Pass");
  await setTiming(el, "forgottenAfterMinutes", "20");
  await save(el);
  expect(seen).toEqual([{ name: "Pass", forgottenAfterMinutes: 20 }]);
});

it.each(["0", "1.5", "abc", "2147483648"])(
  "marks Waiting for %s, explains it at the bottom, sends nothing and focuses it",
  async (value) => {
    const el = await mount();
    const seen = saves(el);
    await setTiming(el, "warmAfterMinutes", value);
    await save(el);
    expect(seen).toEqual([]);
    expect(timingField(el, "warmAfterMinutes").error).toBe(
      "Use whole minutes with waiting < overdue < forgotten.",
    );
    expect(timingField(el, "overdueAfterMinutes").error).toBe("");
    expect(formMessage(el)).toBe("Correct the highlighted fields to continue.");
    const button = $<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save-station-edit]")!;
    expect(button.disabled).toBe(true);
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(timingField(el, "warmAfterMinutes"));
    await setTiming(el, "warmAfterMinutes", "4");
    expect(timingField(el, "warmAfterMinutes").error).toBe("");
    expect(formMessage(el)).toBe("");
    expect(button.disabled).toBe(false);
    await save(el);
    expect(seen).toEqual([{ warmAfterMinutes: 4 }]);
  },
);

it("holds the timings in order against the station's own minutes", async () => {
  const warm = await mount();
  const seen = saves(warm);
  await setTiming(warm, "warmAfterMinutes", "12");
  await save(warm);
  expect(seen).toEqual([]);
  expect(timingField(warm, "warmAfterMinutes").error).toBe("");
  expect(timingField(warm, "overdueAfterMinutes").error).toBe(
    "Use whole minutes with waiting < overdue < forgotten.",
  );

  const forgotten = await mount();
  await setTiming(forgotten, "overdueAfterMinutes", "16");
  await save(forgotten);
  expect(timingField(forgotten, "overdueAfterMinutes").error).toBe("");
  expect(timingField(forgotten, "forgottenAfterMinutes").error).toBe(
    "Use whole minutes with waiting < overdue < forgotten.",
  );
});

it.each([
  ["station.thresholds_invalid", "overdueAfterMinutes"],
  ["management.request_invalid", "forgottenAfterMinutes"],
] as const)("puts a %s refusal naming %s under that field", async (code, field) => {
  const el = await mount();
  await setTiming(el, "warmAfterMinutes", "3");
  el.refusal = { code, params: { field } };
  await el.updateComplete;
  expect(timingField(el, field).error).toBe(
    "Use whole minutes with waiting < overdue < forgotten.",
  );
  expect(nameField(el).error).toBe("");
  expect(formMessage(el)).toBe("Correct the highlighted fields to continue.");
  expect($<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save-station-edit]")!.disabled).toBe(
    false,
  );
});

it("puts a connection failure at the bottom only, marking no timing", async () => {
  const el = await mount();
  await setTiming(el, "warmAfterMinutes", "3");
  el.refusal = { code: "connection.failed" };
  await el.updateComplete;
  expect(TIMINGS.map((name) => timingField(el, name).error)).toEqual(["", "", ""]);
  expect(formMessage(el)).toBe("The change could not be saved.");
});

it("reads the timings in Spanish", async () => {
  const el = await mount(GRILL, { locale: "es" });
  expect(TIMINGS.map((name) => timingField(el, name).label)).toEqual([
    "Esperando",
    "Con retraso",
    "Olvidado",
  ]);
  await setTiming(el, "warmAfterMinutes", "0");
  await save(el);
  expect(timingField(el, "warmAfterMinutes").error).toBe(
    "Usa minutos enteros con esperando < con retraso < olvidado.",
  );
  expect(timingField(el, "warmAfterMinutes").hint).toBe("");
});

it("explains timings out of order in Spanish beside the field and at the bottom, and sends nothing", async () => {
  const el = await mount(
    { ...GRILL, warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
    { locale: "es" },
  );
  const seen = saves(el);
  await setTiming(el, "warmAfterMinutes", "10");
  await save(el);
  expect(seen).toEqual([]);
  expect(timingField(el, "warmAfterMinutes").error).toBe("");
  expect(timingField(el, "overdueAfterMinutes").error).toBe(
    "Usa minutos enteros con esperando < con retraso < olvidado.",
  );
  expect(formMessage(el)).toBe("Corrige los campos marcados para continuar.");
  const button = $<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save-station-edit]")!;
  expect(button.disabled).toBe(true);
  await expect
    .poll(() => el.shadowRoot!.activeElement)
    .toBe(timingField(el, "overdueAfterMinutes"));
  await setTiming(el, "warmAfterMinutes", "9");
  expect(timingField(el, "overdueAfterMinutes").error).toBe("");
  expect(formMessage(el)).toBe("");
  expect(button.disabled).toBe(false);
});

it("saves and reloads a colour", async () => {
  const el = await mount();
  const seen = saves(el);
  expect(tile(el, "orange").getAttribute("aria-checked")).toBe("true");
  await pickColour(el, "teal");
  await save(el);
  expect(seen).toEqual([{ colour: "teal" }]);
  expect(el.saved()).toBe(true);
  await el.updateComplete;
  el.station = { ...GRILL, colour: "teal" };
  el.open = true;
  await el.updateComplete;
  await picker(el).updateComplete;
  expect(tile(el, "teal").getAttribute("aria-checked")).toBe("true");
  expect(tile(el, "orange").getAttribute("aria-checked")).toBe("false");
  const button = $<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save-station-edit]")!;
  expect([button.variant, button.disabled]).toEqual(["secondary", true]);
});

it("offers another station's colour with its name, and never names the station being edited", async () => {
  const el = await mount();
  await picker(el).updateComplete;
  expect(tile(el, "orange").getAttribute("aria-label")).toBe("Orange, used by Pizza oven");
  expect(tile(el, "blue").getAttribute("aria-label")).toBe("Blue, used by Bar");
  expect(picker(el).shadowRoot!.textContent).not.toContain("Grill");
  expect($(el, ".form > wt-input[name=stationName] + wt-colour-chooser")).not.toBeNull();
});

it("puts a colour refusal under Colour", async () => {
  const el = await mount();
  await pickColour(el, "teal");
  el.refusal = { code: "management.request_invalid", params: { field: "colour" } };
  await el.updateComplete;
  expect(picker(el).error).toBe("Choose one of these colours.");
  expect(nameField(el).error).toBe("");
  expect(formMessage(el)).toBe("Correct the highlighted fields to continue.");
  await pickColour(el, "cyan");
  expect(picker(el).error).toBe("");
  expect(formMessage(el)).toBe("");
});

it("offers Print a slip when sent dishes move table as Print or Don't print, right after the rest-of-order switch", async () => {
  const on = await mount();
  expect(movedField(on).label).toBe("Print a slip when sent dishes move table");
  expect(movedField(on).value).toBe("print");
  expect(movedField(on).options.map(({ value, label }) => [value, label])).toEqual([
    ["print", "Print"],
    ["dont-print", "Don't print"],
  ]);
  const fields = [...on.shadowRoot!.querySelectorAll("wt-switch, wt-combobox")];
  expect(fields.indexOf(movedField(on))).toBe(fields.indexOf(restSwitch(on)) + 1);
});

it("opens on the station's ticket grouping and held printing, after MOVED slips", async () => {
  const el = await mount({ ...GRILL, ticketGrouping: "separate", printHeldWork: true });
  expect(groupingField(el).label).toBe("Identical dishes on a kitchen ticket");
  expect(groupingField(el).value).toBe("separate");
  expect(groupingField(el).options.map(({ value, label }) => [value, label])).toEqual([
    ["combined", "One line: 3 x Burger"],
    ["separate", "A line each: 1 x Burger, three times"],
  ]);
  expect(groupingField(el).hint).toBe("Applies to new kitchen tickets and to reprints.");
  expect(heldSwitch(el).label).toBe("Print held groups in advance");
  expect(heldSwitch(el).checked).toBe(true);
  expect($(el, "[data-test=held-work-hint]")!.textContent).toBe(
    "Prints a held group at once, marked HOLD, and again marked FIRE when it is fired.",
  );
  const fields = [...el.shadowRoot!.querySelectorAll("wt-switch, wt-combobox")];
  expect(fields.indexOf(groupingField(el))).toBe(fields.indexOf(movedField(el)) + 1);
  expect(fields.indexOf(heldSwitch(el))).toBe(fields.indexOf(groupingField(el)) + 1);
  cleanup();
  const plain = await mount();
  expect(groupingField(plain).value).toBe("combined");
  expect(heldSwitch(plain).checked).toBe(false);
});

it("sends only a changed ticket grouping or held printing, and nothing for a choice put back", async () => {
  const el = await mount();
  const seen = saves(el);
  const pickGrouping = async (value: string) => {
    groupingField(el).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
    await el.updateComplete;
  };
  const flipHeld = async (checked: boolean) => {
    heldSwitch(el).dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
    await el.updateComplete;
  };
  await pickGrouping("separate");
  expect(saveButton(el).disabled).toBe(false);
  await pickGrouping("combined");
  expect(saveButton(el).disabled).toBe(true);
  await flipHeld(true);
  expect(saveButton(el).disabled).toBe(false);
  await flipHeld(false);
  expect(saveButton(el).disabled).toBe(true);
  await pickGrouping("separate");
  await save(el);
  expect(seen).toEqual([{ ticketGrouping: "separate" }]);
  cleanup();
  const held = await mount();
  const heldSeen = saves(held);
  heldSwitch(held).dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
  await held.updateComplete;
  await save(held);
  expect(heldSeen).toEqual([{ printHeldWork: true }]);
});

it("reads the ticket grouping and held printing in Spanish", async () => {
  const el = await mount(GRILL, { locale: "es" });
  expect(groupingField(el).label).toBe("Platos iguales en una comanda de cocina");
  expect(groupingField(el).options.map(({ label }) => label)).toEqual([
    "Una línea: 3 x Hamburguesa",
    "Una por plato: 1 x Hamburguesa, tres veces",
  ]);
  expect(groupingField(el).hint).toBe(
    "Se aplica a las comandas de cocina nuevas y a las reimpresiones.",
  );
  expect(heldSwitch(el).label).toBe("Imprimir por adelantado los grupos en espera");
  expect($(el, "[data-test=held-work-hint]")!.textContent).toBe(
    "Imprime un grupo en espera en el momento, marcado HOLD, y otra vez marcado FIRE al marcharlo.",
  );
});

it("opens on the station's bump mode, right after the late flags", async () => {
  const el = await mount({ ...GRILL, bumpMode: "ticket" });
  expect(bumpField(el).label).toBe("Done on the screen");
  expect(bumpField(el).value).toBe("ticket");
  expect(bumpField(el).options.map(({ value, label }) => [value, label])).toEqual([
    ["line", "One item at a time"],
    ["ticket", "Whole ticket at once"],
  ]);
  expect(bumpField(el).previousElementSibling!.tagName).toBe("FIELDSET");
  expect(bumpField(el).previousElementSibling!.querySelector("legend")!.textContent).toBe(
    "Late flags (minutes)",
  );
  expect(bumpField(el).nextElementSibling).toBe(restSwitch(el));
});

it("sends only a changed bump mode, and nothing for a choice put back", async () => {
  const el = await mount({ ...GRILL, bumpMode: "ticket" });
  const seen = saves(el);
  const pickBump = async (value: string) => {
    bumpField(el).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
    await el.updateComplete;
  };
  await pickBump("line");
  expect(saveButton(el).disabled).toBe(false);
  await pickBump("ticket");
  expect(saveButton(el).disabled).toBe(true);
  await pickBump("line");
  await save(el);
  expect(seen).toEqual([{ bumpMode: "line" }]);
});

it("ignores a bump mode the field does not offer", async () => {
  const el = await mount({ ...GRILL, bumpMode: "ticket" });
  const seen = saves(el);
  bumpField(el).dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Ticket" } }));
  await el.updateComplete;
  expect([saveButton(el).variant, saveButton(el).disabled]).toEqual(["secondary", true]);
  await rename(el, "Hot grill");
  await save(el);
  expect(seen).toEqual([{ name: "Hot grill" }]);
});

it("reads the bump mode in Spanish", async () => {
  const el = await mount(GRILL, { locale: "es" });
  expect(bumpField(el).label).toBe("Marcado en la pantalla");
  expect(bumpField(el).options.map(({ label }) => label)).toEqual([
    "Un plato cada vez",
    "Toda la comanda a la vez",
  ]);
});

it("opens on the station's changes after sending, last before the buttons", async () => {
  const el = await mount({ ...GRILL, changesAfterSending: "held" });
  expect(changesField(el).label).toBe("Changes after sending");
  expect(changesField(el).value).toBe("held");
  expect(changesField(el).options.map(({ value, label }) => [value, label])).toEqual([
    ["never", "Not allowed"],
    ["held", "While held"],
    ["held-or-waiting", "While held or waiting"],
  ]);
  expect(changesField(el).previousElementSibling).toBe($(el, "[data-test=held-work-hint]"));
  expect(changesField(el).nextElementSibling).toBeNull();
});

it("sends only a changed changes after sending, and nothing for a choice put back", async () => {
  const el = await mount({ ...GRILL, changesAfterSending: "held" });
  const seen = saves(el);
  const pick = async (value: string) => {
    changesField(el).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
    await el.updateComplete;
  };
  await pick("never");
  expect(saveButton(el).disabled).toBe(false);
  await pick("held");
  expect(saveButton(el).disabled).toBe(true);
  await pick("Held");
  expect(saveButton(el).disabled).toBe(true);
  await pick("never");
  await save(el);
  expect(seen).toEqual([{ changesAfterSending: "never" }]);
});

it("reads changes after sending in Spanish", async () => {
  const el = await mount(GRILL, { locale: "es" });
  expect(changesField(el).label).toBe("Cambios tras el envío");
  expect(changesField(el).options.map(({ label }) => label)).toEqual([
    "No permitidos",
    "Solo en espera",
    "En espera o sin empezar",
  ]);
});

it("opens on the station's own Print a slip when sent dishes move table choice", async () => {
  expect(movedField(await mount({ ...GRILL, printMovedSlips: true })).value).toBe("print");
  cleanup();
  expect(movedField(await mount({ ...GRILL, printMovedSlips: false })).value).toBe("dont-print");
});

it("enables Save on Don't print and sends it, and disables Save again on the stored choice", async () => {
  const el = await mount(GRILL);
  const seen = saves(el);
  expect(saveButton(el).disabled).toBe(true);
  await pickMoved(el, "dont-print");
  expect(saveButton(el).disabled).toBe(false);
  await pickMoved(el, "print");
  expect(saveButton(el).disabled).toBe(true);
  await pickMoved(el, "dont-print");
  await save(el);
  expect(seen).toEqual([{ printMovedSlips: false }]);
});

it("reads Print a slip when sent dishes move table in Spanish", async () => {
  const el = await mount(GRILL, { locale: "es" });
  expect(movedField(el).label).toBe("Imprimir un aviso al cambiar de mesa los platos enviados");
  expect(movedField(el).options.map(({ label }) => label)).toEqual(["Imprimir", "No imprimir"]);
});

it("A725 editor uses the station popup and saves the chosen colour", async () => {
  const el = await mount();
  el.stations = [...STATIONS, { id: "coffee", name: "Coffee", colour: "blue" }];
  await el.updateComplete;
  const chooser = $<WtColourChooser>(el, "wt-colour-chooser[name=colour]");
  expect(chooser).not.toBeNull();
  await chooser!.updateComplete;
  const root = chooser!.shadowRoot!;
  expect(root.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  expect(root.querySelector(".value")!.textContent).toContain("Orange");
  expect(chooser!.required).toBe(true);
  expect(chooser!.choices.map(({ value }) => value)).toEqual([...CALENDAR_COLOURS]);
  const seen = saves(el);
  await userEvent.click(root.querySelector("button.trigger")!);
  expect(root.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  expect(root.querySelector("[data-value=blue]")!.getAttribute("aria-label")).toBe(
    "Blue, used by Bar, Coffee",
  );
  expect(root.textContent).not.toContain("Grill");
  await userEvent.click(root.querySelector("[data-value=teal]")!);
  await el.updateComplete;
  expect(chooser!.value).toBe("teal");
  expect(root.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  await save(el);
  expect(seen).toEqual([{ colour: "teal" }]);
});

it("A725 ignores a colour value outside the offered station palette", async () => {
  const el = await mount();
  const seen = saves(el);
  const chooser = $<WtColourChooser>(el, "wt-colour-chooser[name=colour]")!;
  chooser.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "invalid-colour" } }));
  await el.updateComplete;
  await save(el);
  expect(seen).toEqual([]);
  expect(chooser.value).toBe("orange");
  expect(saveButton(el).disabled).toBe(true);
});

it("A725 popup Escape preserves the open editor and its changed colour", async () => {
  const el = await mount();
  await pickColour(el, "teal");
  const chooser = $<WtColourChooser>(el, "wt-colour-chooser[name=colour]")!;
  await userEvent.click(chooser.shadowRoot!.querySelector("button.trigger")!);
  expect(chooser.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect(chooser.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  expect(el.open).toBe(true);
  expect(chooser.value).toBe("teal");
  expect(el.dirty).toBe(true);
  expect(saveButton(el).disabled).toBe(false);
});

it("A725 paints the station dot token and translates a retained chooser", async () => {
  const el = await mount();
  const chooser = $<WtColourChooser>(el, "wt-colour-chooser[name=colour]")!;
  await chooser.updateComplete;
  host.style.setProperty("--wt-color-station-orange-dot", "rgb(1, 2, 3)");
  const square = chooser.shadowRoot!.querySelector(".trigger [part=swatch]")!;
  expect(getComputedStyle(square).backgroundColor).toBe("rgb(1, 2, 3)");
  setLocale("es");
  el.requestUpdate();
  await el.updateComplete;
  await chooser.updateComplete;
  expect(chooser.shadowRoot!.querySelector(".value")!.textContent).toContain("Naranja");
  expect(chooser.shadowRoot!.querySelector("[data-value=blue]")!.getAttribute("aria-label")).toBe(
    "Azul, en uso por Bar",
  );
  expect($(el, "fieldset legend")!.textContent).toBe("Avisos de demora (minutos)");
  expect(restSwitch(el).label).toBe("Mostrar también los platos del pedido de otras estaciones");
  expect($(el, "[data-test=rest-of-order-hint]")!.textContent).toBe(
    "En las comandas y la pantalla de cocina de esta estación",
  );
});

it("A725 ignores an event from the departed station chooser", async () => {
  const el = await mount();
  const previous = $<WtColourChooser>(el, "wt-colour-chooser[name=colour]")!;
  el.open = false;
  await el.updateComplete;
  el.station = { ...GRILL, id: "bar", name: "Bar", colour: "blue" };
  el.open = true;
  await el.updateComplete;
  previous.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "teal" } }));
  await el.updateComplete;
  expect($<WtColourChooser>(el, "wt-colour-chooser[name=colour]")!.value).toBe("blue");
  expect(el.dirty).toBe(false);
  expect(saveButton(el).disabled).toBe(true);
});

it("sends a typed ready warning, and nothing for 03 over a stored 3", async () => {
  const el = await mount();
  const seen = saves(el);
  await setTiming(el, "readyWarningAfterMinutes", "7");
  await save(el);
  expect(seen).toEqual([{ readyWarningAfterMinutes: 7 }]);
  expect(el.saved()).toBe(true);
  const again = await mount();
  const seenAgain = saves(again);
  await setTiming(again, "readyWarningAfterMinutes", "03");
  expect(saveButton(again).disabled).toBe(true);
  await save(again);
  expect(seenAgain).toEqual([]);
});

it.each(["", "0", "1.5", "abc", "2147483648"])(
  "marks Ready warning for %j with its own message, sends nothing and focuses it",
  async (value) => {
    const el = await mount();
    const seen = saves(el);
    await setTiming(el, "readyWarningAfterMinutes", value);
    await save(el);
    expect(seen).toEqual([]);
    expect(timingField(el, "readyWarningAfterMinutes").error).toBe(
      "Use whole minutes, at least 1.",
    );
    expect(TIMINGS.map((name) => timingField(el, name).error)).toEqual(["", "", ""]);
    expect(nameField(el).error).toBe("");
    expect(formMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(true);
    await expect
      .poll(() => el.shadowRoot!.activeElement)
      .toBe(timingField(el, "readyWarningAfterMinutes"));
    await setTiming(el, "readyWarningAfterMinutes", "4");
    expect(timingField(el, "readyWarningAfterMinutes").error).toBe("");
    expect(formMessage(el)).toBe("");
    expect(saveButton(el).disabled).toBe(false);
    await save(el);
    expect(seen).toEqual([{ readyWarningAfterMinutes: 4 }]);
  },
);

it("a ready warning above Forgotten after is saved", async () => {
  const el = await mount();
  const seen = saves(el);
  await setTiming(el, "readyWarningAfterMinutes", "20");
  await save(el);
  expect(seen).toEqual([{ readyWarningAfterMinutes: 20 }]);
  expect(STATION_MINUTES.map((name) => timingField(el, name).error)).toEqual(["", "", "", ""]);
});

it.each(["management.request_invalid", "station.thresholds_invalid"] as const)(
  "puts a %s refusal naming readyWarningAfterMinutes under that field with its own message",
  async (code) => {
    const el = await mount();
    await setTiming(el, "readyWarningAfterMinutes", "4");
    el.refusal = { code, params: { field: "readyWarningAfterMinutes" } };
    await el.updateComplete;
    expect(timingField(el, "readyWarningAfterMinutes").error).toBe(
      "Use whole minutes, at least 1.",
    );
    expect(TIMINGS.map((name) => timingField(el, name).error)).toEqual(["", "", ""]);
    expect(nameField(el).error).toBe("");
    expect(formMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(false);
  },
);

it("reads Ready warning in Spanish", async () => {
  const el = await mount(GRILL, { locale: "es" });
  expect(timingField(el, "readyWarningAfterMinutes").label).toBe("Listo sin recoger");
  await setTiming(el, "readyWarningAfterMinutes", "0");
  await save(el);
  expect(timingField(el, "readyWarningAfterMinutes").error).toBe(
    "Usa minutos enteros, al menos 1.",
  );
});

it.each([390, 1280])("A725 draws the four minutes two to a row at %ipx", async (width) => {
  const previous = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(width, 1100);
    const el = await mount();
    const group = [...el.shadowRoot!.querySelectorAll("fieldset")].find(
      (fieldset) => fieldset.querySelector("legend")?.textContent === "Late flags (minutes)",
    );
    expect(group).toBeDefined();
    const fields = STATION_MINUTES.map((name) => timingField(el, name));
    await Promise.all(fields.map((field) => field.updateComplete));
    expect(fields.every((field) => group!.contains(field))).toBe(true);
    const boxes = fields.map((field) => field.getBoundingClientRect());
    const [first, second, third, fourth] = boxes.map((box) => ({
      top: Math.round(box.top),
      bottom: Math.round(box.bottom),
      left: Math.round(box.left),
      right: Math.round(box.right),
    }));
    expect(second!.top).toBe(first!.top);
    expect(second!.left).toBeGreaterThanOrEqual(first!.right);
    expect(third!.top).toBeGreaterThanOrEqual(first!.bottom);
    expect(fourth!.top).toBe(third!.top);
    expect(third!.left).toBe(first!.left);
    expect(fourth!.left).toBe(second!.left);
    expect(boxes.every((box) => box.width > 0 && box.right <= window.innerWidth)).toBe(true);
    expect(fields.map((field) => field.value)).toEqual(["5", "12", "15", "3"]);
    expect(fields.map((field) => field.hint)).toEqual(["", "", "", ""]);
    expect(restSwitch(el).label).toBe("Also list the order's dishes from other stations");
    expect($(el, "[data-test=rest-of-order-hint]")!.textContent).toBe(
      "On this station's tickets and kitchen screen",
    );
    expect(movedField(el).label).toBe("Print a slip when sent dishes move table");
    expect(movedField(el).options.map(({ label }) => label)).toEqual(["Print", "Don't print"]);
  } finally {
    await page.viewport(previous[0]!, previous[1]!);
  }
});

it.each(["en", "es"] as const)("A725 phone labels remain fully readable in %s", async (locale) => {
  const previous = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(390, 1100);
    const el = await mount(GRILL, { locale });
    const fields = STATION_MINUTES.map((name) => timingField(el, name));
    await Promise.all(fields.map((field) => field.updateComplete));
    for (const field of fields) {
      const text = field.shadowRoot!.querySelector<HTMLElement>(".field-label-text")!;
      expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1);
    }
    expect(fields.map((field) => field.label)).toEqual(
      locale === "en"
        ? ["Waiting", "Overdue", "Forgotten", "Ready warning"]
        : ["Esperando", "Con retraso", "Olvidado", "Listo sin recoger"],
    );
    const group = $(el, "fieldset[data-test=moved-slips-group]");
    expect(group).not.toBeNull();
    const question = group!.querySelector("legend")!;
    expect(question.textContent).toBe(movedField(el).label);
    expect(question.scrollWidth).toBeLessThanOrEqual(question.clientWidth + 1);
    expect(movedField(el).hideLabel).toBe(true);
  } finally {
    await page.viewport(previous[0]!, previous[1]!);
  }
});

it.each(["en", "es"] as const)(
  "shared palette grey is labelled and saved in %s",
  async (locale) => {
    setLocale(locale);
    const el = await mount(GRILL, { locale });
    const seen = saves(el);
    const chooser = $<WtColourChooser>(el, "wt-colour-chooser[name=colour]")!;
    await chooser.updateComplete;
    expect(chooser.choices.find(({ value }) => value === "grey")?.label).toBe(
      locale === "en" ? "Grey" : "Gris",
    );
    await userEvent.click(chooser.shadowRoot!.querySelector("button.trigger")!);
    await userEvent.click(chooser.shadowRoot!.querySelector('[data-value="grey"]')!);
    await save(el);
    expect(seen).toEqual([{ colour: "grey" }]);
  },
);
