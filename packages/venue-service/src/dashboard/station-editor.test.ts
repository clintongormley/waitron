import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, mount as mountHtml } from "@waitron/ui/src/test-helpers.js";
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
function saves(el: StationEditor) {
  const seen: StationEditorSave[] = [];
  el.addEventListener("station-save", (event) =>
    seen.push((event as CustomEvent<StationEditorSave>).detail),
  );
  return seen;
}
const picker = (el: StationEditor) =>
  $<HTMLElementTagNameMap["station-colour-picker"]>(el, "station-colour-picker")!;
const tile = (el: StationEditor, colour: string) =>
  picker(el).shadowRoot!.querySelector<HTMLButtonElement>(
    `[role=radio][data-station-colour="${colour}"]`,
  )!;
async function pickColour(el: StationEditor, colour: string) {
  tile(el, colour).click();
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
  expect(restSwitch(el).label).toBe("Show the rest of the order");
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
  expect(restSwitch(el).label).toBe("Mostrar el resto del pedido");
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
    "Warm after (min)",
    "Overdue after (min)",
    "Forgotten after (min)",
  ]);
  for (const name of TIMINGS) {
    expect(timingField(el, name).required).toBe(false);
    expect(timingField(el, name).type).toBe("number");
    expect(timingField(el, name).hint).toBe("Leave blank to use the venue default.");
  }
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
    "Aviso a partir de (min)",
    "Atraso a partir de (min)",
    "Olvido a partir de (min)",
  ]);
  await setTiming(el, "warmAfterMinutes", "0");
  await save(el);
  expect(timingField(el, "warmAfterMinutes").error).toBe(
    "Usa minutos enteros con aviso < atraso < olvido.",
  );
  expect(timingField(el, "warmAfterMinutes").hint).toBe(
    "Deja el campo vacío para usar el valor del local.",
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
  expect($(el, ".form > wt-input[name=stationName] + station-colour-picker")).not.toBeNull();
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
