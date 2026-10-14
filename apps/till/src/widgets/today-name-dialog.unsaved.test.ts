import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./today-name-dialog.js";
import type {
  TodayNameDetail,
  TodayNameRefusal,
  TillTodayNameDialog,
} from "./today-name-dialog.js";

class TodayNameLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  value = "García birthday";
  busy = false;
  refusal: TodayNameRefusal | null = null;
  closes = 0;
  submitted: TodayNameDetail[] = [];
  override render() {
    return html`<till-today-name-dialog
        heading="Rename García birthday"
        normalName="Counter 4"
        .value=${this.value}
        .busy=${this.busy}
        .refusal=${this.refusal}
        @today-name-cancel=${() => this.closes++}
        @today-name-confirm=${(event: CustomEvent<TodayNameDetail>) =>
          this.submitted.push(event.detail)}
      ></till-today-name-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("today-name-leave-test-app", TodayNameLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(props: Partial<TodayNameLeaveApp> = {}) {
  const { el: app } = await mountWidget<TodayNameLeaveApp>("today-name-leave-test-app", props);
  const form = app.shadowRoot!.querySelector("till-today-name-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillTodayNameDialog, value: string) {
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
function cancel(form: TillTodayNameDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-rename-cancel]")!.click();
}
function save(form: TillTodayNameDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-rename-save]")!.click();
}
async function question(app: TodayNameLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
for (const action of ["Cancel", "Escape"]) {
  it(`${action} keeps the typed name, then discards without renaming`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "Window");
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("Window");
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    expect(input.value).toBe("García birthday");
    expect(app.submitted).toEqual([]);
    expect(unload()).toBe(false);
  });
}
it("a name typed back to the one it opened with closes without a warning", async () => {
  const { app, form } = await mount();
  await fill(form, "Window");
  expect(unload()).toBe(true);
  await fill(form, "  García birthday ");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("a too-long name stays protected after the window refuses it", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "x".repeat(40));
  input.value = "x".repeat(41);
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await form.updateComplete;
  save(form);
  await form.updateComplete;
  expect(app.submitted).toEqual([]);
  expect(form.shadowRoot!.querySelector("wt-input")!.error).toBe(t("table.name_too_long"));
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("x".repeat(41));
});
it("a sent name stays protected while the answer is awaited and after a refusal, until commit()", async () => {
  const { app, form } = await mount();
  await fill(form, "Bar");
  save(form);
  expect(app.submitted).toEqual([{ name: "Bar" }]);
  expect(unload()).toBe(true);
  app.refusal = { code: "table.label_taken", field: "name" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-input")!.error).toBe(
    "Another table already has that name",
  );
  expect(unload()).toBe(true);
  form.commit();
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("while busy, neither Cancel nor Escape closes the window or asks", async () => {
  const { app, form } = await mount();
  await fill(form, "Window");
  save(form);
  app.busy = true;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  cancel(form);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(false);
  expect(app.closes).toBe(0);
  expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
});
it("disconnect aborts a leave decision; reconnect keeps the name typed before it left", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "Window");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(input.value).toBe("Window");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("retained departed controls cannot submit, cancel or replace the draft", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "Window");
  const submit = form.shadowRoot!.querySelector<HTMLElement>("[data-rename-save]")!;
  form.remove();
  submit.click();
  cancel(form);
  input.value = "Bob";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("Window");
  expect(unload()).toBe(true);
});
it("a parent rerender does not reset the typed name or a pending warning", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "Window");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  form.heading = "Rename Counter 4";
  form.normalName = "Bar+Counter 4";
  await form.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("Window");
  expect(unload()).toBe(true);
});
