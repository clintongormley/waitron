import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./cancel-credit-dialog.js";
import type { TillCancelCreditDialog } from "./cancel-credit-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(over: Partial<TillCancelCreditDialog> = {}) {
  const { el } = await mountWidget<TillCancelCreditDialog>("till-cancel-credit-dialog", {
    invoiceNumber: "A/12",
    amount: "24.50",
    ...over,
  });
  return el;
}

const root = (el: TillCancelCreditDialog) => el.shadowRoot!;
const text = (node: Element | null) => (node?.textContent ?? "").replace(/[ \n\t]+/g, " ").trim();
const money = (amount: string) => formatMoney(amount, currentLocale());
const reason = (el: TillCancelCreditDialog) =>
  root(el).querySelector<HTMLElement & { error: string; required: boolean }>(
    'wt-input[name="reason"]',
  );
const actions = (el: TillCancelCreditDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
const confirm = (el: TillCancelCreditDialog) =>
  root(el).querySelector<HTMLElement & { disabled: boolean; loading: boolean }>(
    "[data-cancel-credit-confirm]",
  )!;

async function type(el: TillCancelCreditDialog, value: string): Promise<void> {
  const input = reason(el)!.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function press(el: TillCancelCreditDialog): Promise<void> {
  confirm(el).click();
  await el.updateComplete;
}

function capture<T>(el: TillCancelCreditDialog, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

describe("till-cancel-credit-dialog: what it will do", () => {
  it("names the invoice and its amount, and says a credit note is issued and the bill cancelled", async () => {
    const el = await mount();

    expect(text(root(el).querySelector("[data-cancel-credit-scope]"))).toBe(
      `Invoice A/12 (${money("24.50")}) will be credited in full: a credit note is issued and the bill is cancelled.`,
    );
    expect(text(confirm(el))).toBe(t("cancel_credit.confirm"));
    expect(text(root(el).querySelector("[data-cancel-credit-next]"))).toBe(
      t("cancel_credit.approval_next"),
    );
  });

  it("offers to keep the bill rather than a second Cancel beside Cancel and credit", async () => {
    const el = await mount();
    const keep = root(el).querySelector("[data-cancel-credit-close]");

    expect(text(keep)).toBe("Keep the bill");
    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    expect(text(keep)).toBe("Mantener la cuenta");
  });

  it("says the same of an invoice whose number it was not given", async () => {
    const el = await mount({ invoiceNumber: null });

    expect(text(root(el).querySelector("[data-cancel-credit-scope]"))).toBe(
      `This bill's invoice (${money("24.50")}) will be credited in full: a credit note is issued and the bill is cancelled.`,
    );
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const el = await mount();

    expect(text(root(el).querySelector("[data-cancel-credit-scope]"))).toBe(
      `La factura A/12 (${money("24.50")}) se abona por completo: se emite una factura rectificativa y se cancela la cuenta.`,
    );
    expect(text(confirm(el))).toBe("Cancelar y abonar");
  });
});

describe("till-cancel-credit-dialog: the reason", () => {
  it("sends the reason typed, trimmed", async () => {
    const el = await mount();
    const asked = capture<{ reason: string }>(el, "cancel-credit-continue");

    await type(el, "  Charged to the wrong table ");
    await press(el);

    expect(asked).toEqual([{ reason: "Charged to the wrong table" }]);
  });

  it("marks the reason required, says it under the field and above the action, and sends nothing", async () => {
    const el = await mount();
    const asked = capture(el, "cancel-credit-continue");

    expect(reason(el)!.required).toBe(true);
    await type(el, "   ");
    await press(el);

    expect(asked).toEqual([]);
    expect(reason(el)!.error).toBe(t("cancel_credit.reason_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(confirm(el).disabled).toBe(true);
    await type(el, "x".repeat(501));
    expect(reason(el)!.error).toBe(t("cancel_credit.reason_long"));
    await type(el, "Wrong table");
    expect(reason(el)!.error).toBe("");
    expect(actions(el).error).toBe("");
    expect(confirm(el).disabled).toBe(false);
  });

  it("continues on Enter in the reason", async () => {
    const el = await mount();
    const asked = capture(el, "cancel-credit-continue");
    await type(el, "Wrong table");

    reason(el)!
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await el.updateComplete;

    expect(asked).toEqual([{ reason: "Wrong table" }]);
  });
});

describe("till-cancel-credit-dialog: refusals", () => {
  it.each([
    ["bill.payments_received", "cancel_credit.refused_payments"],
    ["order.payment_in_flight", "cancel_credit.refused_payment_in_flight"],
    ["authorization.not_permitted", "cancel_credit.refused_not_permitted"],
    ["network", "cancel_credit.unconfirmed"],
    ["approvers", "cancel_credit.approvers_failed"],
  ] as const)(
    "says %s in its own sentence above the action, beside no field",
    async (code, key) => {
      const el = await mount({ refusal: { code } });

      expect(actions(el).error).toBe(t(key));
      expect(reason(el)!.error).toBe("");
    },
  );

  it.each([
    "working_order.not_placed",
    "series.no_rectificative_for_node",
    "device.unauthorized",
    "device.till_required",
    "sale.correction_exceeds_total",
    "sale.correction_not_whole",
    "server.internal",
    "some.unmapped_code",
  ])("says %s in the shared message for its code, beside no field", async (code) => {
    const el = await mount({ refusal: { code } });

    expect(actions(el).error).toBe(codeMessage(code));
    expect(reason(el)!.error).toBe("");
  });

  it("says each cancel refusal in Spanish too", async () => {
    setLocale("es");
    const own = await mount({ refusal: { code: "bill.payments_received" } });
    const shared = await mount({ refusal: { code: "series.no_rectificative_for_node" } });

    expect(actions(own).error).toBe(
      "Esta cuenta tiene un pago, así que no se puede cancelar ni abonar.",
    );
    expect(actions(shared).error).toBe(
      "Este local no tiene una serie de facturas rectificativas. Avisa a un responsable",
    );
  });

  it.each([
    { code: "working_order.reason_required" },
    { code: "management.request_invalid", field: "reason" },
  ])(
    "puts a refusal of the reason ($code) beside the reason, until it is changed",
    async (refusal) => {
      const el = await mount({ refusal });

      expect(reason(el)!.error).toBe(t("cancel_credit.reason_invalid"));
      expect(actions(el).error).toBe(t("form.fix_fields"));
      await type(el, "Wrong table");
      expect(reason(el)!.error).toBe("");
      expect(actions(el).error).toBe("");
    },
  );

  it("while a request is out, holds the action and cannot be dismissed", async () => {
    const el = await mount({ busy: true });

    expect(confirm(el).loading).toBe(true);
    expect(confirm(el).disabled).toBe(true);
    expect(
      root(el).querySelector<HTMLElement & { dismissible: boolean }>("wt-dialog")!.dismissible,
    ).toBe(false);
    expect(
      root(el).querySelector<HTMLElement & { disabled: boolean }>("[data-cancel-credit-close]")!
        .disabled,
    ).toBe(true);
  });

  it("Cancel asks to close", async () => {
    const el = await mount();
    const closed = capture(el, "cancel-credit-close");

    root(el).querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();

    expect(closed).toHaveLength(1);
  });
});

describe("till-cancel-credit-dialog: dismissing", () => {
  it("asks to close when the dialog itself is dismissed", async () => {
    const el = await mount();
    const closed = capture(el, "cancel-credit-close");

    root(el).querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));

    expect(closed).toHaveLength(1);
  });
});

describe("till-cancel-credit-dialog: done", () => {
  it("names the credit note issued, offers only Done, and asks for no reason", async () => {
    const el = await mount({ done: { creditNote: "R/3" } });
    const closed = capture(el, "cancel-credit-close");

    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      "Credit note R/3 issued. The bill is cancelled.",
    );
    expect(reason(el)).toBeNull();
    expect(root(el).querySelector("[data-cancel-credit-confirm]")).toBeNull();
    root(el).querySelector<HTMLElement>("[data-cancel-credit-finished]")!.click();
    expect(closed).toHaveLength(1);
  });

  it("puts Done in the shared actions row", async () => {
    const el = await mount({ done: { creditNote: "R/3" } });

    expect(root(el).querySelector("wt-form-actions [data-cancel-credit-finished]")).not.toBeNull();
  });

  it("says the bill is cancelled when the credit note's number could not be read", async () => {
    const el = await mount({ done: { creditNote: null } });

    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      t("cancel_credit.done_unnumbered"),
    );
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const el = await mount({ done: { creditNote: "R/3" } });

    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      "Factura rectificativa R/3 emitida. La cuenta queda cancelada.",
    );
  });
});
