import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./today-seats-dialog.js";
import type { TillTodaySeatsDialog, TodaySeatsDetail } from "./today-seats-dialog.js";

class TodaySeatsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  seats: number | null = 6;
  action: "join" | "save" = "save";
  closes = 0;
  submitted: TodaySeatsDetail[] = [];
  override render() {
    return html`<till-today-seats-dialog
        heading="Seats for 4+5"
        .seats=${this.seats}
        .action=${this.action}
        @today-seats-cancel=${() => this.closes++}
        @today-seats-confirm=${(event: CustomEvent<TodaySeatsDetail>) =>
          this.submitted.push(event.detail)}
      ></till-today-seats-dialog
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("today-seats-leave-test-app", TodaySeatsLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(props: Partial<TodaySeatsLeaveApp> = {}) {
  const { el: app } = await mountWidget<TodaySeatsLeaveApp>("today-seats-leave-test-app", props);
  const form = app.shadowRoot!.querySelector("till-today-seats-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillTodaySeatsDialog, value: string) {
  const field =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
function cancel(form: TillTodaySeatsDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-seats-cancel]")!.click();
}
async function question(app: TodaySeatsLeaveApp) {
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

it("leaving with a changed number asks first", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "9");
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(app.closes).toBe(0);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("9");
  cancel(form);
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => app.closes).toBe(1);
  expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
  expect(app.submitted).toEqual([]);
  expect(unload()).toBe(false);
});

it("leaving with the opened number closes without asking", async () => {
  const { app, form } = await mount();
  await fill(form, "9");
  expect(unload()).toBe(true);
  await fill(form, "6");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});

it("a confirmed number is the new baseline", async () => {
  const { app, form } = await mount();
  await fill(form, "9");
  form.shadowRoot!.querySelector<HTMLElement>("[data-seats-action]")!.click();
  expect(app.submitted).toEqual([{ seats: 9 }]);
  expect(unload()).toBe(false);
});

it("disconnect aborts a leave decision; reconnect keeps the opened number as the baseline", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "9");
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
  expect(input.value).toBe("9");
  expect(unload()).toBe(true);
  await fill(form, "6");
  expect(unload()).toBe(false);
});

it("retained departed controls cannot confirm, cancel or replace the number", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "9");
  const submit = form.shadowRoot!.querySelector<HTMLElement>("[data-seats-action]")!;
  form.remove();
  submit.click();
  cancel(form);
  input.value = "4";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!
      .value,
  ).toBe("9");
  expect(unload()).toBe(true);
});

it("A747 accepts the suggested Join count without leaving an unsaved draft", async () => {
  const { app, form } = await mount({ seats: 8, action: "join" });
  expect(unload()).toBe(false);
  const button =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-seats-action]")!;
  await button.updateComplete;
  await userEvent.click(page.elementLocator(button.shadowRoot!.querySelector("button")!));
  expect(app.submitted).toEqual([{ seats: 8 }]);
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
