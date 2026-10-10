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
  active: true,
  showsRestOfOrder: false,
  printerIds: ["epson"],
};

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
    { id: "pass", name: "Pass printer", watcherId: "expo" },
  ];
  el.watchers = [{ id: "expo", name: "Expo", printerIds: ["pass"] }];
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
const formMessage = (el: StationEditor) =>
  $<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error;

async function rename(el: StationEditor, value: string) {
  nameField(el).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
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

it("offers active printers no watcher uses, and keeps a chosen one it would not offer", async () => {
  const el = await mount({ ...GRILL, printerIds: ["epson", "old"] });
  const options = printersField(el)!.options;
  expect(options.map(({ value, disabled }) => [value, !!disabled])).toEqual([
    ["epson", false],
    ["star", false],
    ["old", false],
    ["pass", true],
  ]);
  expect(options.find((option) => option.value === "old")!.description).toBe("Disabled");
  expect(options.find((option) => option.value === "pass")!.description).toBe(
    "Used by watcher Expo",
  );
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
  ["printer.makes_and_watches", { printerId: "pass" }],
  ["management.request_invalid", { field: "printerIds" }],
] as const)("puts a %s refusal under Printers", async (code, params) => {
  const el = await mount();
  await pickPrinters(el, ["star"]);
  el.refusal = { code, params };
  await el.updateComplete;
  expect(printersField(el)!.error).toBe("Choose active printers that no watcher uses.");
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

it("names a printer it cannot find by its id, and a watcher it cannot find by the printer's", async () => {
  const el = await mount({ ...GRILL, printerIds: ["gone"] }, { canManagePrinters: false });
  expect($(el, "[data-test=station-printers]")!.textContent).toContain("gone");
  el.canManagePrinters = true;
  el.printers = [{ id: "pass", name: "Pass printer", watcherId: "ghost" }];
  el.watchers = [];
  await el.updateComplete;
  expect(printersField(el)!.options[0]!.description).toBe("Used by watcher ghost");
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
