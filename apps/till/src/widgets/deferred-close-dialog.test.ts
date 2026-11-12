import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./deferred-close-dialog.js";
import type { DeferredCloseBill, TillDeferredCloseDialog } from "./deferred-close-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es"));

const SIMPLIFIED: DeferredCloseBill = {
  label: "Mesa 4 · Cuenta 2",
  total: "62.40",
  customer: null,
  issued: false,
};

async function mount(over: Partial<TillDeferredCloseDialog> = {}) {
  const { el } = await mountWidget<TillDeferredCloseDialog>("till-deferred-close-dialog", {
    open: true,
    bill: SIMPLIFIED,
    ...over,
  });
  return el;
}

const root = (el: TillDeferredCloseDialog) => el.shadowRoot!;
const text = (node: Element | ShadowRoot | null) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const money = (amount: string) => formatMoney(amount, currentLocale()).replace(/\s+/g, " ");
const confirmButton = (el: TillDeferredCloseDialog) =>
  root(el).querySelector<HTMLElement & { disabled: boolean; loading: boolean }>(
    "[data-deferred-close-confirm]",
  )!;
const actions = (el: TillDeferredCloseDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;

function count(el: TillDeferredCloseDialog, type: string): { n: number } {
  const seen = { n: 0 };
  el.addEventListener(type, () => seen.n++);
  return seen;
}

describe("till-deferred-close-dialog", () => {
  it("shows the total, a simplified invoice and the final-close sentence, with Issue invoice and close", async () => {
    const el = await mount();
    const body = text(root(el).querySelector("[data-deferred-close-summary]"));
    expect(body).toContain("Mesa 4 · Cuenta 2");
    expect(body).toContain(t("deferred_close.simplified"));
    expect(text(root(el).querySelector("[data-deferred-close-total]"))).toBe(money("62.40"));
    expect(text(root(el).querySelector("[data-deferred-close-sentence]"))).toBe(
      "El cliente pagará más tarde. Esto cierra la cuenta ahora y Waitron no registrará el pago cuando llegue.",
    );
    expect(text(confirmButton(el))).toBe("Emitir factura y cerrar");
    expect(text(root(el).querySelector("[data-deferred-close-cancel]"))).toBe(t("action.cancel"));

    setLocale("en");
    el.requestUpdate();
    await el.updateComplete;
    expect(text(root(el).querySelector("[data-deferred-close-sentence]"))).toBe(
      "The customer will pay later. This closes the bill now, and Waitron will not record the payment when it arrives.",
    );
    expect(text(confirmButton(el))).toBe("Issue invoice and close");
  });

  it("names the full-invoice customer, and says Close bill when the invoice is already issued", async () => {
    const el = await mount({
      bill: {
        ...SIMPLIFIED,
        customer: { legalName: "Hostelería Levante SL", taxId: "B12345678" },
        issued: true,
      },
    });
    const body = text(root(el).querySelector("[data-deferred-close-summary]"));
    expect(body).toContain(t("invoice.full"));
    expect(body).toContain("Hostelería Levante SL");
    expect(body).toContain("B12345678");
    expect(body).not.toContain(t("deferred_close.simplified"));
    expect(text(confirmButton(el))).toBe("Cerrar cuenta");
  });

  it("sends one confirm however often it is tapped or Enter pressed while busy", async () => {
    const el = await mount();
    const confirms = count(el, "deferred-close-confirm");
    confirmButton(el).click();
    confirmButton(el).click();
    confirmButton(el).focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    el.busy = true;
    await el.updateComplete;
    confirmButton(el).click();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(confirms.n).toBe(1);
    expect(confirmButton(el).loading).toBe(true);
  });

  it("shows a refusal at the bottom and keeps the confirm usable", async () => {
    const el = await mount();
    const confirms = count(el, "deferred-close-confirm");
    confirmButton(el).click();
    el.busy = true;
    await el.updateComplete;
    el.busy = false;
    el.refusal = "Este total ha cambiado.";
    await el.updateComplete;
    expect(actions(el).error).toBe("Este total ha cambiado.");
    expect(confirmButton(el).disabled).toBe(false);
    confirmButton(el).click();
    await el.updateComplete;
    expect(confirms.n).toBe(2);
  });

  it("asks to cancel with Cancel, and not while busy", async () => {
    const el = await mount();
    const cancels = count(el, "deferred-close-cancel");
    el.busy = true;
    await el.updateComplete;
    root(el).querySelector<HTMLElement>("[data-deferred-close-cancel]")!.click();
    await el.updateComplete;
    expect(cancels.n).toBe(0);
    el.busy = false;
    await el.updateComplete;
    root(el).querySelector<HTMLElement>("[data-deferred-close-cancel]")!.click();
    await expect.poll(() => cancels.n).toBe(1);
  });
});
