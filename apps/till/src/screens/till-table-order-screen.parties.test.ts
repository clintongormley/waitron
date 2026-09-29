import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decimal, formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TabLine, TableParty, PartyBill } from "../api/client.js";

const money = (amount: string) => formatMoney(decimal(amount), currentLocale());

const party: TableParty = {
  id: "v1",
  revision: 4,
  guestCount: 3,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: "wo-check",
  outstanding: "30.00",
  billCount: 2,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

const paidTab: PartyBill = {
  workingOrderId: "wo-tab",
  partyId: "v1",
  label: null,
  status: "settled",
  total: "14.00",
  outstanding: "0.00",
  receiptAvailable: true,
};
const check: PartyBill = {
  workingOrderId: "wo-check",
  partyId: "v1",
  label: null,
  status: "open",
  total: "30.00",
  outstanding: "30.00",
  receiptAvailable: false,
};
const abandoned: PartyBill = {
  workingOrderId: "wo-gone",
  partyId: "v1",
  label: null,
  status: "abandoned",
  total: "0.00",
  outstanding: "0.00",
  receiptAvailable: false,
};

const wine: TabLine = {
  id: "line-1",
  groupId: null,
  lineNo: 1,
  productId: "vino",
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "30.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};

async function mountScreen(over: Partial<TillTableOrderScreen> = {}) {
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines: [],
    statuses: [],
    orderId: "wo-tab",
    party: party,
    bills: [paidTab, check, abandoned],
    ...over,
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
  return el;
}

const bills = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-bills]")!;
const bill = (el: TillTableOrderScreen, id: string) =>
  bills(el).querySelector<HTMLElement>(`[data-bill="${id}"]`);

function capture(el: TillTableOrderScreen, type: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-table-order-screen: the party's bills", () => {
  it("lists every bill with what it came to and what is still to pay, and the table's total", async () => {
    const el = await mountScreen();

    expect(bills(el).querySelectorAll("[data-bill]")).toHaveLength(2);
    const paid = bill(el, "wo-tab")!;
    expect(paid.querySelector("[data-bill-total]")!.textContent).toBe(money("14.00"));
    expect(paid.querySelector("[data-bill-state]")!.textContent).toBe(t("table.bill_paid"));
    const open = bill(el, "wo-check")!;
    expect(open.querySelector("[data-bill-total]")!.textContent).toBe(money("30.00"));
    expect(open.querySelector("[data-bill-state]")!.textContent).toBe(
      t("table.bill_to_pay").replace("{amount}", money("30.00")),
    );
    expect(bills(el).querySelector("[data-party-outstanding]")!.textContent).toBe(money("30.00"));
  });

  it("names each bill after the party, numbered in the order listed", async () => {
    const el = await mountScreen();

    expect(bill(el, "wo-tab")!.querySelector(".bill-name")!.textContent!.trim()).toBe(
      t("table.bill_of").replace("{party}", "Ana").replace("{n}", "1"),
    );
    expect(bill(el, "wo-check")!.querySelector(".bill-name")!.textContent!.trim()).toBe(
      t("table.bill_of").replace("{party}", "Ana").replace("{n}", "2"),
    );
  });

  it("names an unnamed party's bills after its tables, and never after a bill's own label", async () => {
    const el = await mountScreen({
      party: { ...party, name: null, displayName: "Mesa 4, 5" },
      bills: [paidTab, { ...check, label: "Mesa 4" }],
    });

    expect(bill(el, "wo-check")!.querySelector(".bill-name")!.textContent!.trim()).toBe(
      t("table.bill_of").replace("{party}", "Mesa 4, 5").replace("{n}", "2"),
    );
  });

  it("marks the bill new orders go to, and no other", async () => {
    const el = await mountScreen();

    expect(bill(el, "wo-check")!.querySelector("[data-bill-main]")!.textContent!.trim()).toBe(
      t("table.bill_main"),
    );
    expect(bill(el, "wo-tab")!.querySelector("[data-bill-main]")).toBeNull();
  });

  it("marks no bill when the party has no main bill until its next order", async () => {
    const el = await mountScreen({ party: { ...party, mainBillId: null } });

    expect(bills(el).querySelector("[data-bill-main]")).toBeNull();
  });

  it("leaves out a bill that was abandoned, which nobody pays", async () => {
    const el = await mountScreen();

    expect(bill(el, "wo-gone")).toBeNull();
  });

  it("offers a copy of a paid bill's receipt", async () => {
    const el = await mountScreen();
    const asked = capture(el, "reprint-bill");

    bill(el, "wo-tab")!.querySelector<HTMLElement>("[data-bill-receipt]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-tab" }]);
    expect(bill(el, "wo-check")!.querySelector("[data-bill-receipt]")).toBeNull();
  });

  it("offers to take payment for another unpaid bill of the party", async () => {
    const el = await mountScreen();
    const asked = capture(el, "take-payment");

    bill(el, "wo-check")!.querySelector<HTMLElement>("[data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-check" }]);
    expect(bill(el, "wo-tab")!.querySelector("[data-take-payment]")).toBeNull();
  });

  it("marks the bill on screen and offers no payment for it, since the charge below takes it", async () => {
    const el = await mountScreen({ orderId: "wo-check", lines: [wine] });

    expect(bill(el, "wo-check")!.getAttribute("aria-current")).toBe("true");
    expect(bill(el, "wo-check")!.querySelector("[data-take-payment]")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  });

  it("hides the charge when the bill on screen is already paid", async () => {
    const el = await mountScreen();

    expect(el.shadowRoot!.querySelector("till-tender-pay")).toBeNull();
  });

  it("shows no bills section for a tab that belongs to no party", async () => {
    const el = await mountScreen({ party: null, bills: [] });

    expect(el.shadowRoot!.querySelector("[data-bills]")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  });
});

