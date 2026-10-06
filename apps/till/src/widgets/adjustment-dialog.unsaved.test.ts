import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import type { WtInput } from "@waitron/ui/src/components/wt-input.js";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./adjustment-dialog.js";
import type { AdjustmentChoice, TillAdjustmentDialog } from "./adjustment-dialog.js";

class AdjustmentLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  previews: AdjustmentChoice[] = [];
  confirms: AdjustmentChoice[] = [];
  override render() {
    return html`<till-adjustment-dialog
        kind="discount"
        .target=${{ lineId: "line-2", name: "Steak", quantity: "2", total: "50.00", unitTotal: "25.00" }}
        .reasons=${[{ id: "regular", name: "Regular", actions: ["discount_percent", "discount_amount"], noteRequired: false, maxPercentBp: null, maxAmount: null, applyRole: "staff", approverRole: "manager" }]}
        @adjust-close=${() => this.closes++}
        @adjust-preview=${(event: CustomEvent<AdjustmentChoice>) => this.previews.push(event.detail)}
        @adjust-confirm=${(event: CustomEvent<AdjustmentChoice>) => this.confirms.push(event.detail)}
      ></till-adjustment-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("adjustment-leave-test-app", AdjustmentLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<AdjustmentLeaveApp>("adjustment-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-adjustment-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillAdjustmentDialog, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<WtInput>(`wt-input[name=${name}]`)!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
async function pick(form: TillAdjustmentDialog, name: string, value: string) {
  form
    .shadowRoot!.querySelector<HTMLInputElement>(`input[name=${name}][value="${value}"]`)!
    .click();
  await form.updateComplete;
}
function click(form: TillAdjustmentDialog, selector: string) {
  form.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
}
async function question(app: AdjustmentLeaveApp) {
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
  it(`adjustment ${action} keeps raw values and focus until Discard without applying anything`, async () => {
    const { app, form } = await mount();
    await pick(form, "quantity", "1");
    await pick(form, "reason", "regular");
    await fill(form, "percent", "12,50");
    const input = await fill(form, "note", "  Repeat customer  ");
    if (action === "Cancel") click(form, "[data-adjust-close]");
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("  Repeat customer  ");
    expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
    click(form, "[data-adjust-continue]");
    expect(app.previews).toEqual([
      {
        action: "discount_percent",
        reasonId: "regular",
        note: "Repeat customer",
        quantity: "1",
        percentBp: 1250,
      },
    ]);
    click(form, "[data-adjust-close]");
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    await form.updateComplete;
    expect(input.value).toBe("");
    expect(app.confirms).toEqual([]);
    expect(unload()).toBe(false);
    form
      .shadowRoot!.querySelector("wt-dialog")!
      .shadowRoot!.querySelector("dialog")!
      .dispatchEvent(new Event("close"));
    expect(app.closes).toBe(1);
  });
}
it("adjustment defaults and reverted choices close without a question", async () => {
  const { app, form } = await mount();
  await pick(form, "quantity", "1");
  expect(unload()).toBe(true);
  await pick(form, "quantity", "all");
  await pick(form, "discountKind", "amount");
  await pick(form, "discountKind", "percent");
  await fill(form, "note", "typed");
  await fill(form, "note", "  ");
  expect(unload()).toBe(false);
  click(form, "[data-adjust-close]");
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("invalid discount input stays protected without a request", async () => {
  const { app, form } = await mount();
  await pick(form, "reason", "regular");
  await fill(form, "percent", "invalid");
  click(form, "[data-adjust-continue]");
  await form.updateComplete;
  expect(app.previews).toEqual([]);
  expect(form.shadowRoot!.querySelector<WtInput>('wt-input[name="percent"]')!.error).toBe(
    t("adjust.percent_invalid"),
  );
  expect(unload()).toBe(true);
  click(form, "[data-adjust-close]");
  expect((await question(app)).open).toBe(true);
});
it("preview and refusal retain protection while confirming sends the original exact choice directly", async () => {
  const { app, form } = await mount();
  await pick(form, "discountKind", "amount");
  await pick(form, "reason", "regular");
  await fill(form, "amount", "5,50");
  await fill(form, "note", "  Loyal guest  ");
  click(form, "[data-adjust-continue]");
  expect(app.previews).toEqual([
    { action: "discount_amount", reasonId: "regular", note: "Loyal guest", amount: "5.50" },
  ]);
  form.choice = app.previews[0]!;
  form.preview = {
    reduction: "5.50",
    nominalValue: "5.50",
    needsApproval: null,
    overBillDiscountLimit: false,
    lines: [],
  };
  form.refusal = "adjustment.over_limit";
  await form.updateComplete;
  expect(unload()).toBe(true);
  click(form, "[data-adjust-confirm]");
  expect(app.confirms).toEqual([
    { action: "discount_amount", reasonId: "regular", note: "Loyal guest", amount: "5.50" },
  ]);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(true);
  form.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!.querySelector("dialog")!.focus();
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
});
it("a busy adjustment ignores dismissal, submission and retained input events", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "note", "Before request");
  form.busy = true;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  input.value = "During request";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  click(form, "[data-adjust-close]");
  click(form, "[data-adjust-continue]");
  await userEvent.keyboard("{Escape}");
  expect(app.previews).toEqual([]);
  expect(app.closes).toBe(0);
  expect((await question(app)).open).toBe(false);
  form.busy = false;
  await form.updateComplete;
  expect(input.value).toBe("Before request");
});
it("disconnect aborts an answer and reconnect keeps the opening baseline", async () => {
  const { app, form } = await mount();
  await fill(form, "note", "Retained");
  click(form, "[data-adjust-close]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(unload()).toBe(false);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector<WtInput>('wt-input[name="note"]')!.value).toBe("Retained");
  expect(unload()).toBe(true);
});
it("departed adjustment controls cannot change the retained draft or emit requests", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "note", "Retained");
  form.remove();
  click(form, "[data-adjust-close]");
  click(form, "[data-adjust-continue]");
  input.value = "Departed";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(app.previews).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(input.value).toBe("Retained");
  expect(unload()).toBe(true);
});
it("an accepted adjustment aborts a pending discard without restoring or asking again", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "note", "Accepted note");
  click(form, "[data-adjust-close]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.closeSaved();
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
  expect(input.value).toBe("Accepted note");
  expect(unload()).toBe(false);
  expect(app.closes).toBe(0);
});
