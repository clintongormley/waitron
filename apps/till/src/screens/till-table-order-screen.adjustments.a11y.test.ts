import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PartyBill, TabLine, TableParty } from "../api/client.js";

// The table screen's Give away and Discount actions, on a dish and on an extra, the bill's
// Discount, and a given-away or discounted line's earlier price struck through (service plan Task
// 11, part B; B11d).

const party: TableParty = {
  id: "v1",
  revision: 4,
  guestCount: 2,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: "wo-4",
  outstanding: "27.00",
  billCount: 1,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

const bill: PartyBill = {
  workingOrderId: "wo-4",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  status: "open",
  total: "27.00",
  outstanding: "27.00",
  hasPayments: false,
  receiptAvailable: false,
};

const base: Omit<TabLine, "id" | "lineNo" | "name" | "unitPriceGross"> = {
  stationId: null,
  movable: false,
  groupId: null,
  productId: null,
  quantity: "1.000",
  unitPrecision: 0,
  servedAt: null,
  courseId: null,
  sentAt: "2026-09-30T09:00:00.000Z",
  firedAt: "2026-09-30T09:00:00.000Z",
  state: "queued",
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};

const lines: TabLine[] = [
  {
    ...base,
    id: "l1",
    lineNo: 1,
    name: "Hamburguesa",
    unitPriceGross: "0.00",
    listUnitPriceGross: "12.00",
  },
  // An extra, with Give away, Discount and Cancel of its own, painted muted a size down.
  {
    ...base,
    id: "l4",
    lineNo: 4,
    name: "Queso",
    parentLineNo: 1,
    unitPrecision: null,
    state: null,
    unitPriceGross: "1.50",
  },
  {
    ...base,
    id: "l2",
    lineNo: 2,
    name: "Rioja crianza",
    unitPriceGross: "27.00",
    listUnitPriceGross: "30.00",
    servedAt: "2026-09-30T09:10:00.000Z",
  },
  { ...base, id: "l3", lineNo: 3, name: "Pan", unitPriceGross: "2.50" },
];

beforeEach(() => setLocale("es-ES"));
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)(
  "till-table-order-screen adjustments a11y (%s theme)",
  (theme) => {
    it("has no violations with the actions and the earlier prices shown", async () => {
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { products: [], lines, statuses: [], orderId: "wo-4", party, bills: [bill] },
        theme,
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-cancel-line="4"]')).not.toBeNull();
      await expectNoA11yViolations(host);
    });
  },
);
