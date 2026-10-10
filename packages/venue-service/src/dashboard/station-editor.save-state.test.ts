import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, mount as mountHtml } from "@waitron/ui/src/test-helpers.js";
import type { StationEditor } from "./station-editor.js";
import "./station-editor.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

async function mount(printerIds = ["epson"]) {
  setLocale("en");
  const el = (await mountHtml("<prep-station-editor></prep-station-editor>")) as StationEditor;
  el.station = {
    id: "grill",
    name: "Grill",
    active: true,
    showsRestOfOrder: false,
    printerIds,
  };
  el.printers = [
    { id: "epson", name: "Epson" },
    { id: "star", name: "Star" },
  ];
  el.canManagePrinters = true;
  el.open = true;
  await el.updateComplete;
  return el;
}

const saveButton = (el: StationEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-station-edit]",
  )!;

/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: StationEditor) {
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

async function change(el: StationEditor, selector: string, detail: unknown) {
  el.shadowRoot!.querySelector(selector)!.dispatchEvent(new CustomEvent("wt-change", { detail }));
  await el.updateComplete;
}

it("opens quiet and sends nothing for a click on its quiet Save", async () => {
  const el = await mount();
  const seen: unknown[] = [];
  el.addEventListener("station-save", (event) => seen.push(event));
  expect(await saveState(el)).toEqual(quiet);
  saveButton(el).click();
  await el.updateComplete;
  expect(seen).toEqual([]);
});

it.each([
  ["the name", "wt-input[name=stationName]", { value: "Hot grill" }, { value: " Grill " }],
  [
    "the rest-of-order switch",
    "wt-switch[name=showsRestOfOrder]",
    { checked: true },
    { checked: false },
  ],
  [
    "the printers",
    "wt-combobox[name=printerIds]",
    { values: ["star", "epson"] },
    { values: ["epson"] },
  ],
])("wakes Save on a change to %s and quiets it on undo", async (_, selector, changed, undone) => {
  const el = await mount();
  await change(el, selector, changed);
  expect(await saveState(el)).toEqual(ready);
  await change(el, selector, undone);
  expect(await saveState(el)).toEqual(quiet);
});

it("compares printers as a set, not in the order they were picked", async () => {
  const el = await mount(["epson", "star"]);
  await change(el, "wt-combobox[name=printerIds]", { values: ["star", "epson"] });
  expect(await saveState(el)).toEqual(quiet);
  await change(el, "wt-combobox[name=printerIds]", { values: ["star"] });
  expect(await saveState(el)).toEqual(ready);
});

it("keeps Save working after a refusal and disabled while saving", async () => {
  const el = await mount();
  await change(el, "wt-input[name=stationName]", { value: "Hot grill" });
  el.refusal = { code: "connection.failed" };
  expect(await saveState(el)).toEqual(ready);
  el.busy = true;
  expect((await saveState(el)).disabled).toBe(true);
});
