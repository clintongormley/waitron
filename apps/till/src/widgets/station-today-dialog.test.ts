import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillStationTodayDialog } from "./station-today-dialog.js";
import "./station-today-dialog.js";
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
const destinations = [
  { id: "pass", name: "Pass", isDefault: true },
  { id: "bar", name: "Bar", isDefault: false },
];
async function mount(props: Partial<TillStationTodayDialog> = {}) {
  const { el } = await mountWidget<TillStationTodayDialog>("till-station-today-dialog", {
    stationName: "Grill",
    destinations,
    ...props,
  });
  expect(el.shadowRoot, "the destination dialog renders").not.toBeNull();
  return el;
}
it("offers the default first, shows retained-dishes guidance and sends the chosen destination once", async () => {
  const el = await mount();
  const field = el.shadowRoot!.querySelector("wt-combobox")!;
  expect(field.required).toBe(true);
  expect(field.value).toBe("pass");
  expect(field.options).toEqual([
    { value: "pass", label: "Pass (default)" },
    { value: "bar", label: "Bar" },
  ]);
  expect(el.shadowRoot!.textContent).toContain(
    "Dishes already sent stay on this screen. Dishes placed here by hand stay here too.",
  );
  const heard: unknown[] = [];
  el.addEventListener("station-today-confirm", (e) => heard.push((e as CustomEvent).detail));
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  expect(heard).toEqual([{ sendsToStationId: "bar" }]);
});
it("replaces a vanished selection with the default and keeps the refusal beside the field and above the buttons", async () => {
  const el = await mount({ selected: "bar", refusal: "station.destination_invalid" });
  el.destinations = [destinations[0]!];
  await el.updateComplete;
  const field = el.shadowRoot!.querySelector("wt-combobox")!;
  expect(field.value).toBe("pass");
  expect(field.error).toBe("That station cannot take the work now. Choose another.");
  expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(field.error);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")!.disabled,
  ).toBe(false);
});
it("an empty destination list blocks a host press without emitting a request", async () => {
  const el = await mount({ destinations: [] });
  const heard: unknown[] = [];
  el.addEventListener("station-today-confirm", (e) => heard.push(e));
  const submit = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")!;
  expect([submit.variant, submit.disabled]).toEqual(["secondary", true]);
  submit.click();
  expect(heard).toEqual([]);
});
it("a busy dialog keeps its action colour and refuses a duplicate host press", async () => {
  const el = await mount({ busy: true });
  const heard: unknown[] = [];
  el.addEventListener("station-today-confirm", (e) => heard.push(e));
  const submit = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")!;
  expect([submit.variant, submit.disabled]).toEqual(["primary", true]);
  submit.click();
  expect(heard).toEqual([]);
});
