import type { PartyBill, TableParty } from "../api/client.js";

export const switcherParty: TableParty = {
  kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 4 },
  id: "v1",
  revision: 4,
  guestCount: 3,
  state: "open",
  name: null,
  displayName: "4",
  openingBillId: "wo-1",
  outstanding: "38.50",
  billCount: 1,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

/** A bill of {@link switcherParty} owing `outstanding`. */
export function partyBill(
  workingOrderId: string,
  billNumber: number | null,
  outstanding: string,
  over: Partial<PartyBill> = {},
): PartyBill {
  return {
    workingOrderId,
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    billNumber,
    billName: null,
    status: "open",
    total: outstanding,
    outstanding,
    hasPayments: false,
    receiptAvailable: false,
    ...over,
  };
}
