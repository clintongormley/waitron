import { beforeEach, describe, expect, it } from "vitest";
import { billOf } from "../../test/bill-pay-app.js";
import type { BillBalance, BillEditExpected } from "../api/client.js";
import { fill, setLocale, t } from "../i18n/t.js";
import {
  billAfterItems,
  billNoticeText,
  creditedNotice,
  goneNotice,
  movedToBill,
  noticeAfterGone,
  reopenedTo,
} from "./reopened-bill.js";

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

describe("creditedNotice and billNoticeText", () => {
  beforeEach(() => setLocale("en"));
  const reopen = { from: "wo-4", to: "wo-5" };
  const reopened = billOf({ workingOrderId: "wo-5", billNumber: 2 });

  it("names the printed bill's latest corrective and the bill its dishes are on", () => {
    const printed = billOf({
      billNumber: null,
      status: "abandoned",
      correctives: ["R-1/3", "R-1/4"],
    });

    expect(billNoticeText(creditedNotice([printed, reopened], reopen))).toBe(
      fill(t("table.bill_credited"), { number: "R-1/4", shown: "Bill 2" }),
    );
  });

  it("says a corrective was issued when the read names none, and nothing while the reopened bill is unlisted", () => {
    expect(billNoticeText(creditedNotice([reopened], reopen))).toBe(
      fill(t("table.bill_credited_unnumbered"), { shown: "Bill 2" }),
    );
    expect(creditedNotice([billOf()], reopen)).toBeNull();
  });

  it("says the chosen dishes stayed on the bill shown when they could not go back", () => {
    const printed = billOf({ billNumber: null, status: "abandoned", correctives: ["R-1/4"] });
    const own = billOf({ workingOrderId: "wo-9", billNumber: 3 });
    const kept = { from: "wo-4", to: "wo-9", kept: true };

    expect(billNoticeText(creditedNotice([printed, own], kept))).toBe(
      fill(t("table.bill_credited_kept"), { number: "R-1/4", shown: "Bill 3" }),
    );
    expect(billNoticeText(creditedNotice([own], kept))).toBe(
      fill(t("table.bill_credited_kept_unnumbered"), { shown: "Bill 3" }),
    );
  });

  it("words a bill that left the table, with or without its number, in the language shown now", () => {
    const shown = billOf({ workingOrderId: "wo-5", billNumber: 2 });
    const notice = goneNotice(billOf(), shown);
    expect(billNoticeText(notice)).toBe(
      fill(t("table.bill_gone"), { gone: "Bill 1", shown: "Bill 2" }),
    );
    expect(billNoticeText(goneNotice(undefined, shown))).toBe(
      fill(t("table.bill_gone_unnumbered"), { shown: "Bill 2" }),
    );
    setLocale("es");
    try {
      expect(billNoticeText(notice)).toBe(
        fill(t("table.bill_gone"), { gone: "Cuenta 1", shown: "Cuenta 2" }),
      );
    } finally {
      setLocale("en");
    }
  });
});

describe("billAfterItems", () => {
  const items = (status: BillBalance["status"]) =>
    ({ workingOrderId: "wo-9", status }) as unknown as BillBalance;
  const answer = (status: BillBalance["status"]) => ({
    balance: items(status),
    paidOn: "wo-9",
    sourceBalance: balance("wo-5"),
  });

  it("is the reopened bill, unless a card that charged nothing left the dishes on their open bill", () => {
    expect(billAfterItems("wo-4", answer("abandoned"), true)).toEqual({
      balance: balance("wo-5"),
      kept: false,
    });
    expect(billAfterItems("wo-4", answer("open"), false)).toEqual({
      balance: balance("wo-5"),
      kept: false,
    });
    expect(billAfterItems("wo-4", answer("open"), true)).toEqual({
      balance: items("open"),
      kept: true,
    });
  });

  it("is nothing when the answer names the bill paid from", () => {
    expect(billAfterItems("wo-5", answer("open"), true)).toBeUndefined();
  });
});

describe("reopenedTo and noticeAfterGone", () => {
  beforeEach(() => setLocale("en"));
  const reopen = { from: "wo-4", to: "wo-5" };
  const reopened = billOf({ workingOrderId: "wo-5", billNumber: 2 });
  const other = billOf({ workingOrderId: "wo-6", billNumber: 3 });

  it("is the reopened bill only when the bill that left is the one Pay for items reopened, and it is listed", () => {
    expect(reopenedTo(reopen, "wo-4", [reopened, other])).toBe("wo-5");
    expect(reopenedTo(reopen, "wo-6", [reopened, other])).toBeUndefined();
    expect(reopenedTo(reopen, "wo-4", [other])).toBeUndefined();
    expect(reopenedTo(undefined, "wo-4", [reopened])).toBeUndefined();
  });

  it("says the receipt was credited for the reopened bill, else names the bill shown, else nothing", () => {
    expect(noticeAfterGone(reopen, "wo-4", [reopened], undefined, reopened)).toEqual(
      creditedNotice([reopened], reopen),
    );
    expect(noticeAfterGone(reopen, "wo-6", [reopened], other, reopened)).toEqual(
      goneNotice(other, reopened),
    );
    expect(noticeAfterGone(undefined, "wo-6", [reopened], other, undefined)).toBeNull();
  });
});
