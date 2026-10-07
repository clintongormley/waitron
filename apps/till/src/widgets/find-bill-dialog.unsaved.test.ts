import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { BillLookupRow, TillApi } from "../api/client.js";
import "./find-bill-dialog.js";
import type { FindBillPayDetail, TillFindBillDialog } from "./find-bill-dialog.js";

const debt: BillLookupRow = {
  workingOrderId: "collection-1",
  orderNumber: 12,
  label: "Birthday",
  partyName: "Familia Ruiz",
  tables: ["Mesa 4"],
  invoiceNumber: "A/12",
  openedAt: "2026-10-01T18:00:00.000Z",
  departedAt: null,
  status: "waiting_for_payment",
  stillOwed: "30.00",
};
const api = { lookUpBills: async () => ({ bills: [debt] }) } as unknown as TillApi;
class CollectionLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  submitted: FindBillPayDetail[] = [];
  override render() {
    return html`<till-find-bill-dialog
        .api=${api}
        @find-bill-close=${() => this.closes++}
        @find-bill-pay=${(event: CustomEvent<FindBillPayDetail>) => this.submitted.push(event.detail)}
      ></till-find-bill-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("collection-leave-test-app", CollectionLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(selected = true) {
  const { el: app } = await mountWidget<CollectionLeaveApp>("collection-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-find-bill-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  if (selected) {
    await fill(form, "bill-search", "A/12");
    click(form, "[data-search]");
    await expect.poll(() => form.shadowRoot!.querySelector("[data-bill]")).not.toBeNull();
    click(form, "[data-bill]");
    await form.updateComplete;
  }
  return { app, form };
}
function field(form: TillFindBillDialog, name: string) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`)!;
}
async function fill(form: TillFindBillDialog, name: string, value: string) {
  const control = field(form, name);
  await control.updateComplete;
  const input = control.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
function click(form: TillFindBillDialog, selector: string) {
  form.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
}
async function question(app: CollectionLeaveApp) {
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
for (const route of ["Back", "Escape"]) {
  it(`collection ${route} keeps the edited cash until explicit Discard and never collects`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "cash-received", "40.00");
    if (route === "Back") click(form, "[slot=cancel]");
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(app.submitted).toEqual([]);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("40.00");
    expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
    if (route === "Back") click(form, "[slot=cancel]");
    else await userEvent.keyboard("{Escape}");
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    if (route === "Back") {
      await expect.poll(() => form.shadowRoot!.querySelector("[data-bill]")).not.toBeNull();
      expect(app.closes).toBe(0);
    } else await expect.poll(() => app.closes).toBe(1);
    expect(app.submitted).toEqual([]);
    expect(unload()).toBe(false);
  });
}
it("collection defaults and reverted normalized cash are clean but invalid cash is dirty", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  await fill(form, "cash-received", "invalid");
  expect(unload()).toBe(true);
  click(form, "[data-collect]");
  await form.updateComplete;
  expect(app.submitted).toEqual([]);
  await fill(form, "cash-received", "30.0");
  expect(unload()).toBe(false);
  click(form, "[slot=cancel]");
  await expect.poll(() => form.shadowRoot!.querySelector("[data-bill]")).not.toBeNull();
  expect((await question(app)).open).toBe(false);
});
it("search text and result selection are exempt from warnings", async () => {
  const { app, form } = await mount(false);
  await fill(form, "bill-search", "A/12");
  expect(unload()).toBe(false);
  click(form, "[slot=cancel]");
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  expect(app.submitted).toEqual([]);
});
it("card collection keeps its reference after refusal and submits the existing exact body", async () => {
  const { app, form } = await mount();
  click(form, "[data-card]");
  await form.updateComplete;
  const input = await fill(form, "terminal-reference", "  receipt-7  ");
  click(form, "[data-collect]");
  expect(app.submitted).toEqual([
    {
      workingOrderId: "collection-1",
      tender: { method: "card", amount: "30.00", externalRef: "receipt-7" },
      invoiced: true,
    },
  ]);
  expect((await question(app)).open).toBe(false);
  form.error = "sale.error";
  await form.updateComplete;
  click(form, "[slot=cancel]");
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("  receipt-7  ");
  expect(app.submitted).toHaveLength(1);
});
it("busy collection cannot go Back, change method, resubmit or dismiss with Escape", async () => {
  const { app, form } = await mount();
  await fill(form, "cash-received", "40.00");
  form.busy = true;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  click(form, "[slot=cancel]");
  click(form, "[data-card]");
  click(form, "[data-collect]");
  await userEvent.keyboard("{Escape}");
  expect(field(form, "cash-received")).not.toBeNull();
  expect(field(form, "cash-received").value).toBe("40.00");
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  expect((await question(app)).open).toBe(false);
});
it("disconnect aborts collection Discard and reconnect protects the retained draft", async () => {
  const { app, form } = await mount();
  await fill(form, "cash-received", "40.00");
  click(form, "[slot=cancel]");
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
  expect(field(form, "cash-received").value).toBe("40.00");
  expect(unload()).toBe(true);
});
it("successful collection close makes an outstanding Discard inert before host removal", async () => {
  const { app, form } = await mount();
  await fill(form, "cash-received", "40.00");
  click(form, "[slot=cancel]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.closeSaved();
  expect(unload()).toBe(false);
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(field(form, "cash-received").value).toBe("40.00");
  expect(app.closes).toBe(0);
  expect(app.submitted).toEqual([]);
});
it("a reverted payment method ignores dormant entry fields and returning to a bill seeds clean defaults", async () => {
  const { app, form } = await mount();
  click(form, "[data-card]");
  await form.updateComplete;
  await fill(form, "terminal-reference", "receipt-7");
  form.shadowRoot!.querySelector<HTMLElement>(".methods wt-button")!.click();
  await form.updateComplete;
  expect(unload()).toBe(false);
  click(form, "[slot=cancel]");
  await expect.poll(() => form.shadowRoot!.querySelector("[data-bill]")).not.toBeNull();
  click(form, "[data-bill]");
  await form.updateComplete;
  expect(field(form, "cash-received").value).toBe("30.00");
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("departed collection controls cannot collect or change the retained draft", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "cash-received", "40.00");
  const collect = form.shadowRoot!.querySelector<HTMLElement>("[data-collect]")!;
  form.remove();
  collect.click();
  click(form, "[slot=cancel]");
  input.value = "50.00";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(input.value).toBe("40.00");
  expect(unload()).toBe(true);
});
it("starting collection invalidates an earlier Discard without losing the failed request draft", async () => {
  const { app, form } = await mount();
  await fill(form, "cash-received", "40.00");
  click(form, "[slot=cancel]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.busy = true;
  await form.updateComplete;
  await app.updateComplete;
  await q.updateComplete;
  expect(q.open).toBe(false);
  discard.click();
  expect(field(form, "cash-received").value).toBe("40.00");
  expect(app.closes).toBe(0);
  form.busy = false;
  form.error = "sale.error";
  await form.updateComplete;
  expect(unload()).toBe(true);
  click(form, "[slot=cancel]");
  expect((await question(app)).open).toBe(true);
  expect(app.submitted).toEqual([]);
});
