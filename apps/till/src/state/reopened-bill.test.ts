import { beforeEach, describe, expect, it } from "vitest";
import { billOf } from "../../test/bill-pay-app.js";
import type { BillBalance, BillEditExpected } from "../api/client.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { creditedNotice, movedToBill } from "./reopened-bill.js";

const balance = (workingOrderId: string) => ({ workingOrderId }) as unknown as BillBalance;
const edit: BillEditExpected = {
  billId: "wo-4",
  editorVersion: 0,
  draftId: null,
  draftRevision: null,
};

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

describe("creditedNotice", () => {
  beforeEach(() => setLocale("en"));
  const reopen = { from: "wo-4", to: "wo-5" };
  const reopened = billOf({ workingOrderId: "wo-5", billNumber: 2 });

  it("names the printed bill's latest corrective and the bill its dishes are on", () => {
    const printed = billOf({
      billNumber: null,
      status: "abandoned",
      correctives: ["R-1/3", "R-1/4"],
    });

    expect(creditedNotice([printed, reopened], reopen)).toBe(
      fill(t("table.bill_credited"), { number: "R-1/4", shown: "Bill 2" }),
    );
  });

  it("says a corrective was issued when the read names none, and nothing while the reopened bill is unlisted", () => {
    expect(creditedNotice([reopened], reopen)).toBe(
      fill(t("table.bill_credited_unnumbered"), { shown: "Bill 2" }),
    );
    expect(creditedNotice([billOf()], reopen)).toBeNull();
  });
});
