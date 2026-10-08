import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController, registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import type {
  IncludeFolder,
  IncludeFolderInput,
  Presentation,
} from "@waitron/catalogue/src/section-types.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import "./include-folder-form.js";
import "@waitron/dashboard-modules";

registerIcons(DASHBOARD_ICONS);
const own: Presentation = { names: { en: "Drinks", es: "Bebidas" }, image: null, color: null };
const stored: IncludeFolder = { showAsFolder: true, overrides: { names: { en: "Bar" } } };
class IncludeLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  open = true;
  value: IncludeFolder | null = stored;
  cancelled = 0;
  submissions: IncludeFolderInput[] = [];
  override render() {
    return html`<dashboard-include-folder-form
        .open=${this.open}
        .value=${this.value}
        .own=${own}
        menuName="Drinks list"
        .languages=${{ defaultLanguage: "en", languages: ["en", "es"] }}
        @wt-cancel=${() => {
          this.cancelled++;
          this.open = false;
          this.requestUpdate();
        }}
        @wt-submit=${(event: CustomEvent<IncludeFolderInput>) =>
          this.submissions.push(event.detail)}
      ></dashboard-include-folder-form
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("include-leave-test-app", IncludeLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(value: IncludeFolder | null = stored) {
  const { el: app } = await mountWidget<IncludeLeaveApp>("include-leave-test-app", { value });
  const form = app.shadowRoot!.querySelector("dashboard-include-folder-form")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, form };
}
type Form = HTMLElementTagNameMap["dashboard-include-folder-form"];
async function edit(form: Form, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="${name}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
async function toggle(form: Form) {
  const control = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=show-as-folder]",
  )!;
  await control.updateComplete;
  control.shadowRoot!.querySelector<HTMLElement>("input")!.click();
  await form.updateComplete;
}
async function question(app: IncludeLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: HTMLElement) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
const nameValue = (form: Form, name: string) =>
  form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`)?.value;

it("closing with a change asks to discard, keeps the edit through Keep, and cancels once after Discard", async () => {
  const { app, form } = await mount();
  await edit(form, "names-es", "Barra");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(app.cancelled).toBe(0);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  await closeReportsDelivered();
  expect(nameValue(form, "names-es")).toBe("Barra");
  cancel(form);
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => app.cancelled).toBe(1);
  await closeReportsDelivered();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("closing unchanged does not ask, and an edit typed back to the start is no change", async () => {
  const { app, form } = await mount();
  await edit(form, "names-en", "Bar counter");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "names-en", " Bar ");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("switching the folder off is a change, and switching it back on is not", async () => {
  const { app, form } = await mount();
  await toggle(form);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await toggle(form);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a refreshed included menu or stored folder does not make an untouched dialog count as changed", async () => {
  const { app, form } = await mount();
  form.own = {
    names: { en: "Beverages", es: "Bebidas nuevas" },
    image: "renamed",
    color: "#123456",
  };
  form.value = { showAsFolder: true, overrides: { names: { en: "Bar", fr: "Boissons" } } };
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("after closeSaved it does not ask", async () => {
  const { app, form } = await mount();
  await edit(form, "names-es", "Barra");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect(app.submissions).toEqual([
    { showAsFolder: true, overrides: { names: { en: "Bar", es: "Barra" } } },
  ]);
  form.closeSaved(app.submissions[0]!);
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.cancelled).toBe(0);
});
it("commitSaved keeps a later edit as a change", async () => {
  const { app, form } = await mount();
  await edit(form, "names-es", "Barra");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await edit(form, "names-es", "Barra nueva");
  form.commitSaved(app.submissions[0]!);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "names-es", "Barra");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a change only in a hidden field while the switch is off does not count, and switching on makes it count again", async () => {
  const { app, form } = await mount({ showAsFolder: false, overrides: { names: { en: "Bar" } } });
  expect(nameValue(form, "names-en")).toBeUndefined();
  await toggle(form);
  expect(nameValue(form, "names-en")).toBe("Bar");
  await edit(form, "names-es", "Barra");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await toggle(form);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await toggle(form);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await toggle(form);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
async function discardByNavigation(app: IncludeLeaveApp, form: Form) {
  const pending = app.leave.coordinator.request({
    scopes: [form],
    reason: "navigation",
    proceed() {},
  });
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await pending).toBe("proceeded");
  await form.updateComplete;
}
it("Discard restores a starting point with the switch on: the switch and the fields as they were", async () => {
  const { app, form } = await mount();
  await edit(form, "names-en", "Edited");
  await toggle(form);
  await discardByNavigation(app, form);
  expect(nameValue(form, "names-en")).toBe("Bar");
  expect(nameValue(form, "names-es")).toBe("Bebidas");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("Discard restores a starting point with the switch off, filling the hidden fields from the stored folder", async () => {
  const { app, form } = await mount({ showAsFolder: false, overrides: { names: { en: "Bar" } } });
  await toggle(form);
  await edit(form, "names-en", "Edited");
  await discardByNavigation(app, form);
  expect(nameValue(form, "names-en")).toBeUndefined();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await toggle(form);
  expect(nameValue(form, "names-en")).toBe("Bar");
  expect(nameValue(form, "names-es")).toBe("Bebidas");
});
it("an include taken out of the page and put back asks before discarding an edit made afterwards", async () => {
  const { app, form } = await mount();
  const parent = form.parentNode!;
  form.remove();
  await form.updateComplete;
  parent.appendChild(form);
  await form.updateComplete;
  await edit(form, "names-es", "Barra");
  expect(nameValue(form, "names-es")).toBe("Barra");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.cancelled).toBe(0);
});
async function saveState(form: Form) {
  await form.updateComplete;
  const save = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "wt-button[data-test=save]",
  )!;
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quietSave = { variant: "secondary", disabled: true, innerDisabled: true };
it("an include keeps an edit made before it was taken out and put back, and still asks", async () => {
  const { app, form } = await mount();
  await edit(form, "names-es", "Barra");
  await reattachAfterDetachedUpdate(form);
  expect(nameValue(form, "names-es")).toBe("Barra");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(await saveState(form)).toEqual({
    variant: "primary",
    disabled: false,
    innerDisabled: false,
  });
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.cancelled).toBe(0);
});
it("an include reopened on another folder after a put-back save opens quiet with that folder", async () => {
  const { app, form } = await mount();
  await edit(form, "names-es", "Barra");
  await reattachAfterDetachedUpdate(form);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  form.closeSaved(app.submissions[0]!);
  expect(form.open).toBe(false);
  await closeReportsDelivered();
  form.value = { showAsFolder: true, overrides: { names: { en: "Cellar" } } };
  form.open = true;
  await form.updateComplete;
  expect(nameValue(form, "names-en")).toBe("Cellar");
  expect(nameValue(form, "names-es")).toBe("Bebidas");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(await saveState(form)).toEqual(quietSave);
  await edit(form, "names-en", "Wine cellar");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "names-en", "Cellar");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("an include saved while open and then taken out and put back stays quiet", async () => {
  const { app, form } = await mount();
  await edit(form, "names-es", "Barra");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  form.commitSaved(app.submissions[0]!);
  await reattachAfterDetachedUpdate(form);
  expect(nameValue(form, "names-es")).toBe("Barra");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(await saveState(form)).toEqual(quietSave);
});
