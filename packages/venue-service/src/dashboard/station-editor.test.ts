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
  printMovedSlips: null,
  printerIds: ["epson"],
  timingOverrides: { warmAfterMinutes: null, overdueAfterMinutes: 12, forgottenAfterMinutes: null },
  timingDefaults: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
};

const STATIONS = [
  { id: "grill", name: "Grill", colour: "orange" as const },
  { id: "bar", name: "Bar", colour: "blue" as const },
  { id: "pizza", name: "Pizza oven", colour: "orange" as const },
];

async function mount(
  station: StationEditorStation = GRILL,
  { canManagePrinters = true, locale = "en" as "en" | "es", venuePrintsMovedSlips = true } = {},
) {
  setLocale(locale);
  const el = (await mountHtml("<prep-station-editor></prep-station-editor>")) as StationEditor;
  el.station = station;
  el.venuePrintsMovedSlips = venuePrintsMovedSlips;
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
const NO_OVERRIDES = {
  warmAfterMinutes: null,
  overdueAfterMinutes: null,
  forgottenAfterMinutes: null,
};

it("opens each timing empty when inherited, the venue default as its placeholder, and filled when overridden", async () => {
  const el = await mount();
  expect(TIMINGS.map((name) => timingField(el, name).value)).toEqual(["", "12", ""]);
  expect(TIMINGS.map((name) => timingField(el, name).placeholder)).toEqual(["5", "10", "15"]);
  expect(TIMINGS.map((name) => timingField(el, name).label)).toEqual([
    "Warm",
    "Overdue",
    "Forgotten",
  ]);
  for (const name of TIMINGS) {
    expect(timingField(el, name).required).toBe(false);
    expect(timingField(el, name).type).toBe("number");
    expect(timingField(el, name).hint).toBe("");
  }
  expect($(el, "#timing-inheritance")!.textContent).toBe(
    "Leave a field blank to use the venue setting",
  );
});

it("sends a typed timing, a cleared override as null, and an override equal to its default", async () => {
  const el = await mount();
  const seen = saves(el);
  await setTiming(el, "warmAfterMinutes", "3");
  await save(el);
  expect(el.saved()).toBe(true);
  const again = await mount();
  const seenAgain = saves(again);
  await setTiming(again, "overdueAfterMinutes", "");
  await setTiming(again, "warmAfterMinutes", "5");
  await save(again);
  expect(seen).toEqual([{ warmAfterMinutes: 3 }]);
  expect(seenAgain).toEqual([{ warmAfterMinutes: 5, overdueAfterMinutes: null }]);
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
  "marks Warm for %s, explains it at the bottom, sends nothing and focuses it",
  async (value) => {
    const el = await mount();
    const seen = saves(el);
    await setTiming(el, "warmAfterMinutes", value);
    await save(el);
    expect(seen).toEqual([]);
    expect(timingField(el, "warmAfterMinutes").error).toBe(
      "Use whole minutes with warm < overdue < forgotten.",
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

it("holds the timings in order, reading a blank one as its default", async () => {
  const el = await mount({ ...GRILL, timingOverrides: NO_OVERRIDES });
  const seen = saves(el);
  await setTiming(el, "warmAfterMinutes", "9");
  await save(el);
  expect(seen).toEqual([{ warmAfterMinutes: 9 }]);

  const warm = await mount({ ...GRILL, timingOverrides: NO_OVERRIDES });
  await setTiming(warm, "warmAfterMinutes", "10");
  await save(warm);
  expect(timingField(warm, "warmAfterMinutes").error).toBe("");
  expect(timingField(warm, "overdueAfterMinutes").error).toBe(
    "Use whole minutes with warm < overdue < forgotten.",
  );

  const forgotten = await mount({ ...GRILL, timingOverrides: NO_OVERRIDES });
  await setTiming(forgotten, "overdueAfterMinutes", "11");
  await setTiming(forgotten, "forgottenAfterMinutes", "10");
  await save(forgotten);
  expect(timingField(forgotten, "overdueAfterMinutes").error).toBe("");
  expect(timingField(forgotten, "forgottenAfterMinutes").error).toBe(
    "Use whole minutes with warm < overdue < forgotten.",
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
  expect(timingField(el, field).error).toBe("Use whole minutes with warm < overdue < forgotten.");
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

it("follows a venue-default change while open and keeps a typed override", async () => {
  const el = await mount();
  await setTiming(el, "warmAfterMinutes", "3");
  el.station = {
    ...GRILL,
    timingDefaults: { warmAfterMinutes: 6, overdueAfterMinutes: 11, forgottenAfterMinutes: 30 },
  };
  await el.updateComplete;
  expect(TIMINGS.map((name) => timingField(el, name).placeholder)).toEqual(["6", "11", "30"]);
  expect(timingField(el, "warmAfterMinutes").value).toBe("3");
  expect(el.dirty).toBe(true);
});

it("reads the timings in Spanish", async () => {
  const el = await mount(GRILL, { locale: "es" });
  expect(TIMINGS.map((name) => timingField(el, name).label)).toEqual([
    "En demora",
    "Retrasado",
    "Olvidado",
  ]);
  await setTiming(el, "warmAfterMinutes", "0");
  await save(el);
  expect(timingField(el, "warmAfterMinutes").error).toBe(
    "Usa minutos enteros con aviso < atraso < olvido.",
  );
  expect(timingField(el, "warmAfterMinutes").hint).toBe("");
  expect($(el, "#timing-inheritance")!.textContent).toBe(
    "Deja un campo vacío para usar el ajuste del local",
  );
});

it("explains timings out of order in Spanish beside the field and at the bottom, and sends nothing", async () => {
  const el = await mount({ ...GRILL, timingOverrides: NO_OVERRIDES }, { locale: "es" });
  const seen = saves(el);
  await setTiming(el, "warmAfterMinutes", "10");
  await save(el);
  expect(seen).toEqual([]);
  expect(timingField(el, "warmAfterMinutes").error).toBe("");
  expect(timingField(el, "overdueAfterMinutes").error).toBe(
    "Usa minutos enteros con aviso < atraso < olvido.",
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

it("offers Print a slip when sent dishes move table as the venue, naming the venue's choice, right after the rest-of-order switch", async () => {
  const on = await mount();
  expect(movedField(on).label).toBe("Print a slip when sent dishes move table");
  expect(movedField(on).value).toBe("venue");
  expect(movedField(on).options.map(({ value, label }) => [value, label])).toEqual([
    ["venue", "Venue setting: Print"],
    ["print", "Print"],
    ["dont-print", "Don't print"],
  ]);
  const fields = [...on.shadowRoot!.querySelectorAll("wt-switch, wt-combobox")];
  expect(fields.indexOf(movedField(on))).toBe(fields.indexOf(restSwitch(on)) + 1);
  cleanup();
  const off = await mount(GRILL, { venuePrintsMovedSlips: false });
  expect(movedField(off).options[0]!.label).toBe("Venue setting: Don't print");
});

it("opens on the station's own Print a slip when sent dishes move table choice", async () => {
  expect(movedField(await mount({ ...GRILL, printMovedSlips: true })).value).toBe("print");
  cleanup();
  expect(movedField(await mount({ ...GRILL, printMovedSlips: false })).value).toBe("dont-print");
});

it("enables Save on Don't print and sends it, and disables Save again on the stored choice", async () => {
  const el = await mount(GRILL, { venuePrintsMovedSlips: true });
  const seen = saves(el);
  expect(saveButton(el).disabled).toBe(true);
  await pickMoved(el, "dont-print");
  expect(saveButton(el).disabled).toBe(false);
  await pickMoved(el, "venue");
  expect(saveButton(el).disabled).toBe(true);
  await pickMoved(el, "dont-print");
  await save(el);
  expect(seen).toEqual([{ printMovedSlips: false }]);
});

it("sends null when a station's own choice goes back to as the venue", async () => {
  const el = await mount({ ...GRILL, printMovedSlips: true });
  const seen = saves(el);
  await pickMoved(el, "venue");
  await save(el);
  expect(seen).toEqual([{ printMovedSlips: null }]);
});

it("reads Print a slip when sent dishes move table in Spanish", async () => {
  const el = await mount(GRILL, { locale: "es", venuePrintsMovedSlips: false });
  expect(movedField(el).label).toBe("Imprimir un aviso al cambiar de mesa los platos enviados");
  expect(movedField(el).options.map(({ label }) => label)).toEqual([
    "Ajuste del local: No imprimir",
    "Imprimir",
    "No imprimir",
  ]);
  cleanup();
  const on = await mount(GRILL, { locale: "es" });
  expect(movedField(on).options[0]!.label).toBe("Ajuste del local: Imprimir");
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

it.each([390, 1280])("A725 groups late minutes on one row at %ipx", async (width) => {
  const previous = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(width, 1100);
    const el = await mount();
    const group = $(el, "fieldset[aria-describedby=timing-inheritance]");
    expect(group).not.toBeNull();
    expect(group!.querySelector("legend")!.textContent).toBe("Late flags (minutes)");
    const fields = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"].map(
      (name) => timingField(el, name),
    );
    await Promise.all(fields.map((field) => field.updateComplete));
    const boxes = fields.map((field) => field.getBoundingClientRect());
    expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(1);
    expect(boxes.every((box) => box.width > 0 && box.right <= window.innerWidth)).toBe(true);
    expect(fields.map((field) => field.placeholder)).toEqual(["5", "10", "15"]);
    expect(fields.map((field) => field.hint)).toEqual(["", "", ""]);
    expect($(el, "#timing-inheritance")!.textContent).toBe(
      "Leave a field blank to use the venue setting",
    );
    expect(restSwitch(el).label).toBe("Also list the order's dishes from other stations");
    expect($(el, "[data-test=rest-of-order-hint]")!.textContent).toBe(
      "On this station's tickets and kitchen screen",
    );
    expect(movedField(el).label).toBe("Print a slip when sent dishes move table");
    expect(movedField(el).options.map(({ label }) => label)).toEqual([
      "Venue setting: Print",
      "Print",
      "Don't print",
    ]);
  } finally {
    await page.viewport(previous[0]!, previous[1]!);
  }
});

it.each(["en", "es"] as const)("A725 phone labels remain fully readable in %s", async (locale) => {
  const previous = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(390, 1100);
    const el = await mount(GRILL, { locale });
    const fields = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"].map(
      (name) => timingField(el, name),
    );
    await Promise.all(fields.map((field) => field.updateComplete));
    for (const field of fields) {
      const text = field.shadowRoot!.querySelector<HTMLElement>(".field-label-text")!;
      expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1);
    }
    expect(fields.map((field) => field.label)).toEqual(
      locale === "en" ? ["Warm", "Overdue", "Forgotten"] : ["En demora", "Retrasado", "Olvidado"],
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
