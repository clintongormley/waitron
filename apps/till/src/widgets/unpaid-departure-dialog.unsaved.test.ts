import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./unpaid-departure-dialog.js";
import type { TillUnpaidDepartureDialog } from "./unpaid-departure-dialog.js";

class DepartureLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  submitted: { reason: string }[] = [];
  override render() {
    return html`<till-unpaid-departure-dialog
        .bills=${[{ workingOrderId: "wo-4", name: "4 · Bill 1", outstanding: "14.00" }]}
        @unpaid-departure-close=${() => this.closes++}
        @unpaid-departure-continue=${(event: CustomEvent<{ reason: string }>) =>
          this.submitted.push(event.detail)}
      ></till-unpaid-departure-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("departure-leave-test-app", DepartureLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<DepartureLeaveApp>("departure-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-unpaid-departure-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillUnpaidDepartureDialog, value: string) {
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
function cancel(form: TillUnpaidDepartureDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-departure-close]")!.click();
}
function submit(form: TillUnpaidDepartureDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-departure-confirm]")!.click();
}
async function question(app: DepartureLeaveApp) {
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
  it(`departure ${action} preserves the reason until Discard, without recording anything`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "  Left during clearing  ");
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(app.submitted).toEqual([]);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("  Left during clearing  ");
    expect(
      input.getRootNode() instanceof ShadowRoot &&
        (input.getRootNode() as ShadowRoot).activeElement,
    ).toBe(input);
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    await form.updateComplete;
    expect(input.value).toBe("");
    expect(app.submitted).toEqual([]);
    expect(unload()).toBe(false);
    form
      .shadowRoot!.querySelector("wt-dialog")!
      .shadowRoot!.querySelector("dialog")!
      .dispatchEvent(new Event("close"));
    expect(app.closes).toBe(1);
  });
}
it("empty and reverted departure reasons close directly", async () => {
  const { app, form } = await mount();
  await fill(form, "Ran off");
  expect(unload()).toBe(true);
  await fill(form, "   ");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
it("departure submission sends the exact trimmed reason directly and a refusal keeps it protected", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "  Ran off  ");
  submit(form);
  expect(app.submitted).toEqual([{ reason: "Ran off" }]);
  expect((await question(app)).open).toBe(false);
  form.refusal = { code: "management.request_invalid", field: "reason" };
  form.bills = [{ workingOrderId: "wo-4", name: "4 · Bill 1", outstanding: "12.00" }];
  await form.updateComplete;
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("  Ran off  ");
  expect(app.submitted).toEqual([{ reason: "Ran off" }]);
});
it("an invalid departure reason stays protected after validation", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "x".repeat(501));
  submit(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-input")!.error).toBe(t("departure.reason_long"));
  expect(app.submitted).toEqual([]);
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(input.value).toBe("x".repeat(501));
});
it("a busy departure cannot be cancelled or submitted again and Escape does not ask", async () => {
  const { app, form } = await mount();
  await fill(form, "Ran off");
  form.busy = true;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  cancel(form);
  submit(form);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(false);
  expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
  expect(app.closes).toBe(0);
  expect(app.submitted).toEqual([]);
});
it("removing a recorded departure aborts an outstanding answer and unregisters its reason", async () => {
  const { app, form } = await mount();
  await fill(form, "Ran off");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(unload()).toBe(false);
  expect(app.closes).toBe(0);
  expect(app.submitted).toEqual([]);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("Ran off");
  expect(unload()).toBe(true);
});
it("departed departure controls cannot submit, close or replace a retained reason", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "Ran off");
  const confirm = form.shadowRoot!.querySelector<HTMLElement>("[data-departure-confirm]")!;
  form.remove();
  confirm.click();
  cancel(form);
  input.value = "Changed after leaving";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(input.value).toBe("Ran off");
  expect(unload()).toBe(true);
});
