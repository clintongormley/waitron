import type { BillBalance, PartyBill, TableParty } from "../api/client.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, menuOf } from "./till-table-order-screen.test-helpers.js";
import { mountWidget } from "../widgets/test-helpers.js";
import { DraftStore } from "../state/draft-sync.js";
import {
  storedDish,
  storedExtra,
  storedServed,
} from "./till-table-order-screen.sent-fallback.test-helpers.js";

export const footerParty: TableParty = {
  kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 4 },
  id: "v1",
  revision: 4,
  guestCount: 3,
  state: "open",
  name: null,
  displayName: "4",
  mainBillId: "wo-4",
  outstanding: "10.00",
  billCount: 1,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

export const footerBill: PartyBill = {
  workingOrderId: "wo-4",
  revision: 7,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  status: "open",
  total: "10.00",
  outstanding: "10.00",
  hasPayments: false,
  receiptAvailable: false,
};

export const footerBalance: BillBalance = {
  workingOrderId: "wo-4",
  status: "open",
  total: "10.00",
  received: "2.00",
  reserved: "0.00",
  outstanding: "8.00",
  tips: "0.00",
  payments: [],
  paidLines: [],
};

export function mountFooter(over: Partial<TillTableOrderScreen> = {}, theme?: "light" | "dark") {
  return mountWidget<TillTableOrderScreen>(
    "till-table-order-screen",
    {
      products: [beer],
      menus: menuOf([beer]),
      orderId: "wo-4",
      draftStore: new DraftStore(),
      party: footerParty,
      bills: [footerBill],
      lines: [storedDish, storedExtra, storedServed],
      ...over,
    },
    theme,
  );
}
