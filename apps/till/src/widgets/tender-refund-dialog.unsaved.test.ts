import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TenderRefundAsk, SavedTenderRefund } from "../state/tender-refund.js";
import "./tender-refund-dialog.js";
import type { TillTenderRefundDialog } from "./tender-refund-dialog.js";

class TenderRefundLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  asks: TenderRefundAsk[] = [];
  attempt: SavedTenderRefund | null = null;
  override render() {
    return html`<till-tender-refund-dialog
        .invoiceNumber=${"F/12"}
        .tenders=${[{ tenderId: "t1", method: "card", last4: "0099", appliedRemaining: "40.00", tipRemaining: "5.00", manual: false, pendingRefundId: null }]}
        .attempt=${this.attempt}
        @tender-refund-close=${() => this.closes++}
        @tender-refund-submit=${(e: CustomEvent<TenderRefundAsk>) => this.asks.push(e.detail)}
      ></till-tender-refund-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("tender-refund-leave-test-app", TenderRefundLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(attempt: SavedTenderRefund | null = null) {
  const { el: app } = await mountWidget<TenderRefundLeaveApp>("tender-refund-leave-test-app", {
    attempt,
  });
  const form = app.shadowRoot!.querySelector("till-tender-refund-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillTenderRefundDialog, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name=${name}]`,
  )!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
const cancel = (form: TillTenderRefundDialog) =>
  form.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
async function question(app: TenderRefundLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

for (const action of ["Cancel", "Escape"] as const) {
  it(`${action} keeps staged amount and reason until Discard and never sends a refund`, async () => {
    const { app, form } = await mount();
    await fill(form, "appliedAmount", "12.50");
    await fill(form, "tipAmount", "0");
    const reason = await fill(form, "reason", "Courtesy return");
    expect(unload()).toBe(true);
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.asks).toEqual([]);
    expect(app.closes).toBe(0);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(reason.value).toBe("Courtesy return");
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=appliedAmount]")!
        .value,
    ).toBe("12.50");
    cancel(form);
    expect((await question(app)).open).toBe(true);
    const closed = new Promise<void>((resolve) =>
      form.addEventListener("tender-refund-close", () => resolve(), { once: true }),
    );
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await closed;
    expect(app.closes).toBe(1);
    expect(app.asks).toEqual([]);
    expect(unload()).toBe(false);
  });
}

it("an unchanged or numerically equivalent draft closes without a discard question", async () => {
  const { app, form } = await mount();
  await fill(form, "appliedAmount", "040.0");
  await fill(form, "tipAmount", "5");
  await fill(form, "reason", "  ");
  expect(unload()).toBe(false);
  const closed = new Promise<void>((resolve) =>
    form.addEventListener("tender-refund-close", () => resolve(), { once: true }),
  );
  cancel(form);
  await closed;
  expect((await question(app)).open).toBe(false);
  expect(app.asks).toEqual([]);
});

it("a restored unanswered request is the baseline and can close while the journal keeps its identity", async () => {
  const attempt: SavedTenderRefund = {
    saleId: "s1",
    request: {
      submissionId: "sub1",
      tenderId: "t1",
      appliedAmount: "12.50",
      tipAmount: "0.00",
      reason: "Saved return",
    },
    refundId: "r1",
  };
  const { app, form } = await mount(attempt);
  expect(unload()).toBe(false);
  const closed = new Promise<void>((resolve) =>
    form.addEventListener("tender-refund-close", () => resolve(), { once: true }),
  );
  cancel(form);
  await closed;
  expect((await question(app)).open).toBe(false);
  expect(app.asks).toEqual([]);
  expect(app.attempt).toEqual(attempt);
});

it("disconnect aborts a pending question; reconnect retains the original baseline and draft", async () => {
  const { app, form } = await mount();
  await fill(form, "reason", "Saved return");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.append(form);
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=reason]")!.value,
  ).toBe("Saved return");
  expect(unload()).toBe(true);
  expect(app.asks).toEqual([]);
});

it("closeSaved commits before leaving and invalidates an older unsaved question", async () => {
  const { app, form } = await mount();
  await fill(form, "reason", "Return");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  form.closeSaved();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  expect(app.asks).toEqual([]);
});

it("busy Cancel and Escape cannot discard or send the staged request", async () => {
  const { app, form } = await mount();
  await fill(form, "reason", "Return");
  form.busy = true;
  await form.updateComplete;
  cancel(form);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(false);
  expect(app.closes).toBe(0);
  expect(app.asks).toEqual([]);
  expect(unload()).toBe(true);
});
