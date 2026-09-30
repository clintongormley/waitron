import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { BillBalance, PartyBill, TabLine, TableParty } from "../api/client.js";

beforeEach(() => setLocale("es-ES"));
afterEach(cleanupWidgets);

const party: TableParty = {
  id: "v1",
  revision: 4,
  guestCount: 3,
  state: "open",
  name: null,
  displayName: "4",
  mainBillId: "wo-4",
  outstanding: "39.00",
  billCount: 1,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

const bill: PartyBill = {
  workingOrderId: "wo-4",
  partyId: "v1",
  label: null,
  status: "open",
  total: "45.00",
  outstanding: "39.00",
  hasPayments: true,
  receiptAvailable: false,
};

function line(over: Partial<TabLine>): TabLine {
  return {
    id: `line-${over.lineNo}`,
    groupId: null,
    lineNo: 1,
    productId: "p",
    quantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "1.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
    ...over,
  };
}

const balance: BillBalance = {
  workingOrderId: "wo-4",
  status: "open",
  total: "45.00",
  received: "6.00",
  reserved: "0.00",
  outstanding: "39.00",
  tips: "0.00",
  payments: [],
  paidLines: [
    { lineId: "line-2", lineNo: 2, paidQuantity: "1.000" },
    { lineId: "line-3", lineNo: 3, paidQuantity: "1.000" },
  ],
};

describe.each(["light", "dark"] as const)(
  "till-table-order-screen bill payments a11y (%s theme)",
  (theme) => {
    it.each([
      ["an untouched bill offering the three ways", { ...bill, hasPayments: false }, null],
      ["a partly paid bill with its paid items marked", bill, balance],
    ] as const)("has no violations for %s", async (_case, shownBill, billBalance) => {
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          products: [],
          lines: [
            line({ lineNo: 1, name: "Paella", unitPriceGross: "30.00" }),
            line({ lineNo: 2, name: "Caña", quantity: "3.000", unitPriceGross: "3.00" }),
            line({
              lineNo: 3,
              name: "Tiramisú",
              unitPriceGross: "6.00",
              servedAt: "2026-09-30T20:00:00.000Z",
            }),
          ],
          statuses: [],
          orderId: "wo-4",
          party,
          bills: [shownBill],
          billBalance,
        },
        theme,
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await el.updateComplete;
      if (el.shadowRoot!.querySelector("[data-open-bill-pay]") === null)
        throw new Error("the scan must include the ways to pay");
      await expectNoA11yViolations(host);
    });
  },
);