describe("till-table-order-screen: Finish table", () => {
  it("asks to finish the table", async () => {
    const el = await mountScreen();
    const asked = capture(el, "finish-table");

    bills(el).querySelector<HTMLElement>("[data-finish-table]")!.click();

    expect(asked).toHaveLength(1);
  });

  it("shows the refusal with Take payment for the first unpaid bill when a bill is outstanding", async () => {
    const el = await mountScreen({ finishRefused: true });
    const asked = capture(el, "take-payment");

    const refusal = bills(el).querySelector<HTMLElement>("[data-finish-refusal]")!;
    expect(refusal.getAttribute("role")).toBe("alert");
    expect(refusal.textContent).toContain(codeMessage("party.bill_outstanding"));
    refusal.querySelector<HTMLElement>("[data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-check" }]);
  });

  it("offers no Take payment beside the refusal when no unpaid bill is open to charge here", async () => {
    const placed: PartyBill = { ...check, status: "placed" };
    const el = await mountScreen({ finishRefused: true, bills: [paidTab, placed] });

    const refusal = bills(el).querySelector<HTMLElement>("[data-finish-refusal]")!;
    expect(refusal.querySelector("[data-take-payment]")).toBeNull();
    expect(bill(el, "wo-check")!.querySelector("[data-bill-state]")!.textContent).toBe(
      t("table.bill_to_pay").replace("{amount}", money("30.00")),
    );
  });

  it("points the refusal's Take payment at another unpaid bill before the one on screen", async () => {
    const el = await mountScreen({
      finishRefused: true,
      orderId: "wo-check",
      bills: [check, { ...paidTab, status: "open", outstanding: "14.00" }],
    });
    const asked = capture(el, "take-payment");

    bills(el).querySelector<HTMLElement>("[data-finish-refusal] [data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-tab" }]);
  });

  it("points the refusal's Take payment at the bill on screen when it is the only one unpaid", async () => {
    const el = await mountScreen({ finishRefused: true, orderId: "wo-check" });
    const asked = capture(el, "take-payment");

    bills(el).querySelector<HTMLElement>("[data-finish-refusal] [data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-check" }]);
  });

  it("shows no refusal until Finish has been refused", async () => {
    const el = await mountScreen();

    expect(bills(el).querySelector("[data-finish-refusal]")).toBeNull();
  });
});
