import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { BillBalance, BillPaymentView, TillApi, TillProduct } from "../api/client.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { RefundAsk } from "../state/bill-payment.js";
import type { PayRequest, TillBillPayDialog } from "./bill-pay-dialog.js";
import type { TillBillRefundDialog } from "./bill-refund-dialog.js";
import "./bill-pay-dialog.js";
import "./bill-refund-dialog.js";
import "./tender-pay.js";
import "./find-bill-dialog.js";
import type { TillTenderPay } from "./tender-pay.js";
import type { FindBillPayDetail, TillFindBillDialog } from "./find-bill-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const balance: BillBalance = {
  workingOrderId: "order-1",
  status: "open",
  total: "50.00",
  received: "0.00",
  reserved: "0.00",
  outstanding: "50.00",
  tips: "0.00",
  payments: [],
  paidLines: [],
};

const payment: BillPaymentView = {
  id: "payment-1",
  submissionId: "submission-1",
  kind: "contribution",
  shareOf: null,
  method: "cash",
  entry: null,
  applied: "50.00",
  tip: "0.00",
  tendered: "50.00",
  change: "0.00",
  state: "received",
  createdAt: "2026-10-13T09:00:00.000Z",
  receivedAt: "2026-10-13T09:00:00.000Z",
  lines: [],
  refunds: [],
};

type Dialog = TillBillPayDialog | TillBillRefundDialog | TillTenderPay | TillFindBillDialog;

async function type(dialog: Dialog, name: string, value: string): Promise<void> {
  const field = dialog.shadowRoot!.querySelector(`[name="${name}"]`)!;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await dialog.updateComplete;
}

async function click(dialog: Dialog, selector: string): Promise<void> {
  await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>(selector)!);
  await dialog.updateComplete;
}

function capture<T>(dialog: Dialog, name: string): T[] {
  const events: T[] = [];
  dialog.addEventListener(name, (event) => events.push((event as CustomEvent<T>).detail));
  return events;
}

