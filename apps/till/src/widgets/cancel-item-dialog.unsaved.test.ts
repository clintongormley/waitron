import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { CancellationRead } from "../api/line-cancel-types.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./cancel-item-dialog.js";
import type { TillCancelItemDialog } from "./cancel-item-dialog.js";

class CancelLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  consent: CancellationRead = {
    billId: "b",
    revision: 1,
    billRevision: 1,
    context: {
      billStatus: "open",
      stage: "not_started",
      components: [
        {
          id: "t",
          lineId: "dish",
          state: "queued",
          firedAt: null,
          quantity: "3.000",
          kitchenQuantity: "3.000",
          servedQuantity: "0.000",
          cancelledQuantity: "0.000",
        },
      ],
    },
  };
  override render() {
    return html`<till-cancel-item-dialog
        name="Pizza"
        lineId="dish"
        .consent=${this.consent}
        @cancel-item-close=${() => this.closes++}
      ></till-cancel-item-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("cancel-leave-test-app", CancelLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount() {
  const { el: app } = await mountWidget<CancelLeaveApp>("cancel-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-cancel-item-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillCancelItemDialog, value: string) {
  const stepper = form.shadowRoot!.querySelector("wt-number-stepper")!;
  await stepper.updateComplete;
  await userEvent.fill(page.elementLocator(stepper.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
const close = (form: TillCancelItemDialog) =>
  form.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
const unload = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
async function question(app: CancelLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
it.each(["Close", "Escape"])(
  "%s protects the chosen quantity, Keep retains it and Discard closes",
  async (action) => {
    const { app, form } = await mount();
    await fill(form, "2");
    if (action === "Close") close(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(form.shadowRoot!.querySelector("wt-number-stepper")!.value).toBe("2");
    close(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    expect(unload()).toBe(false);
  },
);
it("an equivalent quantity reversion has no unsaved warning", async () => {
  const { app, form } = await mount();
  await fill(form, "2");
  expect(unload()).toBe(true);
  await fill(form, "03");
  expect(unload()).toBe(false);
  close(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("disconnect aborts a pending leave choice and reconnect preserves its original baseline", async () => {
  const { app, form } = await mount();
  await fill(form, "2");
  close(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-number-stepper")!.value).toBe("2");
  expect(unload()).toBe(true);
});
it("refreshed consent aborts an old Discard and resets to the new active quantity", async () => {
  const { app, form } = await mount();
  await fill(form, "2");
  close(form);
  const q = await question(app);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  const consent = structuredClone(app.consent);
  consent.context.components[0]!.cancelledQuantity = "2.000";
  app.consent = consent;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  expect(form.shadowRoot!.querySelector("wt-number-stepper")!.value).toBe("1");
  expect(unload()).toBe(false);
});
it("a selected money choice is staged input even when the quantity is unchanged", async () => {
  const { app, form } = await mount();
  const consent = structuredClone(app.consent);
  consent.context.stage = "started";
  app.consent = consent;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(unload()).toBe(false);
  await userEvent.click(
    page.elementLocator(form.shadowRoot!.querySelector<HTMLElement>("input[value=keep_charge]")!),
  );
  expect(unload()).toBe(true);
  close(form);
  expect((await question(app)).open).toBe(true);
});
