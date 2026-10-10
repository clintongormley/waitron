import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillStationTodayDialog } from "./station-today-dialog.js";
import "./station-today-dialog.js";
class StationTodayLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  confirmed: unknown[] = [];
  override render() {
    return html`<till-station-today-dialog
        .stationName=${"Grill"}
        .destinations=${[
          { id: "pass", name: "Pass", isDefault: true },
          { id: "bar", name: "Bar", isDefault: false },
        ]}
        @close=${() => this.closes++}
        @station-today-confirm=${(e: CustomEvent) => this.confirmed.push(e.detail)}
      ></till-station-today-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("station-today-leave-test-app", StationTodayLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<StationTodayLeaveApp>("station-today-leave-test-app", {});
  const form = app.shadowRoot!.querySelector<TillStationTodayDialog>("till-station-today-dialog")!;
  await form.updateComplete;
  expect(form.shadowRoot).not.toBeNull();
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function choose(form: TillStationTodayDialog, value: string) {
  const f = form.shadowRoot!.querySelector("wt-combobox")!;
  f.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await f.updateComplete;
  f.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')[
    f.options.findIndex((o) => o.value === value)
  ]!.click();
  await form.updateComplete;
}
async function question(app: StationTodayLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: TillStationTodayDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
}
it.each(["Cancel", "Escape"])(
  "an edited %s asks to keep or discard without submitting",
  async (action) => {
    const { app, form } = await mount();
    await choose(form, "bar");
    expect(unload()).toBe(true);
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(form.shadowRoot!.querySelector("wt-combobox")!.value).toBe("bar");
    expect(app.closes).toBe(0);
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(app.confirmed).toEqual([]);
    expect(unload()).toBe(false);
  },
);
it("clean and reverted selections close without a warning", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  await choose(form, "bar");
  await choose(form, "pass");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("a reconnect retains the opening baseline; departed presses cannot change or submit it", async () => {
  const { app, form } = await mount();
  await choose(form, "bar");
  const field = form.shadowRoot!.querySelector("wt-combobox")!;
  form.remove();
  expect(unload()).toBe(false);
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "pass" } }));
  form.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  cancel(form);
  expect(app.confirmed).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.prepend(form);
  await form.updateComplete;
  expect(field.value).toBe("bar");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("successful commit invalidates an old discard and retains an independent parent draft", async () => {
  const { app, form } = await mount();
  let value = "saved";
  const scope = app.leave.coordinator.register({
    id: app,
    current: () => value,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => (value = v),
  });
  value = "edited";
  scope.changed();
  await choose(form, "bar");
  cancel(form);
  const q = await question(app);
  const old = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.commit();
  await expect.poll(() => q.open).toBe(false);
  old.click();
  expect(app.closes).toBe(0);
  expect(value).toBe("edited");
  expect(unload()).toBe(true);
  scope.dispose();
  expect(unload()).toBe(false);
});
it("a request refusal keeps the chosen draft protected and reordering choices does not reset it", async () => {
  const { app, form } = await mount();
  await choose(form, "bar");
  form.refusal = "station.destination_invalid";
  form.destinations = [...form.destinations].reverse();
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-combobox")!.value).toBe("bar");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});

it("protects an edited open-dish choice even when the destination stays unchanged", async () => {
  const { app, form } = await mount();
  form.openDishCount = 2;
  await form.updateComplete;
  const choice = form.shadowRoot!.querySelector('wt-combobox[name="openDishes"]');
  expect(choice).not.toBeNull();
  choice!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "leave" } }));
  await form.updateComplete;
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      'wt-combobox[name="openDishes"]',
    )!.value,
  ).toBe("leave");
  expect(app.closes).toBe(0);
  form.commit();
  expect(unload()).toBe(false);
});
