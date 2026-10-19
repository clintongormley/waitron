import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { openSentDish, openSentMore } from "./till-table-order-screen.sent.test-helpers.js";
import { current, row } from "./till-table-order-screen.current-orders.test-helpers.js";
import { addDecimal, grossOf } from "@waitron/shared";
import { setLocale } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PartyBill, TabLine, TableParty } from "../api/client.js";

const party: TableParty = {
  kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 4 },
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
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe.each(["light", "dark"] as const)(
  "till-table-order-screen adjustments a11y (%s theme)",
  (theme) => {
    it("has no violations with the actions and the earlier prices shown", async () => {
      const { el, host } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        {
          products: [],
          lines,
          statuses: [],
          orderId: "wo-4",
          party,
          bills: [bill],
          currentOrders: current({
            groups: [],
            reminder: null,
            ungrouped: lines
              .filter((line) => line.parentLineNo == null)
              .map((line) =>
                row(line.id, line.name!, line.quantity, {
                  lineNo: line.lineNo,
                  netAmount: lines
                    .filter((extra) => extra.parentLineNo === line.lineNo)
                    .reduce(
                      (sum, extra) =>
                        addDecimal(sum, grossOf(extra.unitPriceGross, extra.quantity)),
                      grossOf(line.unitPriceGross, line.quantity),
                    ),
                  servedAt: line.servedAt,
                  servedQuantity: line.servedAt === null ? "0.000" : line.quantity,
                  extras: lines
                    .filter((extra) => extra.parentLineNo === line.lineNo)
                    .map((extra) => ({
                      lineId: extra.id,
                      name: extra.name!,
                      quantity: extra.quantity,
                      unitPriceGross: extra.unitPriceGross,
                      priceQuantity: "1.000",
                      netAmount: grossOf(extra.unitPriceGross, extra.quantity),
                    })),
                }),
              ),
          }),
        },
        theme,
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-cancel-line="4"]')).toBeNull();
      el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await el.updateComplete;
      await openSentDish(el, "l1");
      expect(el.shadowRoot!.querySelector("[data-sent-line-dialog]")!.textContent).toContain(
        "Queso",
      );
      expect(el.shadowRoot!.querySelector("[data-sent-line-dialog] s")!.textContent).toContain(
        "12,00",
      );
      await openSentMore(el);
      expect(el.shadowRoot!.querySelector("[data-sent-line-void]")).not.toBeNull();
      await expectNoA11yViolations(host);
    });
  },
);
