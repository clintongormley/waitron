import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./bill-pay-dialog.js";
import type { PayRequest, TillBillPayDialog } from "./bill-pay-dialog.js";

class BillPayLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  edits = 0;
  confirms = 0;
  requests: PayRequest[] = [];
  override render() {
    return html`<till-bill-pay-dialog
        .balance=${{ workingOrderId: "bill-1", status: "open", total: "30.00", received: "0.00", reserved: "0.00", outstanding: "30.00", tips: "0.00", payments: [], paidLines: [] }}
        .way=${"contribution"}
        .amount=${"10.00"}
        @bill-pay-close=${() => this.closes++}
        @bill-pay-edit=${() => this.edits++}
        @bill-pay-confirm=${() => this.confirms++}
        @bill-pay-preview=${(event: CustomEvent<PayRequest>) => this.requests.push(event.detail)}
      ></till-bill-pay-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("bill-pay-leave-test-app", BillPayLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<BillPayLeaveApp>("bill-pay-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-bill-pay-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
function click(form: TillBillPayDialog, selector: string) {
  form.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
}
async function fill(form: TillBillPayDialog, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name=${name}]`,
  )!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
async function question(app: BillPayLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function answer(app: BillPayLeaveApp, decision: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
for (const route of ["Close", "Escape"] as const) {
  it(`bill payment ${route} preserves edited cash until explicit Discard without taking payment`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "tendered", "20.00");
    if (route === "Close") click(form, "[data-pay-close]");
    else await userEvent.keyboard("{Escape}");
    expect((await question(app)).open).toBe(true);
    expect(app.closes).toBe(0);
    await answer(app, "keep");
    expect(input.value).toBe("20.00");
    expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
    expect(unload()).toBe(true);
    if (route === "Close") click(form, "[data-pay-close]");
    else await userEvent.keyboard("{Escape}");
    await answer(app, "discard");
    await expect.poll(() => app.closes).toBe(1);
    expect(unload()).toBe(false);
    expect(app.requests).toEqual([]);
    expect(app.confirms).toBe(0);
  });
}
it("clean and normalized amount reverts close without a warning", async () => {
  const { app, form } = await mount();
  await fill(form, "amount", "10,0");
  expect(unload()).toBe(false);
  await fill(form, "amount", "12.00");
  expect(unload()).toBe(true);
  await fill(form, "amount", "10.00");
  expect(unload()).toBe(false);
  click(form, "[data-pay-close]");
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("manual card references compare trimmed values and keep invalid money distinguishable", async () => {
  const { app, form } = await mount();
  click(form, "input[name=method][value=card]");
  await form.updateComplete;
  await fill(form, "externalRef", "  slip-9  ");
  click(form, "[data-pay-close]");
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  click(form, "[data-pay-continue]");
  await expect.poll(() => app.requests.length).toBe(1);
  expect(app.requests).toEqual([
    {
      choice: { kind: "contribution", amount: "10.00" },
      pay: { method: "card" },
      card: { entry: "manual", externalRef: "slip-9" },
    },
  ]);
  expect((await question(app)).open).toBe(false);
  form.refusal = { code: "network" };
  await form.updateComplete;
  expect(unload()).toBe(true);
  await fill(form, "cardTip", "bad");
  click(form, "[data-pay-continue]");
  await form.updateComplete;
  expect(app.requests).toHaveLength(1);
  expect(unload()).toBe(true);
});
it("Back from cash confirmation asks only for the staged tip and retains payment entry", async () => {
  const { app, form } = await mount();
  await fill(form, "tendered", "20.00");
  click(form, "[data-pay-continue]");
  await expect.poll(() => app.requests.length).toBe(1);
  form.asked = app.requests[0]!;
  form.preview = {
    kind: "allocated",
    choice: null,
    applied: "10.00",
    tip: "0.00",
    change: "10.00",
    charged: null,
  };
  await form.updateComplete;
  click(form, "input[name=leaveTip][value=part]");
  await form.updateComplete;
  await fill(form, "tipAmount", "2.00");
  click(form, "[data-pay-back]");
  expect((await question(app)).open).toBe(true);
  expect(app.edits).toBe(0);
  await answer(app, "keep");
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=tipAmount]")!.value,
  ).toBe("2.00");
  click(form, "[data-pay-back]");
  await answer(app, "discard");
  await expect.poll(() => app.edits).toBe(1);
  form.asked = null;
  form.preview = null;
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=tendered]")!.value,
  ).toBe("20.00");
  expect(unload()).toBe(true);
  expect(app.confirms).toBe(0);
});
it("successful payment resets the entry baseline before subsequent reads", async () => {
  const { app, form } = await mount();
  await fill(form, "tendered", "20.00");
  expect(unload()).toBe(true);
  form.taken = { change: "10.00" };
  await form.updateComplete;
  expect(unload()).toBe(false);
  click(form, "[data-pay-close]");
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("busy payment invalidates an old Discard and blocks dismissal while retaining refusal drafts", async () => {
  const { app, form } = await mount();
  await fill(form, "tendered", "20.00");
  click(form, "[data-pay-close]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const old = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.busy = true;
  await form.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  old.click();
  await userEvent.keyboard("{Escape}");
  expect(app.closes).toBe(0);
  form.busy = false;
  form.refusal = { code: "network" };
  await form.updateComplete;
  expect(unload()).toBe(true);
  click(form, "[data-pay-close]");
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
});
it("disconnect aborts dismissal and departed controls cannot preview or close", async () => {
  const { app, form } = await mount();
  await fill(form, "tendered", "20.00");
  click(form, "[data-pay-close]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldContinue = form.shadowRoot!.querySelector<HTMLElement>("[data-pay-continue]")!;
  const oldClose = form.shadowRoot!.querySelector<HTMLElement>("[data-pay-close]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  oldContinue.click();
  oldClose.click();
  expect(app.requests).toEqual([]);
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
});

it("balance refresh retains raw entry and reconnect preserves its original baseline", async () => {
  const { app, form } = await mount();
  await fill(form, "amount", "bad");
  form.balance = { ...form.balance!, outstanding: "20.00", received: "10.00" };
  await form.updateComplete;
  expect(unload()).toBe(true);
  form.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=amount]")!.value,
  ).toBe("bad");
  expect(unload()).toBe(true);
  await fill(form, "amount", "10.00");
  expect(unload()).toBe(false);
  click(form, "[data-pay-close]");
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("accepted payment aborts an outstanding warning and makes its Discard inert", async () => {
  const { app, form } = await mount();
  await fill(form, "tendered", "20.00");
  click(form, "[data-pay-close]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const old = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.taken = { change: "10.00" };
  await form.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  old.click();
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
  await fill(form, "amount", "15.00");
  expect(unload()).toBe(true);
});
it("clean confirmation Back preserves entered cash without an extra question", async () => {
  const { app, form } = await mount();
  await fill(form, "tendered", "20.00");
  click(form, "[data-pay-continue]");
  await expect.poll(() => app.requests.length).toBe(1);
  form.asked = app.requests[0]!;
  form.preview = {
    kind: "allocated",
    choice: null,
    applied: "10.00",
    tip: "0.00",
    change: "10.00",
    charged: null,
  };
  await form.updateComplete;
  click(form, "[data-pay-back]");
  await expect.poll(() => app.edits).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(true);
  expect(app.confirms).toBe(0);
});
it("item units are protected and reverting the selection clears the warning", async () => {
  const { app, form } = await mount();
  form.lines = [{ lineNo: 2, name: "Beer", quantity: "3", total: "9.00", unitTotal: "3.00" }];
  click(form, "input[name=way][value=items]");
  await form.updateComplete;
  click(form, 'input[name=line][value="2"]');
  await form.updateComplete;
  click(form, '[data-units-less="2"]');
  await form.updateComplete;
  await fill(form, "tendered", "10.00");
  click(form, "[data-pay-close]");
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  click(form, "[data-pay-continue]");
  await expect.poll(() => app.requests.length).toBe(1);
  expect(app.requests).toEqual([
    {
      choice: { kind: "items", picks: [{ lineNo: 2, units: 2 }] },
      pay: { method: "cash", tendered: "10.00" },
    },
  ]);
  click(form, "input[name=way][value=contribution]");
  await form.updateComplete;
  await fill(form, "tendered", "");
  expect(unload()).toBe(false);
});
it("untouched payment form Close stays exempt", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  click(form, "[data-pay-close]");
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.requests).toEqual([]);
  expect(app.confirms).toBe(0);
});