describe.each(["en", "es"] as const)("leading-zero amounts in %s", (locale) => {
  it.each(["000", "0000000005.50", "05.501", "05,50.00"])(
    "keeps invalid payment amount %s beside its field without sending a request",
    async (amount) => {
      setLocale(locale);
      const { el } = await mountWidget<TillBillPayDialog>("till-bill-pay-dialog", {
        balance,
        lines: [],
        way: "contribution",
      });
      const asked = capture<PayRequest>(el, "bill-pay-preview");
      await type(el, "amount", amount);
      await type(el, "tendered", "10");
      await click(el, "[data-pay-continue]");
      expect(asked).toEqual([]);
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>('wt-input[name="amount"]')!
          .error,
      ).toBe(t("bill_pay.amount_invalid"));
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-pay-continue]")!
          .disabled,
      ).toBe(true);
    },
  );

  it("keeps a leading-zero cash tip above the available change beside its field", async () => {
    setLocale(locale);
    const { el } = await mountWidget<TillBillPayDialog>("till-bill-pay-dialog", {
      balance,
      lines: [],
      way: "contribution",
      asked: {
        choice: { kind: "contribution", amount: "35.00" },
        pay: { method: "cash", tendered: "50.00" },
      },
      preview: {
        kind: "allocated",
        choice: null,
        applied: "35.00",
        tip: "0.00",
        change: "15.00",
        charged: null,
      },
    });
    const confirmed = capture(el, "bill-pay-confirm");
    await click(el, 'input[name="leaveTip"][value="part"]');
    await type(el, "tipAmount", "015,01");
    await click(el, "[data-pay-confirm]");
    expect(confirmed).toEqual([]);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>('wt-input[name="tipAmount"]')!
        .error,
    ).toBe(t("bill_pay.tip_amount_invalid").replace("{amount}", formatMoney("15.00", locale)));
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-pay-confirm]")!
        .disabled,
    ).toBe(true);
  });

  it.each(["05,50", "05.50"])(
    "previews payment %s with canonical contribution and cash amounts",
    async (amount) => {
      setLocale(locale);
      const { el } = await mountWidget<TillBillPayDialog>("till-bill-pay-dialog", {
        balance,
        lines: [],
        way: "contribution",
      });
      const asked = capture<PayRequest>(el, "bill-pay-preview");
      await type(el, "amount", amount);
      await type(el, "tendered", amount.replace("05", "010"));
      await click(el, "[data-pay-continue]");
      expect(asked).toEqual([
        {
          choice: { kind: "contribution", amount: "5.50" },
          pay: { method: "cash", tendered: "10.50" },
        },
      ]);
    },
  );

  it.each(["05,50", "05.50"])(
    "continues a part refund of %s with the same exact value",
    async (amount) => {
      setLocale(locale);
      const { el } = await mountWidget<TillBillRefundDialog>("till-bill-refund-dialog", {
        payment,
      });
      const asked = capture<RefundAsk>(el, "bill-refund-continue");
      await click(el, 'input[name="howMuch"][value="part"]');
      await type(el, "amount", amount);
      await type(el, "reason", "Charged too much");
      await click(el, "[data-refund-continue]");
      expect(asked).toEqual([
        { appliedAmount: "5.50", tipAmount: "0.00", reason: "Charged too much" },
      ]);
    },
  );

  it.each(["050,01", "050.01"])(
    "keeps %s above the refund ceiling beside the field",
    async (amount) => {
      setLocale(locale);
      const { el } = await mountWidget<TillBillRefundDialog>("till-bill-refund-dialog", {
        payment,
      });
      const asked = capture<RefundAsk>(el, "bill-refund-continue");
      await click(el, 'input[name="howMuch"][value="part"]');
      await type(el, "amount", amount);
      await type(el, "reason", "Charged too much");
      await click(el, "[data-refund-continue]");
      expect(asked).toEqual([]);
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>('wt-input[name="amount"]')!
          .error,
      ).toBe(t("bill_refund.amount_invalid").replace("{amount}", formatMoney("50.00", locale)));
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-refund-continue]")!
          .disabled,
      ).toBe(true);
    },
  );

  it.each(["05,50", "05.50"])(
    "sends %s as a canonical card tip from the counter payment form",
    async (tip) => {
      setLocale(locale);
      const product: TillProduct = {
        id: "coffee",
        name: "Staff coffee",
        customerName: { es: "Café cliente", en: "Customer coffee" },
        unit: {
          id: "each",
          name: { en: "unit", es: "unidad" },
          abbreviation: { en: "ea", es: "ud" },
          precision: 0,
          hardwareUnit: null,
        },
        unitPrice: "5.00",
        vatClass: "general",
        category: null,
        allergens: null,
      };
      const store = new WorkingOrderStore();
      store.addProduct(product, "1");
      const { el } = await mountWidget<TillTenderPay>("till-tender-pay", {
        store,
        cardProvider: "stripe_on_device",
        tipsEnabled: true,
      });
      const asked = capture(el, "collect-card");
      await type(el, "tip", tip);
      await click(el, ".pay-card");
      expect(asked).toEqual([{ tip: "5.50" }]);
    },
  );

  it.each(["05,50", "05.50"])(
    "sends %s as canonical cash when collecting a found bill",
    async (amount) => {
      setLocale(locale);
      const api = {
        lookUpBills: async () => ({
          bills: [
            {
              workingOrderId: "order-1",
              orderNumber: 1,
              label: "Order",
              partyName: "Guest",
              tables: [],
              invoiceNumber: null,
              openedAt: "2026-10-13T09:00:00.000Z",
              departedAt: "2026-10-13T10:00:00.000Z",
              status: "left_without_paying",
              stillOwed: "5.00",
            },
          ],
        }),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillFindBillDialog>("till-find-bill-dialog", { api });
      const asked = capture<FindBillPayDetail>(el, "find-bill-pay");
      await type(el, "bill-search", "Order");
      await click(el, "[data-search]");
      await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-bill]")).not.toBeNull());
      await click(el, "[data-bill]");
      await type(el, "cash-received", amount);
      await click(el, "[data-collect]");
      expect(asked).toEqual([
        { workingOrderId: "order-1", tender: { method: "cash", amount: "5.50" }, invoiced: false },
      ]);
    },
  );
});
