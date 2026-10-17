import { describe, expect, it } from "vitest";
import type { TableParty } from "../api/client.js";
import { defaultReceiptGuests } from "./receipt-guests.js";

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 3 },
    id: "v1",
    revision: 3,
    guestCount: 4,
    state: "open",
    name: null,
    displayName: "4",
    mainBillId: "wo-4",
    outstanding: "44.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

describe("defaultReceiptGuests", () => {
  it("is the party's count when it holds one bill", () => {
    expect(defaultReceiptGuests(party())).toBe(4);
  });

  it("is null when the party's bill is split", () => {
    expect(defaultReceiptGuests(party({ billCount: 2 }))).toBeNull();
  });

  it("is null when the party has no count", () => {
    expect(defaultReceiptGuests(party({ guestCount: null }))).toBeNull();
  });

  it("is null with no party", () => {
    expect(defaultReceiptGuests(null)).toBeNull();
    expect(defaultReceiptGuests(undefined)).toBeNull();
  });

  it("is null for a count the receipt cannot hold", () => {
    expect(defaultReceiptGuests(party({ guestCount: 1000 }))).toBeNull();
    expect(defaultReceiptGuests(party({ guestCount: 999 }))).toBe(999);
  });
});
