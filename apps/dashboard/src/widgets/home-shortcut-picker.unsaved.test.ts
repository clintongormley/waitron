import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import { chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, reattachAfterDetachedUpdate } from "./test-helpers.js";
import type { HomeShortcutPicker } from "./home-shortcut-picker.js";
import "./home-shortcut-picker.js";

registerIcons(DASHBOARD_ICONS);
const options = [
  { value: "p-lemonade", label: "Lemonade" },
  { value: "p-lager", label: "Lager" },
  { value: "p-burger", label: "Burger" },
];
class PickerLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<dashboard-home-shortcut-picker
        kind="product"
        .options=${options}
      ></dashboard-home-shortcut-picker
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("home-shortcut-picker-leave-test-app", PickerLeaveApp);
afterEach(cleanupWidgets);

async function mount() {
  const { el: app } = await mountWidget<PickerLeaveApp>("home-shortcut-picker-leave-test-app", {});
  const picker = app.shadowRoot!.querySelector("dashboard-home-shortcut-picker")!;
  await picker.updateComplete;
  return { app, picker };
}
async function choose(picker: HomeShortcutPicker, values: string[]) {
  await chooseOptions(picker.shadowRoot!.querySelector("wt-combobox")!, values);
  await picker.updateComplete;
}
async function question(app: PickerLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
/** Asks to leave the picker, as closing its window does; resolves whether the leave went ahead. */
function leave(app: PickerLeaveApp, picker: HomeShortcutPicker) {
  return app.leave.coordinator.request({ scopes: [picker], reason: "cancel", proceed() {} });
}
async function addState(picker: HomeShortcutPicker) {
  await picker.updateComplete;
  const add =
    picker.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="add"]')!;
  await add.updateComplete;
  return { variant: add.variant, disabled: add.disabled };
}

it("leaving with nothing chosen does not ask", async () => {
  const { app, picker } = await mount();
  expect(await leave(app, picker)).toBe("proceeded");
  expect((await question(app)).open).toBe(false);
});

it("leaving with a choice asks, and Discard empties the choice", async () => {
  const { app, picker } = await mount();
  await choose(picker, ["p-lager", "p-burger"]);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  const pending = leave(app, picker);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await pending).toBe("proceeded");
  await picker.updateComplete;
  expect(picker.shadowRoot!.querySelector("wt-combobox")!.values).toEqual([]);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("a choice taken back to none is no change", async () => {
  const { app, picker } = await mount();
  await choose(picker, ["p-lager"]);
  await choose(picker, []);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("after commitSaved it does not ask", async () => {
  const { app, picker } = await mount();
  await choose(picker, ["p-lager"]);
  picker.commitSaved();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(await leave(app, picker)).toBe("proceeded");
});

it("after keepChosen it still asks", async () => {
  const { app, picker } = await mount();
  await choose(picker, ["p-lager", "p-burger"]);
  picker.keepChosen(["p-burger"]);
  await picker.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  const pending = leave(app, picker);
  expect((await question(app)).open).toBe(true);
  (await question(app)).shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await pending).not.toBe("proceeded");
});

it("a picker taken out of the page and put back asks before discarding a choice made afterwards", async () => {
  const { app, picker } = await mount();
  await reattachAfterDetachedUpdate(picker);
  await choose(picker, ["p-lager"]);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  const pending = leave(app, picker);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await pending).not.toBe("proceeded");
});

it("a choice made before the picker was taken out and put back still counts, and leaving still asks", async () => {
  const { app, picker } = await mount();
  await choose(picker, ["p-lager"]);
  await reattachAfterDetachedUpdate(picker);
  expect(picker.shadowRoot!.querySelector("wt-combobox")!.values).toEqual(["p-lager"]);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(await addState(picker)).toEqual({ variant: "primary", disabled: false });
  const pending = leave(app, picker);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await pending).not.toBe("proceeded");
});

it("a picker put back after a save compares a later choice with the saved one", async () => {
  const { app, picker } = await mount();
  await choose(picker, ["p-lager"]);
  picker.commitSaved();
  await reattachAfterDetachedUpdate(picker);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await choose(picker, ["p-lager", "p-burger"]);
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
