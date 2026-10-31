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
    "offers payment in the foot and Discount in the ⋮, without opening the drawer (draft %s)",
    async (editable) => {
      const { el } = await mountFooter({ draftStore: editable ? new DraftStore() : null });
      await resized(el);
      const footer = q(el, "[data-bill-actions]");
      expect(footer).not.toBeNull();
      expect(footer!.checkVisibility()).toBe(true);
      expect(q(el, "[data-drawer]")).toBeNull();
      const summary = q(el, "[data-order-summary]")!;
      const pay = q(el, "till-tender-pay")!;
      expect(summary).not.toBeNull();
      expect(pay).not.toBeNull();
      expect(summary.textContent).toContain("€10.00");
      expect(
        summary.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(pay.checkVisibility()).toBe(true);
      expect(footer!.querySelector("[data-discount-bill]")).toBeNull();
      await openTableMenu(el);
      const discount = q(el, "[data-table-menu] [data-discount-bill]")!;
      expect(discount).not.toBeNull();
      expect(discount.checkVisibility()).toBe(true);
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
    await openTableMenu(el);
    await userEvent.click(q(el, "[data-table-menu] [data-discount-bill]")!);
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
    await openTableMenu(el);
    expect(q(el, "[data-table-menu] [data-discount-bill]")!.checkVisibility()).toBe(true);
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

  it("forwards only the bill payment event, and the relocated widget draws no Hold", async () => {
    const { el } = await mountFooter();
    expect(q(el, "[data-bill-actions]")).not.toBeNull();
    const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
    const payments = capture(el, "pay-tab");
    const counter = capture(el, "confirm-payment");
    tender.dispatchEvent(
      new CustomEvent("confirm-payment", {
        detail: { method: "cash", amount: "12.00", guestCount: 3 },
        bubbles: true,
        composed: true,
      }),
    );
    expect(payments.map((event) => event.detail)).toEqual([
      { method: "cash", amount: "12.00", guestCount: 3 },
    ]);
    expect(payments[0]!.bubbles && payments[0]!.composed).toBe(true);
    expect(counter).toEqual([]);
    await tender.updateComplete;
    expect(tender.shadowRoot!.querySelector(".pay")).not.toBeNull();
    expect(tender.shadowRoot!.querySelector(".hold")).toBeNull();
    expect(tender.shadowRoot!.textContent).not.toContain(t("action.hold"));
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
    await openTableMenu(el);
    expect(q(el, "[data-table-menu] [data-discount-bill]")!.textContent).toContain(
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

describe("A803 pay scope", () => {
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
    fullInvoices: true,
  };
  const partPaid = {
    ...twoBills,
    bills: [{ ...footerBill, hasPayments: true, outstanding: "8.00" }, twoBills.bills[1]!],
    billBalance: footerBalance,
  };
  const unsentDraft = (billId: string) => ({
    billId,
    billNumber: billId === "wo-4" ? 1 : 2,
    ownerId: "p-ana",
    ownerName: "Ana",
    lineCount: 1,
    savedAt: "2026-10-31T10:00:00.000Z",
  });
  const withUnsent = () => {
    const draft = new DraftStore();
    draft.appendLines([{ product: beer, quantity: "1" }]);
    return draft;
  };

  /** What the foot draws, in screen order, outside the ⋮; the pay card's own buttons by class. */
  async function footParts(el: TillTableOrderScreen): Promise<string[]> {
    const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay");
    await tender?.updateComplete;
    const nodes = el.shadowRoot!.querySelectorAll<HTMLElement>(
      "[data-order-total], [data-party-outstanding-row], [data-bill-payments] > .amount, [data-bill-actions] till-tender-pay, [data-bill-actions] wt-button",
    );
    return [...nodes].flatMap((node) => {
      if (node.matches("[data-order-total]")) return ["total"];
      if (node.matches("[data-party-outstanding-row]")) return ["table still to pay"];
      if (node.matches(".amount")) return ["bill still to pay"];
      if (node.localName === "till-tender-pay")
        return [...node.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")].map(
          (button) =>
            `tender ${button.className || button.getAttributeNames().find((name) => name.startsWith("data-"))}`,
        );
      if (node.closest("till-tender-pay")) return [];
      const hook = node.getAttributeNames().find((name) => name.startsWith("data-"))!;
      const value = node.getAttribute(hook);
      return [value ? `${hook}=${value}` : hook];
    });
  }

  const ways = [
    "data-open-bill-pay=items",
    "data-open-bill-pay=contribution",
    "data-open-bill-pay=share",
  ];

  it("draws, for an open owing bill, the totals, then Cash and Card, this bill's Full invoice and the pay ways", async () => {
    const { el } = await mountFooter(twoBills);
    await resized(el);
    expect(await footParts(el)).toEqual([
      "total",
      "table still to pay",
      "tender pay",
      "tender pay-card",
      "data-choose-bill-invoice",
      ...ways,
    ]);
    expect(q(el, "[data-discount-bill]:not([data-table-menu] *)")).toBeNull();
  });

  it("adds the bill's receipt language when two receipt languages are offered", async () => {
    const { el } = await mountFooter({ ...twoBills, receiptLanguages: ["es-ES", "en-GB"] });
    await resized(el);
    expect(await footParts(el)).toEqual([
      "total",
      "table still to pay",
      "tender pay",
      "tender pay-card",
      "data-choose-bill-invoice",
      "data-choose-bill-language",
      ...ways,
    ]);
  });

  it("draws, for a part-paid bill, the totals, what it still owes, Pay the rest, its choices and the pay ways", async () => {
    const { el } = await mountFooter(partPaid);
    await resized(el);
    expect(await footParts(el)).toEqual([
      "total",
      "table still to pay",
      "bill still to pay",
      "data-pay-rest",
      "data-choose-bill-invoice",
      ...ways,
    ]);
  });

  it("draws, on a handheld, the totals, one Pay and the bill's choices", async () => {
    const { el } = await mountFooter({ ...twoBills, handheld: true });
    await resized(el);
    expect(await footParts(el)).toEqual([
      "total",
      "table still to pay",
      "data-pay-sheet",
      "data-choose-bill-invoice",
    ]);
  });

  it("offers one Full invoice on the payment step, and none for a presented bill with an invoice number", async () => {
    const { el } = await mountFooter(twoBills);
    await resized(el);
    expect(
      el.shadowRoot!.querySelectorAll("[data-choose-bill-invoice]:not([data-table-menu] *)"),
    ).toHaveLength(1);
    const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
    await tender.updateComplete;
    expect(tender.shadowRoot!.querySelector("[data-full-invoice]")).toBeNull();

    el.bills = [{ ...footerBill, status: "placed", invoiceNumber: "F-0001" }, twoBills.bills[1]!];
    el.receiptLanguages = ["es-ES", "en-GB"];
    await el.updateComplete;
    expect(q(el, "[data-choose-bill-invoice]")).toBeNull();
    expect(q(el, "[data-choose-bill-language]:not([data-table-menu] *)")).not.toBeNull();
    expect(q(el, "till-tender-pay")).not.toBeNull();
  });

  describe("quiet Pay while this bill has unsent dishes", () => {
    const sentence = "Bill 1. Send or remove the unsent dishes before paying.";

    async function expectQuiet(
      el: TillTableOrderScreen,
      controls: () => HTMLElement[],
      text = sentence,
    ): Promise<void> {
      const started = ["pay-tab", "bill-pay", "pay-presented", "confirm-payment"].map((name) =>
        capture(el, name),
      );
      const shown = controls();
      expect(shown.length).toBeGreaterThan(0);
      for (const [index, control] of shown.entries()) {
        expect(control.getAttribute("variant")).toBe("secondary");
        expect(control.hasAttribute("disabled")).toBe(false);
        expect((control as HTMLElement & { disabled?: boolean }).disabled ?? false).toBe(false);
        await userEvent.click(controls()[index]!);
        await el.updateComplete;
        const alert = q(el, "[data-pay-unsent]")!;
        expect(alert.getAttribute("role")).toBe("alert");
        expect(alert.checkVisibility()).toBe(true);
        expect(alert.textContent!.trim()).toBe(text);
        expect(alert.closest(".pay")).not.toBeNull();
        const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay");
        await tender?.updateComplete;
        if (tender) expect(tender.shadowRoot!.querySelector(".pay-card")).not.toBeNull();
      }
      expect(started.flat()).toEqual([]);
      const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay");
      expect(tender?.shadowRoot!.querySelector(".tendered") ?? null).toBeNull();
    }

    async function tenderButtons(el: TillTableOrderScreen): Promise<() => HTMLElement[]> {
      const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
      await tender.updateComplete;
      return () => [
        tender.shadowRoot!.querySelector<HTMLElement>(".pay")!,
        tender.shadowRoot!.querySelector<HTMLElement>(".pay-card")!,
        ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-open-bill-pay]"),
      ];
    }

    it("keeps Cash, Card and the pay ways quiet but tappable for a dish in this bill's New order", async () => {
      const { el } = await mountFooter({ ...twoBills, draftStore: withUnsent() });
      await resized(el);
      expect(q(el, "[data-pay-unsent]")).toBeNull();
      await expectQuiet(el, await tenderButtons(el));
      expect(el.shadowRoot!.querySelectorAll("[data-open-bill-pay]")).toHaveLength(3);
    });

    it("keeps Pay the rest quiet on a part-paid bill", async () => {
      const { el } = await mountFooter({ ...partPaid, draftStore: withUnsent() });
      await resized(el);
      await expectQuiet(el, () => [
        q(el, "[data-pay-rest]")!,
        ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-open-bill-pay]"),
      ]);
    });

    it("keeps a handheld's Pay quiet", async () => {
      const { el } = await mountFooter({ ...twoBills, handheld: true, draftStore: withUnsent() });
      await resized(el);
      await expectQuiet(el, () => [q(el, "[data-pay-sheet]")!]);
    });

    it("is quiet for another person's unsent dishes on this bill, and offers their Take over", async () => {
      const { el } = await mountFooter({
        ...twoBills,
        party: { ...twoBills.party, unsentDrafts: [unsentDraft("wo-4")] },
        otherDrafts: [
          { id: "d-ana", revision: 1, ownerName: "Ana", takenFromYou: false, lines: [] },
        ],
      });
      await resized(el);
      await expectQuiet(el, await tenderButtons(el));
      expect(q(el, '[data-take-over="d-ana"]')!.checkVisibility()).toBe(true);
    });

    it("is not quiet when the unsent dishes are on Bill 2 only", async () => {
      const { el } = await mountFooter({
        ...twoBills,
        party: { ...twoBills.party, unsentDrafts: [unsentDraft("wo-5")] },
      });
      await resized(el);
      const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
      await tender.updateComplete;
      const cash = tender.shadowRoot!.querySelector<HTMLElement>(".pay")!;
      expect(cash.getAttribute("variant")).toBe("primary");
      expect(tender.shadowRoot!.querySelector(".pay-card")!.getAttribute("variant")).toBe(
        "primary",
      );
      const payments = capture(el, "bill-pay");
      await userEvent.click(q(el, '[data-open-bill-pay="items"]')!);
      expect(payments).toHaveLength(1);
      await userEvent.click(cash);
      await tender.updateComplete;
      expect(tender.shadowRoot!.querySelector(".tendered")).not.toBeNull();
      expect(q(el, "[data-pay-unsent]")).toBeNull();
    });

    it("is not quiet for a handheld's unanswered whole payment of a presented bill, which it recovers", async () => {
      const { el } = await mountFooter({
        ...twoBills,
        handheld: true,
        party: { ...twoBills.party, unsentDrafts: [unsentDraft("wo-4")] },
        bills: [{ ...footerBill, status: "placed" }, twoBills.bills[1]!],
        paymentConfirmation: {
          tender: { method: "cash" as const, amount: "12.00" },
          outstanding: "10.00",
          guestCount: 3,
        },
      });
      await resized(el);
      const presented = capture(el, "pay-presented");
      const pay = q(el, "[data-pay-sheet]")!;
      expect(pay.getAttribute("variant")).toBe("primary");
      await userEvent.click(pay);
      expect(presented.map((event) => event.detail)).toEqual([{ workingOrderId: "wo-4" }]);
      expect(q(el, "[data-pay-unsent]")).toBeNull();
    });

    it("says it in Spanish", async () => {
      setLocale("es");
      try {
        const { el } = await mountFooter({ ...twoBills, draftStore: withUnsent() });
        await resized(el);
        await expectQuiet(
          el,
          await tenderButtons(el),
          "Cuenta 1. Envía o quita los platos sin enviar antes de cobrar.",
        );
      } finally {
        setLocale("en");
      }
    });

    it("clears the sentence when another bill is shown, and when this bill's dishes are sent", async () => {
      const draft = withUnsent();
      const { el } = await mountFooter({ ...twoBills, draftStore: draft });
      await resized(el);
      await userEvent.click((await tenderButtons(el))()[0]!);
      await el.updateComplete;
      expect(q(el, "[data-pay-unsent]")).not.toBeNull();
      el.orderId = "wo-5";
      await el.updateComplete;
      expect(q(el, "[data-pay-unsent]")).toBeNull();
      el.orderId = "wo-4";
      await el.updateComplete;
      expect(q(el, "[data-pay-unsent]")).toBeNull();

      await userEvent.click((await tenderButtons(el))()[1]!);
      await el.updateComplete;
      expect(q(el, "[data-pay-unsent]")).not.toBeNull();
      draft.clear();
      await el.updateComplete;
      expect(q(el, "[data-pay-unsent]")).toBeNull();
      const tender = el.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
      await tender.updateComplete;
      expect(tender.shadowRoot!.querySelector(".pay")!.getAttribute("variant")).toBe("primary");
    });
  });
});
