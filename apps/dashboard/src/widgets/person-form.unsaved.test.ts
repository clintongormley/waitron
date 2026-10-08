import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { LeaveController, registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import "./person-form.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
class PersonFormApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  submitted: unknown[] = [];
  override render() {
    return html`<dashboard-person-form
        .open=${true}
        @wt-close=${() => this.closes++}
        @create-person=${(e: CustomEvent) => this.submitted.push(e.detail)}
      ></dashboard-person-form
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("person-form-leave-test-app", PersonFormApp);
async function mount() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<PersonFormApp>("person-form-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-person-form")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, form };
}
async function edit(form: HTMLElement, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[data-test="${name}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await (form as HTMLElementTagNameMap["dashboard-person-form"]).updateComplete;
}
async function question(app: PersonFormApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: HTMLElement) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}
for (const route of ["cancel", "escape"] as const) {
  it(`Add staff ${route} keeps entered details until one explicit Discard`, async () => {
    const { app, form } = await mount();
    await edit(form, "first-names", "Ada");
    if (route === "cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(
      form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=first-names]")!
        .value,
    ).toBe("Ada");
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
    await expect.poll(() => app.closes).toBe(1);
    await closeReportsDelivered();
    expect(app.closes).toBe(1);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(form.open).toBe(false);
  });
}
it("Add staff change and normalized revert update browser unload immediately", async () => {
  const { app, form } = await mount();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await edit(form, "telephone", "+44 20");
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  await edit(form, "telephone", " ");
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("an Add staff role choice is protected and reverting it closes without a question", async () => {
  const { app, form } = await mount();
  const role = form.shadowRoot!.querySelector("wt-combobox")!;
  await chooseOption(role, "manager");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await chooseOption(role, "staff");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("a refused Add staff request retains its normalized submitted values and warning", async () => {
  const { app, form } = await mount();
  await edit(form, "first-names", " Ada ");
  await edit(form, "last-names", " Lovelace ");
  await edit(form, "display-name", " Ada ");
  await edit(form, "email", " ada@example.com ");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  expect(app.submitted).toEqual([
    {
      firstNames: "Ada",
      lastNames: "Lovelace",
      displayName: "Ada",
      email: "ada@example.com",
      telephone: null,
      role: "staff",
    },
  ]);
  form.error = "connection.failed";
  await form.updateComplete;
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.closes).toBe(0);
});

it("Add staff blocks Cancel and native Escape while its write is pending", async () => {
  const { app, form } = await mount();
  await edit(form, "first-names", "Ada");
  Object.assign(form, { busy: true });
  await form.updateComplete;
  cancel(form);
  await userEvent.keyboard("{Escape}");
  await closeReportsDelivered();
  expect(
    form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
  ).toBe(true);
  expect((await question(app)).open).toBe(false);
  expect(app.closes).toBe(0);
});
it("standalone Add staff Cancel reports once after the native delayed close", async () => {
  const { el: form } = await mountWidget<HTMLElementTagNameMap["dashboard-person-form"]>(
    "dashboard-person-form",
    { open: true },
  );
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  let closed = 0;
  form.addEventListener("wt-close", () => closed++);
  cancel(form);
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  await closeReportsDelivered();
  expect(closed).toBe(1);
  expect(form.open).toBe(false);
});
function firstNamesField(form: HTMLElement) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[data-test=first-names]",
  )!;
}
async function confirmButton(form: HTMLElementTagNameMap["dashboard-person-form"]) {
  await form.updateComplete;
  const confirm = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "wt-button[data-test=confirm]",
  )!;
  await confirm.updateComplete;
  return { variant: confirm.variant, disabled: confirm.disabled };
}
it("Add staff put back after a detached update still asks before Escape discards an edit", async () => {
  const { app, form } = await mount();
  await reattachAfterDetachedUpdate(form);
  await edit(form, "first-names", "Ada");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  expect(form.open).toBe(true);
  expect(app.closes).toBe(0);
});
it("Add staff keeps an edit made before it was taken out and put back, and still asks", async () => {
  const { app, form } = await mount();
  await edit(form, "first-names", "Ada");
  await reattachAfterDetachedUpdate(form);
  expect(firstNamesField(form).value).toBe("Ada");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(await confirmButton(form)).toEqual({ variant: "primary", disabled: false });
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(form.open).toBe(true);
  expect(app.closes).toBe(0);
});
it("Add staff reopened after a put-back entry was saved opens quiet and empty", async () => {
  const { app, form } = await mount();
  await edit(form, "first-names", "Ada");
  await reattachAfterDetachedUpdate(form);
  expect(
    form.closeSaved({
      firstNames: "Ada",
      lastNames: "",
      displayName: "Ada",
      email: "",
      telephone: null,
      role: "staff",
    }),
  ).toBe(true);
  expect(form.open).toBe(false);
  await closeReportsDelivered();
  form.open = true;
  await form.updateComplete;
  expect(firstNamesField(form).value).toBe("");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await confirmButton(form)).disabled).toBe(true);
  await edit(form, "first-names", "Bea");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "first-names", "");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
