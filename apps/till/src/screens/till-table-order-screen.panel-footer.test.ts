import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import type { TillTenderPay } from "../widgets/tender-pay.js";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, resized } from "./till-table-order-screen.test-helpers.js";
import {
  footerBalance,
  footerBill,
  footerParty,
  mountFooter,
} from "./till-table-order-screen.panel-footer.test-helpers.js";
import { openTableMenu } from "./till-table-order-screen.bill-switcher.test-helpers.js";

beforeEach(async () => {
  setLocale("en");
  await page.viewport(1280, 1100);
});
afterEach(cleanupWidgets);

const q = (el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
function capture(el: TillTableOrderScreen, name: string) {
  const events: CustomEvent[] = [];
  el.addEventListener(name, (event) => events.push(event as CustomEvent));
  return events;
}

describe("the bill actions below Sent and New order", () => {
  it.each([true, false])(
    "offers payment and Discount without opening the drawer (draft %s)",
    async (editable) => {
      const { el } = await mountFooter({ draftStore: editable ? new DraftStore() : null });
      await resized(el);
      const footer = q(el, "[data-bill-actions]");
      expect(footer).not.toBeNull();
      expect(footer!.checkVisibility()).toBe(true);
      expect(q(el, "[data-drawer]")).toBeNull();
      const summary = q(el, "[data-order-summary]")!;
      const discount = q(el, "[data-discount-bill]:not([data-table-menu] *)")!;
      const pay = q(el, "till-tender-pay")!;
      expect(summary).not.toBeNull();
      expect(discount).not.toBeNull();
      expect(pay).not.toBeNull();
      expect(summary.textContent).toContain("€10.00");
      expect(
        summary.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(discount.checkVisibility()).toBe(true);
      expect(pay.checkVisibility()).toBe(true);
      expect(discount.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(el.shadowRoot!.querySelectorAll("till-tender-pay")).toHaveLength(1);
    },
  );

  it("keeps the saved bill amount in Discount while the panel includes fresh unsent food", async () => {
    const draft = new DraftStore();
    draft.appendLines([{ product: beer, quantity: "2" }]);
    const { el } = await mountFooter({ draftStore: draft });
    await resized(el);
    expect(q(el, "[data-bill-actions]")).not.toBeNull();
    expect(q(el, "[data-order-total]")!.textContent!.trim()).toBe("€16.00");
    const events = capture(el, "adjust");
    await userEvent.click(q(el, "[data-discount-bill]:not([data-table-menu] *)")!);
    expect(events.map((event) => event.detail)).toEqual([
      {
        kind: "discount",
        target: {
          lineId: null,
          name: "4 · Bill 1",
          quantity: null,
          total: "10.00",
          unitTotal: null,
        },
      },
    ]);
    expect(events[0]!.bubbles && events[0]!.composed).toBe(true);
  });

  it("offers no payment when this device cannot settle, while retaining Discount and the total", async () => {
    const { el } = await mountFooter({ canSettle: false });
    await resized(el);
    expect(q(el, "[data-bill-actions]")).not.toBeNull();
    expect(q(el, "till-tender-pay, .pay, [data-open-bill-pay]")).toBeNull();
    expect(q(el, "[data-discount-bill]:not([data-table-menu] *)")!.checkVisibility()).toBe(true);
    expect(q(el, "[data-order-total]")!.textContent!.trim()).toBe("€10.00");
  });

  it.each(["settled", "abandoned"] as const)(
    "offers no new payment or Discount on a %s bill",
    async (status) => {
      const { el } = await mountFooter({
        bills: [
          {
            ...footerBill,
            billNumber: status === "abandoned" ? null : 1,
            status,
            outstanding: "0.00",
          },
        ],
      });
      expect(q(el, "[data-bill-actions]")).not.toBeNull();
      expect(q(el, "till-tender-pay, .pay, [data-discount-bill], [data-open-bill-pay]")).toBeNull();
    },
  );

  it("keeps one payment widget and its open cash flow when a step of the table menu opens and closes", async () => {
    const { el } = await mountFooter();
    await resized(el);
    expect(q(el, "[data-bill-actions]")).not.toBeNull();
    const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
    await tender.updateComplete;
    await userEvent.click(tender.shadowRoot!.querySelector<HTMLElement>(".pay")!);
    await tender.updateComplete;
    expect(tender.shadowRoot!.querySelector(".tendered")).not.toBeNull();
    for (const open of [true, false]) {
      if (open) {
        await openTableMenu(el);
        await userEvent.click(q(el, '[data-table-menu] [data-action="move"]')!);
      } else await userEvent.click(q(el, "[data-action-panel] [data-action-back]")!);
      await el.updateComplete;
      expect(q(el, "[data-action-panel]") !== null).toBe(open);
      expect(el.shadowRoot!.querySelectorAll("till-tender-pay")).toHaveLength(1);
      expect(q(el, "till-tender-pay")).toBe(tender);
      expect(tender.shadowRoot!.querySelector(".tendered")).not.toBeNull();
      expect(
        q(el, "[data-action-panel] [data-discount-bill], [data-action-panel] .pay"),
      ).toBeNull();
    }
  });

  it("forwards only the bill payment event and swallows a counter Hold from the relocated widget", async () => {
    const { el } = await mountFooter();
    expect(q(el, "[data-bill-actions]")).not.toBeNull();
    const tender = q(el, "till-tender-pay")!;
    const payments = capture(el, "pay-tab");
    const counter = capture(el, "confirm-payment");
    const holds = capture(el, "park-order");
    tender.dispatchEvent(
      new CustomEvent("confirm-payment", {
        detail: { method: "cash", amount: "12.00", guestCount: 3 },
        bubbles: true,
        composed: true,
      }),
    );
    tender.dispatchEvent(
      new CustomEvent("park-order", { detail: {}, bubbles: true, composed: true }),
    );
    expect(payments.map((event) => event.detail)).toEqual([
      { method: "cash", amount: "12.00", guestCount: 3 },
    ]);
    expect(payments[0]!.bubbles && payments[0]!.composed).toBe(true);
    expect(counter).toEqual([]);
    expect(holds).toEqual([]);
  });

  it("offers the existing partial-payment path below the total, with the received and remaining amounts", async () => {
    const { el } = await mountFooter({
      bills: [{ ...footerBill, hasPayments: true, outstanding: "8.00" }],
      billBalance: footerBalance,
      fullInvoices: true,
    });
    await resized(el);
    expect(q(el, "[data-bill-actions]")).not.toBeNull();
    expect(q(el, "till-tender-pay")).toBeNull();
    expect(q(el, "[data-bill-payments]")!.checkVisibility()).toBe(true);
    expect(q(el, "[data-bill-payments] .amount")!.textContent).toContain("€8.00");
    expect(q(el, "[data-bill-received]")!.textContent).toContain("€2.00");
    const payments = capture(el, "bill-pay");
    const invoices = capture(el, "choose-bill-invoice");
    await userEvent.click(q(el, "[data-pay-rest]")!);
    expect(payments.map((event) => event.detail)).toEqual([
      {
        way: "contribution",
        amount: "8.00",
        lines: [
          { lineNo: 1, name: "Recorded dish", quantity: "2", total: "8.00", unitTotal: null },
          {
            lineNo: 3,
            name: "Recorded served dish",
            quantity: "1",
            total: "2.00",
            unitTotal: null,
          },
        ],
      },
    ]);
    await userEvent.click(q(el, "[data-choose-bill-invoice]:not([data-table-menu] *)")!);
    expect(invoices.map((event) => event.detail)).toEqual([
      { workingOrderId: "wo-4", revision: 7 },
    ]);
  });

  it("keeps a retained payment confirmation available when the latest bill is fully paid", async () => {
    const confirmation = {
      tender: { method: "cash" as const, amount: "12.00" },
      outstanding: "10.00",
      guestCount: 3,
    };
    const { el } = await mountFooter({
      bills: [{ ...footerBill, status: "settled", outstanding: "0.00" }],
      paymentConfirmation: confirmation,
    });
    expect(q(el, "[data-bill-actions]")).not.toBeNull();
    const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
    expect(tender.confirmation).toBe(confirmation);
    expect(q(el, "[data-open-bill-pay]")).toBeNull();
  });

  it("uses the selected bill's settlement state after switching bills", async () => {
    const { el } = await mountFooter({
      bills: [
        footerBill,
        {
          ...footerBill,
          workingOrderId: "paid",
          billNumber: 2,
          status: "settled",
          outstanding: "0.00",
        },
      ],
    });
    expect(q(el, "[data-bill-actions]")).not.toBeNull();
    expect(q(el, "till-tender-pay")).not.toBeNull();
    el.orderId = "paid";
    await el.updateComplete;
    expect(q(el, "till-tender-pay, [data-discount-bill]")).toBeNull();
    el.orderId = "wo-4";
    await el.updateComplete;
    expect(q(el, "till-tender-pay")).not.toBeNull();
    expect(q(el, "[data-discount-bill]:not([data-table-menu] *)")!.textContent).toContain(
      t("table.discount_bill"),
    );
  });
});

describe("A803 no tab panel", () => {
  const twoBills = {
    party: { ...footerParty, outstanding: "38.50", billCount: 2 },
    bills: [
      footerBill,
      {
        ...footerBill,
        workingOrderId: "wo-5",
        billNumber: 2,
        total: "28.50",
        outstanding: "28.50",
      },
    ],
  };

  it.each([
    [1280, 1100],
    [1024, 768],
    [390, 844],
  ])("draws no Tab button or drawer at %ix%i", async (width, height) => {
    await page.viewport(width, height);
    const { el } = await mountFooter(twoBills);
    await resized(el);
    const head = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".head-actions > *")];
    expect(
      head.map((node) =>
        node.hasAttribute("data-bill-switcher")
          ? "switcher"
          : node.hasAttribute("data-table-menu")
            ? "menu"
            : node.hasAttribute("data-back")
              ? "back"
              : node.localName,
      ),
    ).toEqual(["till-table-status", "switcher", "menu", "back"]);
    expect(head.map((node) => node.textContent!.replace(/\s+/g, " ").trim())).not.toContain("Tab");
    expect(q(el, ".drawer-handle, .badge, [data-drawer]")).toBeNull();
  });

  it("shows this bill's total, then what is still to pay at the whole table", async () => {
    const { el } = await mountFooter(twoBills);
    await resized(el);
    const total = q(el, "[data-order-total]")!;
    const still = q(el, "[data-party-outstanding]")!;
    expect(total.textContent!.trim()).toBe("€10.00");
    expect(still.checkVisibility()).toBe(true);
    expect(still.textContent!.trim()).toBe("€38.50");
    expect(q(el, "[data-party-outstanding-row]")!.textContent).toContain(t("table.still_to_pay"));
    expect(total.compareDocumentPosition(still) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      still.compareDocumentPosition(q(el, "[data-bill-actions]")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows no table still-to-pay for an order that belongs to no party", async () => {
    const { el } = await mountFooter({ party: null, bills: [] });
    await resized(el);
    expect(q(el, "[data-order-total]")).not.toBeNull();
    expect(q(el, "[data-party-outstanding]")).toBeNull();
  });

  it("shows Finish table's refusal above the foot, where the ⋮'s Finish table was tapped", async () => {
    await page.viewport(1024, 768);
    const { el } = await mountFooter(twoBills);
    await resized(el);
    el.addEventListener("finish-table", () => {
      el.finishRefused = true;
    });
    const payments = capture(el, "take-payment");
    await openTableMenu(el);
    await userEvent.click(q(el, "[data-table-menu] [data-finish-table]")!);
    await el.updateComplete;

    const refusal = q(el, "[data-finish-refusal]")!;
    expect(refusal).not.toBeNull();
    expect(refusal.checkVisibility()).toBe(true);
    expect(refusal.getAttribute("role")).toBe("alert");
    expect(refusal.textContent).toContain(codeMessage("party.bill_outstanding"));
    await expect
      .poll(() => {
        const box = refusal.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      })
      .toBe(true);
    expect(
      refusal.compareDocumentPosition(q(el, "[data-order-summary]")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(q(el, "[data-finish-refusal] [data-record-departure]")).not.toBeNull();
    await userEvent.click(q(el, "[data-finish-refusal] [data-take-payment]")!);
    expect(payments.map((event) => event.detail)).toEqual([{ workingOrderId: "wo-5" }]);
  });

  it("shows Move guests' table picker in the side column, and Back closes it", async () => {
    const { el } = await mountFooter(twoBills);
    await resized(el);
    expect(q(el, "[data-action-panel]")).toBeNull();
    await openTableMenu(el);
    await userEvent.click(q(el, '[data-table-menu] [data-action="move"]')!);
    await el.updateComplete;
    const panel = q(el, "[data-action-panel]")!;
    expect(panel.parentElement!.classList.contains("layout")).toBe(true);
    expect(panel.querySelector("[data-target-picker]")!.checkVisibility()).toBe(true);
    await userEvent.click(panel.querySelector<HTMLElement>("[data-action-back]")!);
    await el.updateComplete;
    expect(q(el, "[data-action-panel]")).toBeNull();
  });
});
