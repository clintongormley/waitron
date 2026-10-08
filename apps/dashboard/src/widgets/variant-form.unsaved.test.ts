import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { ProductEditorVariant } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import "./variant-form.js";

const half: ProductEditorVariant = {
  id: "8f1f2f3f-4f5f-4f6f-8f7f-9f8f7f6f5f4f",
  name: "Media",
  customerName: null,
  kitchenName: "1/2 RAC",
  image: null,
  unitPrice: "6.50",
  available: true,
  active: true,
};
const whole: ProductEditorVariant = {
  id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  name: "Entera",
  customerName: null,
  kitchenName: "RAC",
  image: null,
  unitPrice: "11.00",
  available: true,
  active: true,
};

class VariantFormApp extends LitElement {
  readonly leave = new LeaveController(this);
  cancels = 0;
  override render() {
    return html`<dashboard-variant-form
        .open=${true}
        .value=${half}
        .locales=${["es", "en"]}
        unitLabel="kg"
        basePrice="9.00"
        @wt-cancel=${() => this.cancels++}
      ></dashboard-variant-form
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("variant-form-leave-test-app", VariantFormApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<VariantFormApp>("variant-form-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-variant-form")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, form };
}
function nameField(form: HTMLElement) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    'wt-input[name="name"]',
  )!;
}
async function editName(form: HTMLElementTagNameMap["dashboard-variant-form"], value: string) {
  const field = nameField(form);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
async function question(app: VariantFormApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function saveButton(form: HTMLElementTagNameMap["dashboard-variant-form"]) {
  await form.updateComplete;
  const save = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "wt-button[data-test=variant-save]",
  )!;
  await save.updateComplete;
  return { variant: save.variant, disabled: save.disabled };
}
function cancel(form: HTMLElement) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=variant-cancel]")!.click();
}

it("a variant put back after a detached update still asks before Escape discards an edit", async () => {
  const { app, form } = await mount();
  await reattachAfterDetachedUpdate(form);
  await editName(form, "Media ración");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  expect(form.open).toBe(true);
  expect(app.cancels).toBe(0);
});
it("a variant keeps an edit made before it was taken out and put back, and still asks", async () => {
  const { app, form } = await mount();
  await editName(form, "Media ración");
  await reattachAfterDetachedUpdate(form);
  expect(nameField(form).value).toBe("Media ración");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(await saveButton(form)).toEqual({ variant: "primary", disabled: false });
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(form.open).toBe(true);
  expect(app.cancels).toBe(0);
});
it("a variant reopened on another variant after a put-back save opens quiet with that variant", async () => {
  const { app, form } = await mount();
  await editName(form, "Media ración");
  await reattachAfterDetachedUpdate(form);
  form.closeSaved({ ...half, name: "Media ración" });
  expect(form.open).toBe(false);
  await closeReportsDelivered();
  form.value = whole;
  form.open = true;
  await form.updateComplete;
  expect(nameField(form).value).toBe("Entera");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await saveButton(form)).disabled).toBe(true);
  await editName(form, "Entera grande");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await editName(form, "Entera");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
