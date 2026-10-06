import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./seat-dialog.js";
import type { SeatConfirmDetail, TillSeatDialog } from "./seat-dialog.js";

class SeatLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  submitted: SeatConfirmDetail[] = [];
  override render() {
    return html`<till-seat-dialog
        tableLabel="4"
        @seat-cancel=${() => this.closes++}
        @seat-confirm=${(event: CustomEvent<SeatConfirmDetail>) => this.submitted.push(event.detail)}
      ></till-seat-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("seat-leave-test-app", SeatLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<SeatLeaveApp>("seat-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-seat-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillSeatDialog, value: string) {
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
function cancel(form: TillSeatDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-seat-cancel]")!.click();
}
async function question(app: SeatLeaveApp) {
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
  it(`seat ${action} keeps the typed count, then discards without seating`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "3");
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(app.submitted).toEqual([]);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("3");
    if (action === "Escape")
      expect(
        input.getRootNode() instanceof ShadowRoot &&
          (input.getRootNode() as ShadowRoot).activeElement,
      ).toBe(input);
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    expect(input.value).toBe("");
    expect(app.submitted).toEqual([]);
    expect(unload()).toBe(false);
  });
}
it("blank and reverted seat counts close without a warning", async () => {
  const { app, form } = await mount();
  await fill(form, "3");
  expect(unload()).toBe(true);
  await fill(form, "  ");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
for (const value of ["0", "2.5", "3e1", "1000"]) {
  it(`invalid seat count ${value} stays protected after validation refuses it`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, value);
    form.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]")!.click();
    await form.updateComplete;
    expect(app.submitted).toEqual([]);
    expect(form.shadowRoot!.querySelector("wt-input")!.error).toBe(t("seat.guest_count_invalid"));
    expect(unload()).toBe(true);
    cancel(form);
    const q = await question(app);
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe(value);
    expect(app.submitted).toEqual([]);
  });
}
it("submitting seats directly and commits the normalized count without a discard question", async () => {
  const { app, form } = await mount();
  await fill(form, "03");
  form.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]")!.click();
  expect(app.submitted).toEqual([{ guestCount: 3 }]);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(false);
  await fill(form, " 3 ");
  expect(unload()).toBe(false);
  await fill(form, "4");
  expect(unload()).toBe(true);
});
it("disconnect aborts a seat leave decision; reconnect retains the original blank baseline", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "3");
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
  expect(input.value).toBe("3");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("retained departed seat controls cannot submit, cancel or replace the draft", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "3");
  const submit = form.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]")!;
  form.remove();
  submit.click();
  cancel(form);
  input.value = "7";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("3");
  expect(unload()).toBe(true);
});
it("a parent rerender does not reset the typed seat count or pending warning", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "3");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  form.tableLabel = "4, 5";
  await form.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("3");
  expect(unload()).toBe(true);
});
it("a seat submission invalidates a pending Discard and reconnect keeps the accepted count baseline", async () => {
  const { app, form } = await mount();
  await fill(form, "3");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]")!.click();
  expect(app.submitted).toEqual([{ guestCount: 3 }]);
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
  form.remove();
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(unload()).toBe(false);
  await fill(form, "4");
  expect(unload()).toBe(true);
  await fill(form, "03");
  expect(unload()).toBe(false);
});
