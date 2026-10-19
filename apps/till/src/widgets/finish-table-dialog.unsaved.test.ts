import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { UnservedDish } from "../api/finish-table-types.js";
import type { AdjustmentReason } from "../api/client.js";
import "./finish-table-dialog.js";
import type { TillFinishTableDialog } from "./finish-table-dialog.js";

class FinishLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  dishes: UnservedDish[] = [
    {
      billId: "b",
      billRevision: 1,
      lineId: "flan",
      name: "Flan",
      quantity: "1.000",
      context: {
        billStatus: "settled",
        stage: "not_started",
        components: [
          {
            id: "t",
            lineId: "flan",
            state: "queued",
            firedAt: "2026-10-19T12:00:00Z",
            quantity: "1.000",
            kitchenQuantity: "1.000",
            servedQuantity: "0.000",
            cancelledQuantity: "0.000",
          },
        ],
      },
    },
  ];
  reasons: AdjustmentReason[] = [
    {
      id: "house",
      name: "House",
      actions: ["cancel"],
      noteRequired: true,
      maxPercentBp: null,
      maxAmount: null,
      applyRole: "manager",
      approverRole: "manager",
    },
  ];
  override render() {
    return html`<till-finish-table-dialog
        .dishes=${this.dishes}
        .refunds=${{ flan: "5.50" }}
        .reasons=${this.reasons}
        defaultReasonId="house"
        @finish-table-close=${() => this.closes++}
      >
      </till-finish-table-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("finish-leave-test-app", FinishLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount() {
  const { el: app } = await mountWidget<FinishLeaveApp>("finish-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-finish-table-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
const close = (form: TillFinishTableDialog) =>
  form.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
const unload = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
async function question(app: FinishLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function answer(form: TillFinishTableDialog) {
  await userEvent.click(
    page.elementLocator(form.shadowRoot!.querySelector<HTMLElement>('input[value="no"]')!),
  );
  await form.updateComplete;
}
it.each(["Back", "Escape"])(
  "%s protects the preparation answer and refund choice; Keep retains and Discard closes",
  async (action) => {
    const { app, form } = await mount();
    expect(unload()).toBe(false);
    await answer(form);
    expect(unload()).toBe(true);
    if (action === "Back") close(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(form.shadowRoot!.querySelector<HTMLInputElement>('input[value="no"]')!.checked).toBe(
      true,
    );
    expect(form.shadowRoot!.querySelector<HTMLInputElement>('input[name="refund"]')!.checked).toBe(
      true,
    );
    close(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(unload()).toBe(false);
  },
);
it("disconnect cancels a pending leave answer and reconnect keeps the original baseline", async () => {
  const { app, form } = await mount();
  await answer(form);
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
  expect(form.shadowRoot!.querySelector<HTMLInputElement>('input[value="no"]')!.checked).toBe(true);
  expect(unload()).toBe(true);
});
it("new observed food retires an old leave choice and resets its answers", async () => {
  const { app, form } = await mount();
  await answer(form);
  close(form);
  const q = await question(app);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  app.dishes = [{ ...app.dishes[0]!, quantity: "2.000", billRevision: 2 }];
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  expect(form.shadowRoot!.querySelector<HTMLInputElement>('input[value="no"]')!.checked).toBe(
    false,
  );
  expect(unload()).toBe(false);
});
it("required reason notes are staged and returning to the opened note clears the warning", async () => {
  const { form } = await mount();
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Guest left",
  );
  await form.updateComplete;
  expect(unload()).toBe(true);
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "");
  await form.updateComplete;
  expect(unload()).toBe(false);
});
