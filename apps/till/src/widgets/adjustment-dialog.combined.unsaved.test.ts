import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { AdjustmentChoice, TillAdjustmentDialog } from "./adjustment-dialog.js";
import "../till-app.js";
class CompLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  previews: AdjustmentChoice[] = [];
  override render() {
    return html`<till-adjustment-dialog
        .combined=${true}
        .target=${{ lineId: "dish", name: "Burger", quantity: "3", total: "36.00", unitTotal: "12.00", extras: [{ lineId: "extra", name: "Cheese", quantity: "3", total: "6.00", unitTotal: null, extra: true }] }}
        .reasons=${[{ id: "reason", name: "Complaint", actions: ["comp", "discount_percent", "discount_amount"], noteRequired: false, maxPercentBp: null, maxAmount: null, kind: "comp", applyRoles: ["staff", "supervisor", "manager", "admin"], approverRoles: ["manager", "admin"] }]}
        @adjust-close=${() => this.closes++}
        @adjust-preview=${(e: CustomEvent<AdjustmentChoice>) => this.previews.push(e.detail)}
      ></till-adjustment-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("comp-leave-test-app", CompLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
it.each(["Cancel", "Escape"])(
  "combined Comp %s preserves all choices until explicit Discard",
  async (action) => {
    const { el: app } = await mountWidget<CompLeaveApp>("comp-leave-test-app", {});
    const form = app.shadowRoot!.querySelector<TillAdjustmentDialog>("till-adjustment-dialog")!;
    await form.updateComplete;
    const root = form.shadowRoot!;
    const click = async (selector: string) => {
      await userEvent.click(root.querySelector<HTMLElement>(selector)!);
      await form.updateComplete;
    };
    await click('input[name="reason"]');
    await click('input[name="discountKind"][value="amount"]');
    const fill = async (name: string, value: string) => {
      const field = root.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
        `[name="${name}"]`,
      )!;
      await field.updateComplete;
      const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
      await userEvent.fill(page.elementLocator(input), value);
      await form.updateComplete;
      return input;
    };
    await fill("adjustQuantity", "2");
    await fill("amount", "4,50");
    const note = await fill("note", "  Late dish  ");
    if (action === "Cancel") await click("[data-adjust-close]");
    else await userEvent.keyboard("{Escape}");
    await app.updateComplete;
    const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => warning.open).toBe(true);
    await warning.updateComplete;
    await userEvent.click(warning.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!);
    await expect.poll(() => warning.open).toBe(false);
    expect(note.value).toBe("  Late dish  ");
    if (action === "Escape") expect((note.getRootNode() as ShadowRoot).activeElement).toBe(note);
    else expect(root.activeElement).toBe(root.querySelector("[data-adjust-close]"));
    await click("[data-adjust-continue]");
    expect(app.previews).toEqual([
      {
        action: "discount_amount",
        reasonId: "reason",
        note: "Late dish",
        quantity: "2",
        amount: "4.50",
      },
    ]);
    await click('input[name="adjustTarget"][value="extra"]');
    await fill("amount", "1");
    await click("[data-adjust-close]");
    await expect.poll(() => warning.open).toBe(true);
    await warning.updateComplete;
    await userEvent.click(
      warning.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!,
    );
    await expect.poll(() => app.closes).toBe(1);
    expect(root.querySelector("wt-dialog")!.open).toBe(false);
    expect(app.previews).toHaveLength(1);
  },
);
