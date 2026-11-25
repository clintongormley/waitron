import { describe, expect, it } from "vitest";
import type { BillBalance, BillEditExpected } from "../api/client.js";
import { movedToBill, reopenedBill } from "./reopened-bill.js";

const balance = (workingOrderId: string) => ({ workingOrderId }) as unknown as BillBalance;
const edit: BillEditExpected = {
  billId: "wo-4",
  editorVersion: 0,
  draftId: null,
  draftRevision: null,
};

describe("reopenedBill", () => {
  it("names the answer's bill only when it is another bill than the one paid from", () => {
    expect(reopenedBill("wo-4", balance("wo-10"))).toEqual(balance("wo-10"));
    expect(reopenedBill("wo-4", balance("wo-4"))).toBeUndefined();
    expect(reopenedBill("wo-4", undefined)).toBeUndefined();
  });
});

describe("movedToBill", () => {
  it("moves the window to the reopened bill, unprinted, its balance shown and its edit state unread", () => {
    const open = {
      id: 7,
      billId: "wo-4",
      printed: true,
      balance: balance("wo-4"),
      expectedEdit: edit,
    };

    expect(movedToBill(open, balance("wo-10"))).toEqual({
      id: 7,
      billId: "wo-10",
      printed: false,
      balance: balance("wo-10"),
      expectedEdit: null,
    });
  });
});
