import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import type { CatalogueSummary } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./menu-copy-dialog.js";

registerIcons(DASHBOARD_ICONS);
const source = { id: "lunch", name: "Lunch" };
const copied = { id: "copy", name: "Weekday lunch", active: true, version: 1 };
class CopyLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  open = true;
  api = { duplicateCatalogue: vi.fn(async () => copied) };
  override render() {
    return html`<dashboard-menu-copy-dialog
        .open=${this.open}
        .menu=${source}
        .api=${this.api}
        @menu-copy-close=${() => {
          this.open = false;
          this.requestUpdate();
        }}
        @menu-copied=${() => {
          this.open = false;
          this.requestUpdate();
        }}
      ></dashboard-menu-copy-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("menu-copy-leave-test-app", CopyLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount() {
  const { el: app } = await mountWidget<CopyLeaveApp>("menu-copy-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-menu-copy-dialog")!;
  await form.updateComplete;
  return { app, form };
}
type Form = HTMLElementTagNameMap["dashboard-menu-copy-dialog"];
const field = (form: Form) =>
  form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!;
async function edit(form: Form, value = "Weekday lunch") {
  await field(form).updateComplete;
  await userEvent.fill(page.elementLocator(field(form).shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
const button = (form: Form, name: string) =>
  form.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`)!;
async function choice(app: CopyLeaveApp, decision: "keep" | "discard") {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
  await closeReportsDelivered();
}
it("keeps typed input on Keep editing, then discards it without copying", async () => {
  const { app, form } = await mount();
  await edit(form);
  button(form, "cancel").click();
  await choice(app, "keep");
  expect(form.open).toBe(true);
  expect(field(form).value).toBe("Weekday lunch");
  button(form, "cancel").click();
  await choice(app, "discard");
  await expect.poll(() => form.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.api.duplicateCatalogue).not.toHaveBeenCalled();
});
it("Escape protects the name; reverting to empty cancels without a question", async () => {
  const { app, form } = await mount();
  await edit(form);
  await userEvent.keyboard("{Escape}");
  await choice(app, "keep");
  await edit(form, "");
  button(form, "cancel").click();
  await expect.poll(() => form.open).toBe(false);
  expect(app.api.duplicateCatalogue).not.toHaveBeenCalled();
});
it("a successful copy commits before its close and a failed refresh cannot restore the draft", async () => {
  const { app, form } = await mount();
  await edit(form);
  let dirtyAtClose: boolean | undefined;
  form.addEventListener("menu-copied", () => {
    dirtyAtClose = app.leave.coordinator.isDirty();
  });
  button(form, "copy").click();
  await expect.poll(() => form.open).toBe(false);
  expect(dirtyAtClose).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a refusal retains the draft and still asks before cancelling", async () => {
  const { app, form } = await mount();
  app.api.duplicateCatalogue.mockRejectedValue({ code: "catalogue.not_found" });
  await edit(form);
  button(form, "copy").click();
  await expect.poll(() => form.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  button(form, "cancel").click();
  await choice(app, "keep");
  expect(field(form).value).toBe("Weekday lunch");
});
it("an old native close report cannot close a later opening", async () => {
  const { app, form } = await mount();
  const old = form.shadowRoot!.querySelector("wt-modal")!;
  app.open = false;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  app.open = true;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  await edit(form, "New opening");
  old.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await form.updateComplete;
  expect(form.open).toBe(true);
  expect(field(form).value).toBe("New opening");
});
it.each([true, false])(
  "a departed copy reply (success=%s) leaves a new opening untouched",
  async (success) => {
    const { app, form } = await mount();
    let resolve!: (value: CatalogueSummary) => void;
    let reject!: (reason: unknown) => void;
    app.api.duplicateCatalogue.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    await edit(form);
    button(form, "copy").click();
    await form.updateComplete;
    app.open = false;
    app.requestUpdate();
    await app.updateComplete;
    await form.updateComplete;
    app.open = true;
    app.requestUpdate();
    await app.updateComplete;
    await form.updateComplete;
    await edit(form, "Later copy");
    if (success) resolve(copied);
    else reject({ code: "menu.name_taken", params: { field: "name" } });
    await closeReportsDelivered();
    await form.updateComplete;
    expect(form.open).toBe(true);
    expect(field(form).value).toBe("Later copy");
    expect(field(form).error).toBe("");
    expect(app.leave.coordinator.isDirty()).toBe(true);
  },
);
