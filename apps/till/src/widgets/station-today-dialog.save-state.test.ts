import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillStationTodayDialog } from "./station-today-dialog.js";
import "./station-today-dialog.js";
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el } = await mountWidget<TillStationTodayDialog>("till-station-today-dialog", {
    stationName: "Grill",
    destinations: [
      { id: "pass", name: "Pass", isDefault: true },
      { id: "bar", name: "Bar", isDefault: false },
    ],
  });
  expect(el.shadowRoot).not.toBeNull();
  return el;
}
async function state(el: TillStationTodayDialog) {
  await el.updateComplete;
  const b = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")!;
  await b.updateComplete;
  return [b.variant, b.disabled, b.shadowRoot!.querySelector("button")!.disabled];
}
it("the preselected destination is savable on opening without a draft edit", async () => {
  expect(await state(await mount())).toEqual(["primary", false, false]);
});
it("a completed write commits the destination; changing then reverting it restores the quiet action", async () => {
  const el = await mount();
  el.commit();
  expect(await state(el)).toEqual(["secondary", true, true]);
  const field = el.shadowRoot!.querySelector("wt-combobox")!;
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
  expect(await state(el)).toEqual(["primary", false, false]);
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "pass" } }));
  expect(await state(el)).toEqual(["secondary", true, true]);
  const heard: unknown[] = [];
  el.addEventListener("station-today-confirm", (e) => heard.push(e));
  el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  expect(heard).toEqual([]);
});
it("a refusal leaves an uncommitted choice ready to retry", async () => {
  const el = await mount();
  el.refusal = "station.destination_invalid";
  expect(await state(el)).toEqual(["primary", false, false]);
});
